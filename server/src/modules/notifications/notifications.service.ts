import { Notification, type NotificationType } from './notification.model';
import { notifyInAppNotification } from '../../websocket';

export async function listForUser(params: {
  userId: string;
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
}) {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(Math.max(1, params.limit ?? 30), 100);
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = { toUser: params.userId };
  if (params.unreadOnly) filter.readAt = null;

  const [data, total] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
  ]);

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function unreadCount(userId: string): Promise<number> {
  return Notification.countDocuments({ toUser: userId, readAt: null });
}

export async function markRead(notificationId: string, userId: string) {
  return Notification.findOneAndUpdate(
    { _id: notificationId, toUser: userId },
    { $set: { readAt: new Date() } },
    { new: true }
  ).lean();
}

export async function markAllRead(userId: string) {
  const res = await Notification.updateMany(
    { toUser: userId, readAt: null },
    { $set: { readAt: new Date() } }
  );
  return { updated: res.modifiedCount ?? 0 };
}

export async function createNotification(params: {
  toUser: string;
  type: NotificationType;
  title: string;
  body?: string;
  url?: string;
  meta?: Record<string, unknown>;
}) {
  const doc = await Notification.create({
    toUser: params.toUser,
    type: params.type,
    title: params.title,
    body: params.body ?? '',
    url: params.url ?? '',
    meta: params.meta,
  });
  const payload = doc.toObject();
  notifyInAppNotification(params.toUser, payload as unknown as Record<string, unknown>);
  return payload;
}

