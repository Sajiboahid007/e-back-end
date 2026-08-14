import bcrypt from 'bcryptjs';
import { prisma } from './prisma';

export async function ensureInitialDataSeeded() {
  try {
    // 1. Ensure Super Admin user exists
    const existingSuperAdmin = await prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN', isMarkToDelete: false }
    });

    if (!existingSuperAdmin) {
      const passwordHash = await bcrypt.hash('super123', 10);
      await prisma.user.create({
        data: {
          name: 'Super Admin',
          email: 'super@eb.com',
          passwordHash,
          role: 'SUPER_ADMIN',
          isActive: true
        }
      });
      console.log('👑 Auto-seeded default Super Admin account: super@eb.com / super123');
    }

    // 2. Ensure Categories exist (Face, Body, Hair, Hand, etc.)
    const categoryConfigs = [
      { name: 'Face Care', slug: 'face' },
      { name: 'Body Care', slug: 'body' },
      { name: 'Hair Care', slug: 'hair' },
      { name: 'Hand & Nail Care', slug: 'hand' }
    ];

    const categoryMap: Record<string, number> = {};

    for (const catConfig of categoryConfigs) {
      let cat = await prisma.category.findFirst({
        where: { slug: catConfig.slug, isMarkToDelete: false }
      });

      if (!cat) {
        cat = await prisma.category.create({
          data: {
            name: catConfig.name,
            slug: catConfig.slug
          }
        });
        console.log(`📁 Auto-seeded category: ${catConfig.name} (${catConfig.slug})`);
      }
      categoryMap[catConfig.slug] = cat.id;
    }

    // Also seed Skin Need child categories
    const skinNeedConfigs = [
      { name: 'Oily Skin', slug: 'oily', parentSlug: 'face' },
      { name: 'Dry & Hydrating', slug: 'dry', parentSlug: 'face' },
      { name: 'Sensitive Care', slug: 'sensitive', parentSlug: 'face' },
      { name: 'Moisturizing Body', slug: 'moisturizing', parentSlug: 'body' },
      { name: 'Volumizing Hair', slug: 'volumizing', parentSlug: 'hair' }
    ];

    for (const sn of skinNeedConfigs) {
      let snCat = await prisma.category.findFirst({
        where: { slug: sn.slug, isMarkToDelete: false }
      });

      if (!snCat) {
        snCat = await prisma.category.create({
          data: {
            name: sn.name,
            slug: sn.slug,
            parentId: categoryMap[sn.parentSlug] || null
          }
        });
      }
      categoryMap[sn.slug] = snCat.id;
    }

    // 3. Seed Sample Products if products count is low
    const activeProductsCount = await prisma.product.count({
      where: { isMarkToDelete: false }
    });

    if (activeProductsCount < 4) {
      const sampleProducts = [
        {
          name: 'Hyaluronic Acid Hydrating Serum',
          slug: 'hyaluronic-acid-hydrating-serum',
          brand: 'LuxeBeauty',
          description: 'Deep hydration botanical serum infused with triple-weight hyaluronic acid and vitamin B5 for plump, glowing skin.',
          price: 38.00,
          discountPrice: 32.00,
          stockQuantity: 45,
          sku: 'SKU-FACE-001',
          rating: 4.9,
          reviewCount: 28,
          isFeatured: true,
          categorySlug: 'face',
          skinNeedSlug: 'dry',
          imageUrl: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=600&q=80'
        },
        {
          name: 'Niacinamide 10% Pore Refining Essence',
          slug: 'niacinamide-10-pore-refining-essence',
          brand: 'GlowBotanicals',
          description: 'Target oil balance, visible pores, and uneven tone with pure niacinamide and zinc PCA formulation.',
          price: 29.00,
          discountPrice: null,
          stockQuantity: 30,
          sku: 'SKU-FACE-002',
          rating: 4.8,
          reviewCount: 19,
          isFeatured: true,
          categorySlug: 'face',
          skinNeedSlug: 'oily',
          imageUrl: 'https://images.unsplash.com/photo-1608248597263-000796df9c11?auto=format&fit=crop&w=600&q=80'
        },
        {
          name: 'Calming Chamomile Soothing Facial Cream',
          slug: 'calming-chamomile-soothing-facial-cream',
          brand: 'PureCalm',
          description: 'Ultra-gentle restorative moisturizer designed specifically for sensitive skin prone to redness and irritation.',
          price: 34.00,
          discountPrice: 28.50,
          stockQuantity: 50,
          sku: 'SKU-FACE-003',
          rating: 5.0,
          reviewCount: 34,
          isFeatured: false,
          categorySlug: 'face',
          skinNeedSlug: 'sensitive',
          imageUrl: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=600&q=80'
        },
        {
          name: 'Velvet Rose Hydrating Body Lotion',
          slug: 'velvet-rose-hydrating-body-lotion',
          brand: 'LuxeBeauty',
          description: 'Rich velvet texture enriched with organic Damask rose water, shea butter, and sweet almond oil.',
          price: 42.00,
          discountPrice: null,
          stockQuantity: 60,
          sku: 'SKU-BODY-001',
          rating: 4.7,
          reviewCount: 15,
          isFeatured: true,
          categorySlug: 'body',
          skinNeedSlug: 'moisturizing',
          imageUrl: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=600&q=80'
        },
        {
          name: 'Argan & Silk Volumizing Shampoo',
          slug: 'argan-silk-volumizing-shampoo',
          brand: 'SilkHair',
          description: 'Sulfate-free nourishing cleanser that builds airy volume while strengthening strands root-to-tip.',
          price: 26.00,
          discountPrice: 22.00,
          stockQuantity: 40,
          sku: 'SKU-HAIR-001',
          rating: 4.8,
          reviewCount: 42,
          isFeatured: false,
          categorySlug: 'hair',
          skinNeedSlug: 'volumizing',
          imageUrl: 'https://images.unsplash.com/photo-1535585209827-a15fcdbc4c2d?auto=format&fit=crop&w=600&q=80'
        },
        {
          name: 'Shea & Vitamin E Intensive Hand Cream',
          slug: 'shea-vitamin-e-intensive-hand-cream',
          brand: 'LuxeBeauty',
          description: 'Fast-absorbing non-greasy hand therapy balm for deeply hydrated hands and smooth cuticles.',
          price: 18.00,
          discountPrice: null,
          stockQuantity: 75,
          sku: 'SKU-HAND-001',
          rating: 4.9,
          reviewCount: 51,
          isFeatured: false,
          categorySlug: 'hand',
          imageUrl: 'https://images.unsplash.com/photo-1617897903246-719242758050?auto=format&fit=crop&w=600&q=80'
        }
      ];

      for (const p of sampleProducts) {
        const catId = categoryMap[p.categorySlug] || 1;
        const skinId = p.skinNeedSlug ? categoryMap[p.skinNeedSlug] : null;

        const createdProduct = await prisma.product.create({
          data: {
            name: p.name,
            slug: `${p.slug}-${Date.now().toString().slice(-4)}`,
            brand: p.brand,
            description: p.description,
            price: p.price,
            discountPrice: p.discountPrice,
            stockQuantity: p.stockQuantity,
            sku: `${p.sku}-${Date.now().toString().slice(-4)}`,
            rating: p.rating,
            reviewCount: p.reviewCount,
            isFeatured: p.isFeatured,
            isActive: true,
            categoryId: catId,
            skinNeedId: skinId
          }
        });

        // Add primary image URL
        await prisma.productImage.create({
          data: {
            productId: createdProduct.id,
            filePath: p.imageUrl,
            isPrimary: true,
            sortOrder: 0
          }
        });

        console.log(`✨ Auto-seeded product: ${p.name}`);
      }
    }
  } catch (error) {
    console.error('Failed to seed initial data:', error);
  }
}

// Allow direct execution if run via CLI
if (process.argv[1] && process.argv[1].includes('seed-data')) {
  ensureInitialDataSeeded().then(() => process.exit(0));
}
