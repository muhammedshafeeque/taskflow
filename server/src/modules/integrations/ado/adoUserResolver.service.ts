import mongoose from 'mongoose';
import { User } from '../../auth/user.model';
import { Role } from '../../roles/role.model';
import { mergeTaskflowPermissionFloor } from '../../auth/permissionMerge';
import { resolveEffectiveGlobalPermissions } from '../../auth/effectivePermissions';
import { parseIdentityDisplayName, parseIdentityEmail } from './adoClient.service';
import * as projectInvitationsService from '../../projects/projectInvitations.service';

async function defaultRoleId(): Promise<mongoose.Types.ObjectId | undefined> {
  const role =
    (await Role.findOne({ code: 'developer' }).select('_id').lean()) ||
    (await Role.findOne({ code: 'viewer' }).select('_id').lean()) ||
    (await Role.findOne({ name: 'Developer' }).select('_id').lean());
  return role?._id as mongoose.Types.ObjectId | undefined;
}

function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || email;
}

/**
 * Resolves ADO assignee to a Taskflow user id.
 * Creates a silent local user (no invite email/password) when missing.
 */
export async function resolveOrCreateAssigneeFromAdo(
  assignedToField: unknown,
  projectId?: string
): Promise<string | undefined> {
  const email = parseIdentityEmail(assignedToField);
  if (!email) return undefined;

  let user = await User.findOne({ email }).select('_id enabled').lean();
  if (user?._id) {
    if (user.enabled === false) return undefined;
    const userId = String(user._id);
    if (projectId) {
      await projectInvitationsService.ensureUserIsDefaultProjectMember(projectId, userId).catch(() => {});
    }
    return userId;
  }

  const displayName = parseIdentityDisplayName(assignedToField);
  const name = displayName || nameFromEmail(email);
  const roleId = await defaultRoleId();
  const rolePerms = roleId ? ((await Role.findById(roleId).select('permissions').lean())?.permissions ?? []) : [];
  const permissions = mergeTaskflowPermissionFloor(
    resolveEffectiveGlobalPermissions({
      rolePermissions: Array.isArray(rolePerms) ? rolePerms : [],
      role: 'user',
      mustChangePassword: false,
      permissionOverrides: null,
    })
  );

  const created = await User.create({
    email,
    name,
    password: null,
    role: 'user',
    roleId: roleId ?? null,
    mustChangePassword: false,
    enabled: true,
    permissions,
  });

  const userId = String(created._id);
  if (projectId) {
    await projectInvitationsService.ensureUserIsDefaultProjectMember(projectId, userId).catch(() => {});
  }
  return userId;
}
