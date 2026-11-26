import { roleTreePermissions } from '../auth/accessProfile';
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { Role } from '../roles/role.model';
import { mergeTaskflowPermissionFloor } from '../auth/permissionMerge';
import { assertCanAssignRole, type GrantActor } from '../auth/grantGuard';
import { logAudit } from '../auditLogs/logAudit';
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
  actor: GrantActor
) {
  const userId = actor.id;
  const $set: Record<string, unknown> = {};
  if (input.defaultRoleId !== undefined) {
    if (input.defaultRoleId) {
      const role = mongoose.Types.ObjectId.isValid(input.defaultRoleId) ? await Role.findById(input.defaultRoleId).select('name permissions').lean() : null;
      if (!role) throw new ApiError(400, 'Role not found');
      // Everyone who signs up gets it, so it counts as giving it out.
      if (String(input.defaultRoleId) !== (await load()).defaultRoleId) assertCanAssignRole(actor, { name: role.name, permissions: await roleTreePermissions([role._id]) }, { defaultRole: true });
      $set.defaultRoleId = new mongoose.Types.ObjectId(input.defaultRoleId);
    } else $set.defaultRoleId = null;
  }
  if (typeof input.requireTwoFactor === 'boolean') $set.requireTwoFactor = input.requireTwoFactor;
  if (userId && mongoose.Types.ObjectId.isValid(userId)) $set.updatedBy = new mongoose.Types.ObjectId(userId);
  await PlatformSettings.updateOne({ key: 'default' }, { $set, $setOnInsert: { key: 'default' } }, { upsert: true });
  logAudit({ userId, action: 'platform.settings.update', resourceType: 'platform', meta: { ...input } });
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
    permissions: mergeTaskflowPermissionFloor(await roleTreePermissions([defaultRoleId])),
  };
}
