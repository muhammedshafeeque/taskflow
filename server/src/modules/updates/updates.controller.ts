import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { ApiError } from '../../utils/ApiError';
import { User } from '../auth/user.model';
import { AppUpdate, UserUpdateAcknowledgement } from './appUpdate.model';

export const acknowledgeUpdatesSchema = z.object({
  updateIds: z.array(z.string().trim().min(1, 'updateId must not be empty')).min(1, 'At least one updateId is required').max(500),
});

export async function getUnseenUpdates(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    throw new ApiError(401, 'Authentication required');
  }
  const userOid = new mongoose.Types.ObjectId(userId);

  const [user, acks] = await Promise.all([
    User.findById(userOid).select('createdAt').lean(),
    UserUpdateAcknowledgement.find({ userId: userOid }).select('updateId').lean(),
  ]);

  if (!user) {
    throw new ApiError(401, 'User not found');
  }

  const ackedIds = acks.map((a) => a.updateId);
  const filter: Record<string, unknown> = {};
  if (user.createdAt) {
    filter.createdAt = { $gt: user.createdAt };
  }
  if (ackedIds.length > 0) {
    filter.updateId = { $nin: ackedIds };
  }

  const updates = await AppUpdate.find(filter)
    .select('updateId date type title details createdAt updatedAt')
    .sort({ date: -1, createdAt: -1, updateId: -1 })
    .lean();

  res.json({ success: true, data: updates });
}

export async function listAllUpdates(_req: Request, res: Response): Promise<void> {
  const updates = await AppUpdate.find({})
    .select('updateId date type title details createdAt updatedAt')
    .sort({ date: -1, createdAt: -1, updateId: -1 })
    .lean();

  res.json({ success: true, data: updates });
}

export async function acknowledgeUpdates(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    throw new ApiError(401, 'Authentication required');
  }
  const userOid = new mongoose.Types.ObjectId(userId);

  const body = req.body as z.infer<typeof acknowledgeUpdatesSchema>;
  const uniqueIds = Array.from(new Set(body.updateIds));

  const existing = await AppUpdate.find({ updateId: { $in: uniqueIds } }).select('updateId').lean();
  const existingSet = new Set(existing.map((u) => u.updateId));
  const missing = uniqueIds.filter((id) => !existingSet.has(id));
  if (missing.length > 0) {
    throw new ApiError(400, `Unknown updateIds: ${missing.join(', ')}`);
  }

  const now = new Date();
  await UserUpdateAcknowledgement.bulkWrite(
    uniqueIds.map((updateId) => ({
      updateOne: {
        filter: { userId: userOid, updateId },
        update: { $setOnInsert: { userId: userOid, updateId, acknowledgedAt: now } },
        upsert: true,
      },
    })),
    { ordered: false }
  );

  res.json({ success: true, data: { acknowledged: uniqueIds } });
}
