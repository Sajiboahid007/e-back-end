import express, { Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../utils/prisma.js';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth.js';

const router = express.Router();

// GET /api/v1/admin-settings - Super Admin list settings & admins
router.get('/', authenticate, requireRole(['SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminUsers = await prisma.user.findMany({
      where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] }, isMarkToDelete: false },
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true }
    });

    const settings = await prisma.appSetting.findMany();

    res.json({
      success: true,
      data: {
        adminUsers,
        settings
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/v1/admin-settings/create-admin - Create new Admin user (Super Admin only)
router.post('/create-admin', authenticate, requireRole(['SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, email, password, role = 'ADMIN' } = req.body;

    if (!name || !email || !password) {
      res.status(400).json({ success: false, error: 'Name, email, and password required' });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(400).json({ success: false, error: 'Email already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newAdmin = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN',
        isActive: true
      }
    });

    res.status(201).json({
      success: true,
      data: {
        id: newAdmin.id,
        name: newAdmin.name,
        email: newAdmin.email,
        role: newAdmin.role
      },
      message: 'Admin account created successfully'
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v1/admin-settings/update-setting - Update key-value setting
router.put('/update-setting', authenticate, requireRole(['SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { key, value } = req.body;
    if (!key || value === undefined) {
      res.status(400).json({ success: false, error: 'Key and value are required' });
      return;
    }

    const setting = await prisma.appSetting.upsert({
      where: { key },
      update: { value: String(value) },
      create: { key, value: String(value) }
    });

    res.json({ success: true, data: setting, message: 'Setting updated' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
