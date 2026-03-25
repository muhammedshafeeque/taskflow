import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  getUnreadCount,
} from './notifications.controller';

const router = Router();

router.use(authMiddleware);

router.get('/', asyncHandler(listNotifications));
router.get('/unread-count', asyncHandler(getUnreadCount));
router.patch('/:id/read', asyncHandler(markNotificationRead));
router.post('/read-all', asyncHandler(markAllNotificationsRead));

export const notificationsRoutes = router;

