import express, { Response } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth.js';
import { storageService } from '../services/storage.service.js';

const router = express.Router();

// GET /api/v1/users - Admin list customer directory
router.get('/', authenticate, requireRole(['SUPER_ADMIN', 'ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { search, page = '1', limit = '10' } = req.query;

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(limit as string, 10) || 10;
    const skip = (pageNum - 1) * limitNum;

    const where: any = { isMarkToDelete: false, role: 'CUSTOMER' };

    if (search) {
      where.OR = [
        { name: { contains: search as string } },
        { email: { contains: search as string } },
        { phone: { contains: search as string } }
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          isActive: true,
          createdAt: true,
          _count: { select: { orders: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum
      }),
      prisma.user.count({ where })
    ]);

    res.json({
      success: true,
      data: users,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v1/users/:id/toggle-active - Toggle enable/disable account (Admin)
router.put('/:id/toggle-active', authenticate, requireRole(['SUPER_ADMIN', 'ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const user = await prisma.user.findUnique({ where: { id } });

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { isActive: !user.isActive }
    });

    res.json({
      success: true,
      data: updatedUser,
      message: `User account ${updatedUser.isActive ? 'enabled' : 'disabled'}`
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/v1/users/recommendations - Personalized recommendations for registered customer
router.get('/recommendations', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    // Get categories of past purchased products
    const pastOrders = await prisma.order.findMany({
      where: { userId },
      include: { items: { include: { product: true } } }
    });

    const categoryIds = new Set<number>();
    pastOrders.forEach((o: any) => {
      o.items.forEach((item: any) => {
        if (item.product?.categoryId) categoryIds.add(item.product.categoryId);
      });
    });

    const categoryArray = Array.from(categoryIds);

    const products = await prisma.product.findMany({
      where: {
        isMarkToDelete: false,
        isActive: true,
        ...(categoryArray.length > 0 ? { categoryId: { in: categoryArray } } : { isFeatured: true })
      },
      include: {
        category: true,
        images: true
      },
      take: 8
    });

    const formatted = products.map((p: any) => ({
      ...p,
      images: p.images.map((img: any) => ({
        ...img,
        url: storageService.getUrl(img.filePath)
      }))
    }));

    res.json({ success: true, data: formatted });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
