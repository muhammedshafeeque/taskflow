import { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError';
import * as notificationsService from './notifications.service';
import * as preferenceService from './notificationPreference.service';

export async function listNotifications(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const page = parseInt(String(req.query.page), 10) || 1;
  const limit = Math.min(parseInt(String(req.query.limit), 10) || 30, 100);
  const unreadOnly = String(req.query.unreadOnly || '').toLowerCase() === 'true';
  const result = await notificationsService.listForUser({ userId, page, limit, unreadOnly });
  res.status(200).json({ success: true, data: result });
}

export async function getUnreadCount(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const count = await notificationsService.unreadCount(userId);
  res.status(200).json({ success: true, data: { unread: count } });
}

export async function markNotificationRead(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const updated = await notificationsService.markRead(req.params.id, userId);
  if (!updated) throw new ApiError(404, 'Notification not found');
  res.status(200).json({ success: true, data: updated });
}

export async function markAllNotificationsRead(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const result = await notificationsService.markAllRead(userId);
  res.status(200).json({ success: true, data: result });
}

export async function deleteNotification(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const deleted = await notificationsService.deleteForUser(req.params.id, userId);
  if (!deleted) throw new ApiError(404, 'Notification not found');
  res.status(200).json({ success: true, data: { deleted: true } });
}

export async function getNotificationPreferences(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const data = await preferenceService.getPreferencesResponse(userId);
  // Channel availability depends on server .env — never serve a stale 304/ETag body.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.status(200).json({ success: true, data });
}

export async function updateNotificationPreferences(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const body = req.body as { matrix?: Array<{ eventKey: string; methods: Record<string, boolean> }> };
  const data = await preferenceService.updateUserPreferences(userId, { matrix: body.matrix ?? [] });
  res.status(200).json({ success: true, data });
}

