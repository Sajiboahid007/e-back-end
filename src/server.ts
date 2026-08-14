import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config/index';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/error';
import { ensureInitialDataSeeded } from './utils/seed-data';

import authRoutes from './routes/auth';
import categoryRoutes from './routes/categories';
import productRoutes from './routes/products';
import cartRoutes from './routes/cart';
import orderRoutes from './routes/orders';
import userRoutes from './routes/users';
import notificationRoutes from './routes/notifications';
import analyticsRoutes from './routes/analytics';
import adminSettingsRoutes from './routes/admin-settings';

const app = express();

// Middlewares
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static images route (/uploads/...)
const uploadPath = path.resolve(process.cwd(), config.uploadDir);
app.use('/uploads', express.static(uploadPath));

// API Routes mounting
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/cart', cartRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/admin-settings', adminSettingsRoutes);

// Health check endpoint
app.get('/api/v1/health', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    service: 'E-Beauty Backend API'
  });
});

// Centralized Error Middleware
app.use(errorHandler);

// Start server
app.listen(config.port, async () => {
  console.log(` E-Beauty Express Server running on port ${config.port}`);
  console.log(` Uploads Directory: ${uploadPath}`);
  console.log(` API Base URL: ${config.baseUrl}/api/v1`);
  await ensureInitialDataSeeded();
});

export default app;
