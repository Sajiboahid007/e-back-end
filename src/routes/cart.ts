import express, { Response } from 'express';
import { prisma } from '../utils/prisma.js';
import { optionalAuthenticate, AuthenticatedRequest } from '../middleware/auth.js';
import { storageService } from '../services/storage.service.js';

const router = express.Router();

// Helper to get or create cart
const getOrCreateCart = async (userId?: number, guestSessionId?: string) => {
  if (userId) {
    let cart = await prisma.cart.findFirst({
      where: { userId },
      include: {
        items: {
          include: {
            product: {
              include: { images: true }
            }
          }
        }
      }
    });
    if (!cart) {
      cart = await prisma.cart.create({
        data: { userId },
        include: {
          items: {
            include: {
              product: {
                include: { images: true }
              }
            }
          }
        }
      });
    }
    return cart;
  } else if (guestSessionId) {
    let cart = await prisma.cart.findFirst({
      where: { guestSessionId },
      include: {
        items: {
          include: {
            product: {
              include: { images: true }
            }
          }
        }
      }
    });
    if (!cart) {
      cart = await prisma.cart.create({
        data: { guestSessionId },
        include: {
          items: {
            include: {
              product: {
                include: { images: true }
              }
            }
          }
        }
      });
    }
    return cart;
  }
  throw new Error('Either userId or guestSessionId must be provided');
};

// GET /api/v1/cart - Get active cart
router.get('/', optionalAuthenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const guestSessionId = req.query.guestSessionId as string;

    if (!userId && !guestSessionId) {
      res.json({ success: true, data: { items: [], subtotal: 0, totalItems: 0 } });
      return;
    }

    const cart = await getOrCreateCart(userId, guestSessionId);

    const formattedItems = cart.items.map((item: any) => {
      const primaryImg = item.product.images.find((img: any) => img.isPrimary) || item.product.images[0];
      return {
        id: item.id,
        productId: item.productId,
        name: item.product.name,
        slug: item.product.slug,
        price: item.product.discountPrice || item.product.price,
        originalPrice: item.product.price,
        quantity: item.quantity,
        subtotal: (item.product.discountPrice || item.product.price) * item.quantity,
        imageUrl: primaryImg ? storageService.getUrl(primaryImg.filePath) : null
      };
    });

    const subtotal = formattedItems.reduce((sum: any, item: any) => sum + item.subtotal, 0);
    const totalItems = formattedItems.reduce((sum: any, item: any) => sum + item.quantity, 0);

    res.json({
      success: true,
      data: {
        id: cart.id,
        items: formattedItems,
        subtotal,
        totalItems
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/v1/cart/items - Add item to cart
router.post('/items', optionalAuthenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { guestSessionId, productId, quantity = 1 } = req.body;

    if (!productId) {
      res.status(400).json({ success: false, error: 'ProductId is required' });
      return;
    }

    const cart = await getOrCreateCart(userId, guestSessionId);

    const existingItem = await prisma.cartItem.findFirst({
      where: { cartId: cart.id, productId: parseInt(productId, 10) }
    });

    if (existingItem) {
      await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: existingItem.quantity + parseInt(quantity, 10) }
      });
    } else {
      await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId: parseInt(productId, 10),
          quantity: parseInt(quantity, 10)
        }
      });
    }

    res.json({ success: true, message: 'Item added to cart' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v1/cart/items/:id - Update item quantity
router.put('/items/:id', optionalAuthenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const itemId = Number(req.params.id);
    const { quantity } = req.body;

    if (quantity <= 0) {
      await prisma.cartItem.deleteMany({ where: { id: itemId } });
    } else {
      await prisma.cartItem.updateMany({
        where: { id: itemId },
        data: { quantity: parseInt(quantity, 10) }
      });
    }

    res.json({ success: true, message: 'Cart item updated' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/v1/cart/items/:id - Remove item
router.delete('/items/:id', optionalAuthenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const itemId = Number(req.params.id);
    await prisma.cartItem.deleteMany({ where: { id: itemId } });
    res.json({ success: true, message: 'Cart item removed' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/v1/cart/merge - Merge guest cart into user cart upon login
router.post('/merge', optionalAuthenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { guestSessionId } = req.body;

    if (!userId || !guestSessionId) {
      res.status(400).json({ success: false, error: 'User login and guestSessionId required' });
      return;
    }

    const guestCart = await prisma.cart.findFirst({
      where: { guestSessionId },
      include: { items: true }
    });

    if (guestCart && guestCart.items.length > 0) {
      const userCart = await getOrCreateCart(userId);

      for (const item of guestCart.items) {
        const existing = await prisma.cartItem.findFirst({
          where: { cartId: userCart.id, productId: item.productId }
        });

        if (existing) {
          await prisma.cartItem.update({
            where: { id: existing.id },
            data: { quantity: existing.quantity + item.quantity }
          });
        } else {
          await prisma.cartItem.create({
            data: {
              cartId: userCart.id,
              productId: item.productId,
              quantity: item.quantity
            }
          });
        }
      }

      await prisma.cart.delete({ where: { id: guestCart.id } });
    }

    res.json({ success: true, message: 'Guest cart merged successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
