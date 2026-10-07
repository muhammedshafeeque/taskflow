import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { Role } from '../roles/role.model';
import { mergeTaskflowPermissionFloor } from '../auth/permissionMerge';
import { PlatformSettings } from './platformSettings.model';

let cache: { at: number; value: Awaited<ReturnType<typeof load>> } | null = null;

async function load() {
  const doc = await PlatformSettings.findOne({ key: 'default' }).lean();
  return {
    defaultRoleId: doc?.defaultRoleId ? String(doc.defaultRoleId) : null,
    requireTwoFactor: Boolean(doc?.requireTwoFactor),
  };
}

export async function getPlatformSettings() {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const value = await load();
  cache = { at: Date.now(), value };
  return value;
}

export async function updatePlatformSettings(
  input: { defaultRoleId?: string | null; requireTwoFactor?: boolean },
  userId?: string
) {
  const $set: Record<string, unknown> = {};
  if (input.defaultRoleId !== undefined) {
    if (input.defaultRoleId) {
      if (!mongoose.Types.ObjectId.isValid(input.defaultRoleId) || !(await Role.exists({ _id: input.defaultRoleId }))) {
        throw new ApiError(400, 'Role not found');
      }
      $set.defaultRoleId = new mongoose.Types.ObjectId(input.defaultRoleId);
    } else $set.defaultRoleId = null;
  }
  if (typeof input.requireTwoFactor === 'boolean') $set.requireTwoFactor = input.requireTwoFactor;
  if (userId && mongoose.Types.ObjectId.isValid(userId)) $set.updatedBy = new mongoose.Types.ObjectId(userId);
  await PlatformSettings.updateOne({ key: 'default' }, { $set, $setOnInsert: { key: 'default' } }, { upsert: true });
  cache = null;
  return getPlatformSettings();
}

/**
 * Role + permissions for a user created without an explicit role (signup, SSO,
 * integrations). Comes from the configured default role — never a hard-coded one.
 */
export async function defaultRoleAssignment(): Promise<{ roleId: mongoose.Types.ObjectId | null; permissions: string[] }> {
  const { defaultRoleId } = await getPlatformSettings();
  if (!defaultRoleId) return { roleId: null, permissions: mergeTaskflowPermissionFloor([]) };
  const role = await Role.findById(defaultRoleId).select('permissions').lean();
  if (!role) return { roleId: null, permissions: mergeTaskflowPermissionFloor([]) };
  return {
    roleId: new mongoose.Types.ObjectId(defaultRoleId),
    permissions: mergeTaskflowPermissionFloor((role.permissions as string[]) ?? []),
  };
}
