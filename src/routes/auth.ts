import express, { Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../utils/prisma';
import { config } from '../config/index';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';

const router = express.Router();

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  password: z.string().min(6),
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'CUSTOMER']).optional()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string()
});

// POST /api/v1/auth/register
router.post('/register', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validated = registerSchema.parse(req.body);

    const existingUser = await prisma.user.findUnique({
      where: { email: validated.email }
    });

    if (existingUser) {
      res.status(400).json({ success: false, error: 'Email already registered' });
      return;
    }

    const passwordHash = await bcrypt.hash(validated.password, 10);

    const user = await prisma.user.create({
      data: {
        name: validated.name,
        email: validated.email,
        phone: validated.phone,
        passwordHash,
        role: validated.role || 'CUSTOMER'
      }
    });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any }
    );

    const refreshToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      config.jwtRefreshSecret,
      { expiresIn: config.jwtRefreshExpiresIn as any }
    );

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          addresses: []
        },
        token,
        refreshToken
      },
      message: 'Registration successful'
    });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// POST /api/v1/auth/login
router.post('/login', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email },
      include: { addresses: { where: { isMarkToDelete: false } } }
    });

    if (!user || user.isMarkToDelete || !user.isActive) {
      res.status(401).json({ success: false, error: 'Invalid credentials or account disabled' });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any }
    );

    const refreshToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      config.jwtRefreshSecret,
      { expiresIn: config.jwtRefreshExpiresIn as any }
    );

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          addresses: user.addresses || []
        },
        token,
        refreshToken
      },
      message: 'Login successful'
    });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// POST /api/v1/auth/refresh
router.post('/refresh', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400).json({ success: false, error: 'Refresh token is required' });
      return;
    }

    const decoded = jwt.verify(refreshToken, config.jwtRefreshSecret) as { id: number; email: string; role: any };
    const newToken = jwt.sign(
      { id: decoded.id, email: decoded.email, role: decoded.role },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any }
    );

    res.json({
      success: true,
      data: { token: newToken }
    });
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
  }
});

// GET /api/v1/auth/me
router.get('/me', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { addresses: { where: { isMarkToDelete: false } } }
    });

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isActive: user.isActive,
        addresses: user.addresses
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v1/auth/profile - Update user profile details & default shipping address
router.put('/profile', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { name, phone, street, city, state, postalCode, country } = req.body;

    let user = await prisma.user.findUnique({ where: { id: userId } })
            || (req.user?.email ? await prisma.user.findFirst({ where: { email: req.user.email } }) : null);
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const userUpdateData: any = {};
    if (name && typeof name === 'string' && name.trim().length > 0) {
      userUpdateData.name = name.trim();
    }
    if (phone !== undefined && phone !== null) {
      userUpdateData.phone = String(phone).trim();
    }

    if (Object.keys(userUpdateData).length > 0) {
      user = await prisma.user.update({
        where: { id: userId },
        data: userUpdateData
      });
    }

    if (street !== undefined || city !== undefined || state !== undefined || postalCode !== undefined || country !== undefined) {
      const existingAddress = await prisma.address.findFirst({
        where: { userId, isMarkToDelete: false, isDefault: true }
      }) || await prisma.address.findFirst({
        where: { userId, isMarkToDelete: false }
      });

      const addrData = {
        street: (street || '').trim(),
        city: (city || '').trim(),
        state: (state || '').trim(),
        postalCode: (postalCode || '').trim(),
        country: (country || 'United States').trim(),
        isDefault: true
      };

      if (existingAddress) {
        await prisma.address.update({
          where: { id: existingAddress.id },
          data: addrData
        });
      } else {
        await prisma.address.create({
          data: {
            userId,
            ...addrData
          }
        });
      }
    }

    const addresses = await prisma.address.findMany({
      where: { userId, isMarkToDelete: false }
    });

    res.json({
      success: true,
      message: 'Profile & saved address updated successfully',
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isActive: user.isActive,
        addresses
      }
    });
  } catch (error: any) {
    console.error('Profile update error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to update profile' });
  }
});

export default router;
