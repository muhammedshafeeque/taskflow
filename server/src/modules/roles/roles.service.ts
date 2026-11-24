import { Role } from './role.model';
import { ApiError } from '../../utils/ApiError';
import { isValidPermission, PERMISSION_CODES } from '../../constants/permissions';
import { User } from '../auth/user.model';
import { assertCanGrant, type GrantActor } from '../auth/grantGuard';
import { logAudit } from '../auditLogs/logAudit';
import { ProjectMember } from '../projects/projectMember.model';
import type { CreateRoleBody, UpdateRoleBody } from './roles.validation';

export async function findAll() {
  return Role.find().lean();
}

export async function findById(id: string) {
  const role = await Role.findById(id).lean();
  return role ?? null;
}

function validatePermissions(permissions: string[]): void {
  const invalid = permissions.filter((p) => !isValidPermission(p));
  if (invalid.length > 0) {
    throw new ApiError(400, `Invalid permission(s): ${invalid.join(', ')}. Must be from the predefined list.`);
  }
}

export async function create(input: CreateRoleBody, actor: GrantActor) {
  validatePermissions(input.permissions);
  assertCanGrant(actor, input.permissions, { role: input.name });
  const role = await Role.create({ name: input.name, permissions: input.permissions });
  logAudit({ userId: actor.id, action: 'role.create', resourceType: 'role', resourceId: String(role._id), meta: { name: role.name, permissions: role.permissions } });
  return role.toObject();
}

export async function update(id: string, input: UpdateRoleBody, actor: GrantActor) {
  const before = await Role.findById(id).lean();
  if (!before) return null;
  const had = before.permissions ?? [];
  const next = input.permissions ?? had;
  const added = next.filter((p) => !had.includes(p));
  if (input.permissions !== undefined) {
    validatePermissions(input.permissions);
    assertCanGrant(actor, added, { roleId: id });
  }
  const role = await Role.findByIdAndUpdate(id, { $set: input }, { new: true, runValidators: true }).lean();
  logAudit({
    userId: actor.id,
    action: 'role.update',
    resourceType: 'role',
    resourceId: id,
    meta: { name: input.name ?? before.name, added, removed: had.filter((p) => !next.includes(p)) },
  });
  return role ?? null;
}

export async function remove(id: string, actor: GrantActor) {
  const inUseByUser = await User.exists({ roleId: id });
  const inUseByMember = await ProjectMember.exists({ role: id });
  if (inUseByUser || inUseByMember) {
    throw new ApiError(400, 'Cannot delete role that is assigned to users or project members. Reassign them first.');
  }
  const result = await Role.findByIdAndDelete(id);
  if (result) logAudit({ userId: actor.id, action: 'role.delete', resourceType: 'role', resourceId: id, meta: { name: result.name } });
  return result != null;
}

export function getAllPermissionCodes() {
  return PERMISSION_CODES;
}
