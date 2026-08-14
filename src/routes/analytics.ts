import express, { Response } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth.js';
import { config } from '../config/index.js';

const router = express.Router();

// GET /api/v1/analytics/overview - Admin sales overview & charts data
router.get('/overview', authenticate, requireRole(['SUPER_ADMIN', 'ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Total revenues
    const [allOrders, todayOrders, weekOrders, monthOrders] = await Promise.all([
      prisma.order.findMany({ where: { isMarkToDelete: false, status: { not: 'CANCELLED' } } }),
      prisma.order.findMany({ where: { isMarkToDelete: false, status: { not: 'CANCELLED' }, createdAt: { gte: startOfToday } } }),
      prisma.order.findMany({ where: { isMarkToDelete: false, status: { not: 'CANCELLED' }, createdAt: { gte: startOfWeek } } }),
      prisma.order.findMany({ where: { isMarkToDelete: false, status: { not: 'CANCELLED' }, createdAt: { gte: startOfMonth } } })
    ]);

    const totalRevenue = allOrders.reduce((sum: number, o: any) => sum + o.total, 0);
    const todayRevenue = todayOrders.reduce((sum: number, o: any) => sum + o.total, 0);
    const weekRevenue = weekOrders.reduce((sum: number, o: any) => sum + o.total, 0);
    const monthRevenue = monthOrders.reduce((sum: number, o: any) => sum + o.total, 0);

    // Breakdown by order status
    const statusCounts = await prisma.order.groupBy({
      by: ['status'],
      _count: { id: true }
    });

    // Top selling products by quantity
    const topSellingItems = await prisma.orderItem.groupBy({
      by: ['productId', 'productName'],
      _sum: { quantity: true, subtotal: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5
    });

    // Revenue breakdown by main categories (Face, Body, Hair)
    const categoryRevenue = await prisma.orderItem.findMany({
      include: {
        product: { include: { category: true } }
      }
    });

    const categoryMap: { [key: string]: number } = {};
    categoryRevenue.forEach((item: any) => {
      const catName = item.product?.category?.name || 'Uncategorized';
      categoryMap[catName] = (categoryMap[catName] || 0) + item.subtotal;
    });

    // Low stock items panel
    const lowStockThreshold = config.lowStockThreshold;
    const lowStockProducts = await prisma.product.findMany({
      where: {
        isMarkToDelete: false,
        stockQuantity: { lte: lowStockThreshold }
      },
      select: {
        id: true,
        name: true,
        sku: true,
        stockQuantity: true,
        brand: true
      },
      take: 10
    });

    res.json({
      success: true,
      data: {
        revenue: {
          today: todayRevenue,
          week: weekRevenue,
          month: monthRevenue,
          total: totalRevenue
        },
        orders: {
          total: allOrders.length,
          statusBreakdown: statusCounts
        },
        topProducts: topSellingItems,
        categoryRevenue: Object.keys(categoryMap).map((key) => ({ category: key, revenue: categoryMap[key] })),
        lowStockAlerts: lowStockProducts
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
