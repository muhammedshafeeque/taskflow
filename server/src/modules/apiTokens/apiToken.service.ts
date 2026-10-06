import crypto from 'crypto';
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { ApiToken } from './apiToken.model';

export const API_TOKEN_PREFIX = 'atr_';
const MAX_TOKENS_PER_USER = 20;

function hash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function resolveApiToken(token: string) {
  const doc = await ApiToken.findOne({ tokenHash: hash(token), revokedAt: null }).lean();
  if (!doc) return null;
  if (doc.expiresAt && doc.expiresAt.getTime() < Date.now()) return null;
  // Throttle writes: record usage at most once a minute.
  if (!doc.lastUsedAt || Date.now() - doc.lastUsedAt.getTime() > 60_000) {
    void ApiToken.updateOne({ _id: doc._id }, { $set: { lastUsedAt: new Date() } }).catch(() => undefined);
  }
  return doc;
}

export async function listTokens(userId: string) {
  return ApiToken.find({ userId: new mongoose.Types.ObjectId(userId), revokedAt: null })
    .select('-tokenHash')
    .sort({ createdAt: -1 })
    .lean();
}

export async function createToken(
  userId: string,
  organizationId: string | undefined,
  input: { name?: string; expiresInDays?: number | null }
): Promise<{ token: string; record: Record<string, unknown> }> {
  const name = String(input.name ?? '').trim().slice(0, 80);
  if (!name) throw new ApiError(400, 'Token name is required');
  const active = await ApiToken.countDocuments({ userId, revokedAt: null });
  if (active >= MAX_TOKENS_PER_USER) throw new ApiError(400, `You can have at most ${MAX_TOKENS_PER_USER} active tokens`);
  const days = input.expiresInDays == null ? 90 : Number(input.expiresInDays);
  if (!Number.isFinite(days) || days < 0 || days > 3650) throw new ApiError(400, 'expiresInDays must be between 0 (never) and 3650');

  const token = API_TOKEN_PREFIX + crypto.randomBytes(30).toString('base64url');
  const doc = await ApiToken.create({
    userId,
    organizationId: organizationId && mongoose.Types.ObjectId.isValid(organizationId) ? organizationId : undefined,
    name,
    tokenHash: hash(token),
    prefix: token.slice(0, 10),
    expiresAt: days === 0 ? undefined : new Date(Date.now() + days * 24 * 60 * 60 * 1000),
  });
  const { tokenHash: _omit, ...record } = doc.toObject();
  void _omit;
  return { token, record };
}

export async function revokeToken(userId: string, tokenId: string): Promise<void> {
  const res = await ApiToken.updateOne({ _id: tokenId, userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  if (!res.matchedCount) throw new ApiError(404, 'Token not found');
}
