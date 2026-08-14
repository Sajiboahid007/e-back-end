import express, { Response } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.js';

const router = express.Router();

// GET /api/v1/notifications - Get user notification logs
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { sentAt: 'desc' },
      take: 20
    });

    res.json({ success: true, data: notifications });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
