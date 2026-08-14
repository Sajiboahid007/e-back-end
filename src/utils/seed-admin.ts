import bcrypt from 'bcryptjs';
import { prisma } from './prisma';

export async function ensureSuperAdminExists() {
  try {
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
    } else {
      console.log(`✓ Super Admin account exists: ${existingSuperAdmin.email}`);
    }
  } catch (error) {
    console.error('Failed to auto-seed Super Admin:', error);
  }
}

// Allow direct execution if run via CLI
if (process.argv[1] && process.argv[1].includes('seed-admin')) {
  ensureSuperAdminExists().then(() => process.exit(0));
}

