import express, { Response } from 'express';
import { prisma } from '../utils/prisma.js';
import { optionalAuthenticate, authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth.js';
import { notificationService } from '../services/notification.service.js';

const router = express.Router();

const generateOrderNumber = () => {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  return `BEA-${dateStr}-${randomNum}`;
};

// POST /api/v1/orders - Place order (Guest or Authenticated User)
router.post('/', optionalAuthenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const {
      guestSessionId,
      customerName,
      email,
      phone,
      shippingAddress,
      paymentMethod = 'COD',
      items
    } = req.body;

    if (!customerName || !email || !phone || !shippingAddress || !items || items.length === 0) {
      res.status(400).json({ success: false, error: 'Missing required order details' });
      return;
    }

    let subtotal = 0;
    const orderItemsData = [];

    for (const item of items) {
      const product = await prisma.product.findUnique({ where: { id: item.productId } });
      if (!product || product.isMarkToDelete || !product.isActive) {
        res.status(400).json({ success: false, error: `Product ID ${item.productId} is unavailable` });
        return;
      }
      if (product.stockQuantity < item.quantity) {
        res.status(400).json({ success: false, error: `Insufficient stock for product ${product.name}` });
        return;
      }

      const unitPrice = product.discountPrice || product.price;
      const itemSubtotal = unitPrice * item.quantity;
      subtotal += itemSubtotal;

      orderItemsData.push({
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        unitPrice,
        subtotal: itemSubtotal
      });

      // Reduce product stock quantity
      await prisma.product.update({
        where: { id: product.id },
        data: { stockQuantity: product.stockQuantity - item.quantity }
      });
    }

    const shippingFee = subtotal > 50 ? 0 : 5.99;
    const discount = 0;
    const total = subtotal + shippingFee - discount;
    const orderNumber = generateOrderNumber();

    const order = await prisma.order.create({
      data: {
        orderNumber,
        userId: userId || null,
        guestSessionId: userId ? null : guestSessionId,
        customerName,
        email,
        phone,
        shippingAddress: typeof shippingAddress === 'object' ? JSON.stringify(shippingAddress) : shippingAddress,
        subtotal,
        shippingFee,
        discount,
        total,
        paymentMethod,
        status: 'PENDING',
        items: {
          create: orderItemsData
        }
      },
      include: { items: true }
    });

    // Clear cart if applicable
    if (userId) {
      await prisma.cart.deleteMany({ where: { userId } });
    } else if (guestSessionId) {
      await prisma.cart.deleteMany({ where: { guestSessionId } });
    }

    // Trigger automated order confirmation notifications
    await notificationService.notifyOrderStatusChange(order, 'PENDING');

    res.status(201).json({
      success: true,
      data: order,
      message: 'Order placed successfully'
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/v1/orders/track - Public delivery tracking
router.get('/track', async (req: express.Request, res: Response) => {
  try {
    const { orderNumber, email } = req.query;
    if (!orderNumber || !email) {
      res.status(400).json({ success: false, error: 'Order number and email required' });
      return;
    }

    const inputOrderNum = (orderNumber as string).trim();
    const cleanOrderNum = inputOrderNum.replace(/^#/, '').trim();
    const cleanEmail = (email as string).trim().toLowerCase();

    // Generate possible orderNumber format variations
    const possibleOrderNumbers = Array.from(new Set([
      inputOrderNum,
      cleanOrderNum,
      `#${cleanOrderNum}`,
      cleanOrderNum.startsWith('BEA-') ? cleanOrderNum : `BEA-${cleanOrderNum}`
    ]));

    // Query candidate orders by order number variations
    const candidateOrders = await prisma.order.findMany({
      where: {
        orderNumber: {
          in: possibleOrderNumbers
        },
        isMarkToDelete: false
      },
      include: {
        items: true
      }
    });

    // Match email case-insensitively
    const order = candidateOrders.find(o => o.email.trim().toLowerCase() === cleanEmail);

    if (!order) {
      res.status(404).json({ success: false, error: 'Order not found with provided credentials' });
      return;
    }

    // Define timeline steps for tracking
    const timeline = [
      { status: 'PENDING', label: 'Order Placed', timestamp: order.createdAt, completed: true },
      { status: 'CONFIRMED', label: 'Order Confirmed', timestamp: order.updatedAt, completed: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.status) },
      { status: 'PROCESSING', label: 'Processing', timestamp: order.updatedAt, completed: ['PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.status) },
      { status: 'SHIPPED', label: 'Shipped', timestamp: order.shippedAt, completed: ['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.status) },
      { status: 'OUT_FOR_DELIVERY', label: 'Out for Delivery', timestamp: order.updatedAt, completed: ['OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.status) },
      { status: 'DELIVERED', label: 'Delivered', timestamp: order.deliveredAt, completed: order.status === 'DELIVERED' }
    ];

    res.json({
      success: true,
      data: {
        order,
        timeline
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/v1/orders/my-orders - Authenticated user order history
router.get('/my-orders', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const orders = await prisma.order.findMany({
      where: { userId, isMarkToDelete: false },
      include: { items: true },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: orders });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/v1/orders - Admin list all orders with search & status filters
router.get('/', authenticate, requireRole(['SUPER_ADMIN', 'ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, search, dateFrom, dateTo, page = '1', limit = '10' } = req.query;

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(limit as string, 10) || 10;
    const skip = (pageNum - 1) * limitNum;

    const where: any = { isMarkToDelete: false };

    if (status) {
      where.status = status as any;
    }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search as string } },
        { customerName: { contains: search as string } },
        { email: { contains: search as string } }
      ];
    }

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom as string);
      if (dateTo) where.createdAt.lte = new Date(dateTo as string);
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum
      }),
      prisma.order.count({ where })
    ]);

    res.json({
      success: true,
      data: orders,
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

// PUT /api/v1/orders/:id/status - Admin status update (mandatory trackingNumber & carrier when SHIPPED)
router.put('/:id/status', authenticate, requireRole(['SUPER_ADMIN', 'ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { status, trackingNumber, shippingCarrier } = req.body;

    if (!status) {
      res.status(400).json({ success: false, error: 'Order status is required' });
      return;
    }

    if (status === 'SHIPPED' && (!trackingNumber || !shippingCarrier)) {
      res.status(400).json({
        success: false,
        error: 'Tracking number and shipping carrier are mandatory when marking order as SHIPPED'
      });
      return;
    }

    const updateData: any = { status, updatedAt: new Date() };

    if (['PENDING', 'CONFIRMED', 'PROCESSING', 'CANCELLED'].includes(status)) {
      updateData.trackingNumber = null;
      updateData.shippingCarrier = null;
      updateData.shippedAt = null;
    } else if (status === 'SHIPPED' || status === 'OUT_FOR_DELIVERY') {
      if (trackingNumber) updateData.trackingNumber = trackingNumber;
      if (shippingCarrier) updateData.shippingCarrier = shippingCarrier;
      updateData.shippedAt = new Date();
    }

    if (status === 'DELIVERED') {
      updateData.deliveredAt = new Date();
      updateData.paymentStatus = 'PAID';
    }

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: updateData,
      include: { items: true }
    });

    // Automatically trigger notification to customer
    await notificationService.notifyOrderStatusChange(updatedOrder, status);

    res.json({
      success: true,
      data: updatedOrder,
      message: `Order status updated to ${status}`
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/v1/orders/:id - Soft delete order (Admin)
router.delete('/:id', authenticate, requireRole(['SUPER_ADMIN', 'ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    await prisma.order.update({
      where: { id },
      data: { isMarkToDelete: true }
    });

    res.json({ success: true, message: 'Order deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
