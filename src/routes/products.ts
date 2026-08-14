import express, { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { storageService } from '../services/storage.service';

const router = express.Router();

const slugify = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

// GET /api/v1/products - Faceted product listing with counts and filters
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      category,
      type,
      skinNeed,
      brand,
      minPrice,
      maxPrice,
      rating,
      isFeatured,
      isActive,
      search,
      sort,
      page = '1',
      limit = '12'
    } = req.query;

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(limit as string, 10) || 12;
    const skip = (pageNum - 1) * limitNum;

    // Build Prisma query condition
    const where: any = { isMarkToDelete: false };

    if (isActive === 'all') {
      // Admin view: include all products regardless of isActive state
    } else if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    } else {
      where.isActive = true; // default public search shows active only
    }

    if (isFeatured === 'true') {
      where.isFeatured = true;
    }

    if (search) {
      where.OR = [
        { name: { contains: search as string } },
        { brand: { contains: search as string } },
        { description: { contains: search as string } }
      ];
    }

    if (brand) {
      const brandArr = (brand as string).split(',').map((b) => b.trim());
      where.brand = { in: brandArr };
    }

    if (minPrice || maxPrice) {
      where.price = {};
      if (minPrice) where.price.gte = parseFloat(minPrice as string);
      if (maxPrice) where.price.lte = parseFloat(maxPrice as string);
    }

    if (rating) {
      where.rating = { gte: parseFloat(rating as string) };
    }

    // Category / Type / Skin Need slug matching
    let mainCatObj: any = null;
    if (category) {
      mainCatObj = await prisma.category.findFirst({
        where: {
          OR: [
            { slug: category as string },
            { name: { contains: category as string } }
          ],
          isMarkToDelete: false
        },
        include: {
          children: {
            where: { isMarkToDelete: false }
          }
        }
      });
      if (mainCatObj) {
        const catIds = [mainCatObj.id, ...(mainCatObj.children ? mainCatObj.children.map((c: any) => c.id) : [])];
        where.AND = where.AND || [];
        where.AND.push({
          OR: [
            { categoryId: { in: catIds } },
            { typeId: { in: catIds } },
            { skinNeedId: { in: catIds } }
          ]
        });
      } else {
        where.categoryId = -1;
      }
    }

    const typeQuery = (type || req.query.subCategory) as string;
    if (typeQuery) {
      let typeObj: any = null;
      if (mainCatObj) {
        typeObj = await prisma.category.findFirst({
          where: {
            parentId: mainCatObj.id,
            OR: [
              { slug: typeQuery },
              { name: { contains: typeQuery } }
            ],
            isMarkToDelete: false
          }
        });
      }
      if (!typeObj) {
        typeObj = await prisma.category.findFirst({
          where: {
            OR: [
              { slug: typeQuery },
              { name: { contains: typeQuery } }
            ],
            isMarkToDelete: false
          }
        });
      }

      if (typeObj) {
        where.AND = where.AND || [];
        where.AND.push({
          OR: [
            { typeId: typeObj.id },
            { skinNeedId: typeObj.id },
            { categoryId: typeObj.id }
          ]
        });
      } else {
        where.typeId = -1;
      }
    }

    if (skinNeed) {
      const skinObj = await prisma.category.findFirst({
        where: {
          OR: [
            { slug: skinNeed as string },
            { name: { contains: skinNeed as string } }
          ],
          isMarkToDelete: false
        }
      });
      if (skinObj) {
        where.skinNeedId = skinObj.id;
      }
    }

    // Sorting strategy
    let orderBy: any = { createdAt: 'desc' };
    if (sort === 'price_asc') orderBy = { price: 'asc' };
    if (sort === 'price_desc') orderBy = { price: 'desc' };
    if (sort === 'rating') orderBy = { rating: 'desc' };
    if (sort === 'popular') orderBy = { reviewCount: 'desc' };

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          category: true,
          type: true,
          skinNeed: true,
          images: { orderBy: { sortOrder: 'asc' } }
        },
        orderBy,
        skip,
        take: limitNum
      }),
      prisma.product.count({ where })
    ]);

    // Attach full static image URLs
    const formattedProducts = products.map((p: any) => ({
      ...p,
      images: p.images.map((img: any) => ({
        ...img,
        url: storageService.getUrl(img.filePath)
      }))
    }));

    // Inline product counts per filter options (Faceted count logic)
    const categoryCounts = await prisma.product.groupBy({
      by: ['categoryId'],
      _count: { id: true },
      where: { isMarkToDelete: false, isActive: true }
    });

    const typeCounts = await prisma.product.groupBy({
      by: ['typeId'],
      _count: { id: true },
      where: { isMarkToDelete: false, isActive: true, typeId: { not: null } }
    });

    const brandCounts = await prisma.product.groupBy({
      by: ['brand'],
      _count: { id: true },
      where: { isMarkToDelete: false, isActive: true }
    });

    res.json({
      success: true,
      data: formattedProducts,
      facets: {
        categoryCounts,
        typeCounts,
        brandCounts
      },
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

// GET /api/v1/products/:slug - Get single product details
router.get('/:slug', async (req: Request, res: Response) => {
  try {
    const slugParam = req.params.slug as string;
    const product = (await prisma.product.findFirst({
      where: {
        OR: [{ slug: slugParam }, { sku: slugParam }],
        isMarkToDelete: false
      },
      include: {
        category: true,
        type: true,
        skinNeed: true,
        images: { orderBy: { sortOrder: 'asc' } },
        reviews: { include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } }
      }
    })) as any;

    if (!product) {
      res.status(404).json({ success: false, error: 'Product not found' });
      return;
    }

    const formattedProduct = {
      ...product,
      images: product.images.map((img: any) => ({
        ...img,
        url: storageService.getUrl(img.filePath)
      }))
    };

    res.json({ success: true, data: formattedProduct });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/v1/products - Create product with image uploads (Admin)
router.post('/', authenticate, requireRole(['SUPER_ADMIN', 'ADMIN']), upload.array('images', 5), async (req: any, res: Response) => {
  try {
    const {
      name,
      description,
      brand,
      categoryId,
      typeId,
      skinNeedId,
      price,
      discountPrice,
      stockQuantity,
      sku,
      ingredients,
      howToUse,
      isFeatured,
      isActive
    } = req.body;

    const baseSlug = slugify(name);
    const skuCode = sku || `SKU-${Date.now()}`;

    const product = await prisma.product.create({
      data: {
        name,
        slug: `${baseSlug}-${Date.now().toString().slice(-4)}`,
        description,
        brand,
        categoryId: parseInt(categoryId, 10),
        typeId: typeId ? parseInt(typeId, 10) : null,
        skinNeedId: skinNeedId ? parseInt(skinNeedId, 10) : null,
        price: parseFloat(price),
        discountPrice: discountPrice ? parseFloat(discountPrice) : null,
        stockQuantity: parseInt(stockQuantity || '0', 10),
        sku: skuCode,
        ingredients,
        howToUse,
        isFeatured: isFeatured === 'true' || isFeatured === true,
        isActive: isActive !== 'false' && isActive !== false
      }
    });

    // Handle local image uploads under /uploads/products/{productId}/
    const files = req.files as Express.Multer.File[];
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileName = `${Date.now()}-${i}${path.extname(file.originalname)}`;
        const filePath = await storageService.saveFile(file.buffer, fileName, `products/${product.id}`);

        await prisma.productImage.create({
          data: {
            productId: product.id,
            filePath,
            isPrimary: i === 0,
            sortOrder: i
          }
        });
      }
    }

    res.status(201).json({
      success: true,
      data: product,
      message: 'Product created successfully'
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v1/products/:id - Update product (Admin)
router.put('/:id', authenticate, requireRole(['SUPER_ADMIN', 'ADMIN']), upload.array('images', 5), async (req: any, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const {
      name,
      description,
      brand,
      categoryId,
      typeId,
      skinNeedId,
      price,
      discountPrice,
      stockQuantity,
      sku,
      ingredients,
      howToUse,
      isFeatured,
      isActive
    } = req.body;

    const product = await prisma.product.update({
      where: { id },
      data: {
        name,
        description,
        brand,
        categoryId: categoryId ? parseInt(categoryId, 10) : undefined,
        typeId: typeId ? parseInt(typeId, 10) : null,
        skinNeedId: skinNeedId ? parseInt(skinNeedId, 10) : null,
        price: price ? parseFloat(price) : undefined,
        discountPrice: discountPrice ? parseFloat(discountPrice) : null,
        stockQuantity: stockQuantity !== undefined ? parseInt(stockQuantity, 10) : undefined,
        sku,
        ingredients,
        howToUse,
        isFeatured: isFeatured !== undefined ? isFeatured === 'true' || isFeatured === true : undefined,
        isActive: isActive !== undefined ? isActive === 'true' || isActive === true : undefined
      }
    });

    const files = req.files as Express.Multer.File[];
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileName = `${Date.now()}-${i}${path.extname(file.originalname)}`;
        const filePath = await storageService.saveFile(file.buffer, fileName, `products/${product.id}`);

        await prisma.productImage.create({
          data: {
            productId: product.id,
            filePath,
            isPrimary: false,
            sortOrder: i
          }
        });
      }
    }

    res.json({
      success: true,
      data: product,
      message: 'Product updated successfully'
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/v1/products/:id - Soft delete product (Admin)
router.delete('/:id', authenticate, requireRole(['SUPER_ADMIN', 'ADMIN']), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    await prisma.product.update({
      where: { id },
      data: { isMarkToDelete: true }
    });

    res.json({ success: true, message: 'Product deleted' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

import path from 'path';
export default router;
