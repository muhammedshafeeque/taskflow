import { authLimiter } from '../../../middleware/rateLimit';
import { Router } from 'express';
import { customerAuthMiddleware } from '../middleware/customerAuth.middleware';
import * as customerAuthController from './customerAuth.controller';

const router = Router();

// Public routes
router.post('/forgot-password', authLimiter, ...customerAuthController.forgotPassword);
router.post('/reset-password', authLimiter, ...customerAuthController.resetPassword);

// Protected routes
router.get('/me', customerAuthMiddleware, ...customerAuthController.getMe);
router.patch('/me', customerAuthMiddleware, ...customerAuthController.updateMe);
router.patch('/change-password', customerAuthMiddleware, ...customerAuthController.changePassword);

export const customerAuthRoutes = router;
