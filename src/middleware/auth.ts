import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { AuthenticatedRequest } from '../interfaces/index.js';
export { AuthenticatedRequest };


export const authenticate = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Unauthorized access: No token provided' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { id: number; email: string; role: 'SUPER_ADMIN' | 'ADMIN' | 'CUSTOMER' };
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ success: false, error: 'Unauthorized access: Invalid or expired token' });
  }
};

export const optionalAuthenticate = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { id: number; email: string; role: 'SUPER_ADMIN' | 'ADMIN' | 'CUSTOMER' };
      req.user = decoded;
    } catch {
      // Ignore token verification errors for optional auth
    }
  }
  next();
};

export const requireRole = (allowedRoles: Array<'SUPER_ADMIN' | 'ADMIN' | 'CUSTOMER'>) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Unauthorized access' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: 'Forbidden: Insufficient privileges' });
      return;
    }

    next();
  };
};
