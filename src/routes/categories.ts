import express, { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, requireRole } from '../middleware/auth';

const router = express.Router();

// Helper to generate base slug
const slugify = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

// Helper to generate guaranteed unique slug
const generateUniqueSlug = async (baseName: string, excludeId?: number): Promise<string> => {
  const baseSlug = slugify(baseName) || 'category';
  let uniqueSlug = baseSlug;
  let counter = 1;

  while (true) {
    const existing = await prisma.category.findFirst({
      where: {
        slug: uniqueSlug,
        ...(excludeId ? { id: { not: excludeId } } : {})
      }
    });

    if (!existing) break;

    uniqueSlug = `${baseSlug}-${counter}`;
    counter++;
  }

  return uniqueSlug;
};

// GET /api/v1/categories - Get full hierarchy tree
router.get('/', async (req: Request, res: Response) => {
  try {
    const categories = await prisma.category.findMany({
      where: { parentId: null, isMarkToDelete: false },
      include: {
        children: {
          where: { isMarkToDelete: false },
          include: {
            children: {
              where: { isMarkToDelete: false }
            }
          }
        }
      }
    });

    res.json({
      success: true,
      data: categories
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/v1/categories - Add category/type/skin need node (Admin)
router.post('/', authenticate, requireRole(['SUPER_ADMIN', 'ADMIN']), async (req: any, res: Response) => {
  try {
    const { name, parentId, imageUrl } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ success: false, error: 'Category name is required' });
      return;
    }

    const trimmedName = name.trim();
    const slug = await generateUniqueSlug(trimmedName);

    const category = await prisma.category.create({
      data: {
        name: trimmedName,
        slug,
        parentId: parentId ? parseInt(parentId, 10) : null,
        imageUrl: imageUrl || null
      }
    });

    res.status(201).json({
      success: true,
      data: category,
      message: 'Category node created successfully'
    });
  } catch (error: any) {
    console.error('Category creation error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to create category node' });
  }
});

// PUT /api/v1/categories/:id - Update category node (Admin)
router.put('/:id', authenticate, requireRole(['SUPER_ADMIN', 'ADMIN']), async (req: any, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, parentId, imageUrl } = req.body;

    const updateData: any = {};
    if (name && typeof name === 'string' && name.trim()) {
      const trimmedName = name.trim();
      updateData.name = trimmedName;
      updateData.slug = await generateUniqueSlug(trimmedName, id);
    }
    if (parentId !== undefined) {
      updateData.parentId = parentId ? parseInt(parentId, 10) : null;
    }
    if (imageUrl !== undefined) {
      updateData.imageUrl = imageUrl;
    }

    const category = await prisma.category.update({
      where: { id },
      data: updateData
    });

    res.json({
      success: true,
      data: category,
      message: 'Category node updated'
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/v1/categories/:id - Soft delete category node (Admin)
router.delete('/:id', authenticate, requireRole(['SUPER_ADMIN', 'ADMIN']), async (req: any, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    await prisma.category.update({
      where: { id },
      data: { isMarkToDelete: true }
    });

    res.json({
      success: true,
      message: 'Category node deleted'
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
