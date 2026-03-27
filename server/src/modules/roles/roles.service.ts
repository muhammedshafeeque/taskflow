import { Role } from './role.model';
import { ApiError } from '../../utils/ApiError';
import { isValidPermission, PERMISSION_CODES } from '../../constants/permissions';
import { User } from '../auth/user.model';
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

export async function create(input: CreateRoleBody) {
  validatePermissions(input.permissions);
  const role = await Role.create({ name: input.name, permissions: input.permissions });
  return role.toObject();
}

export async function update(id: string, input: UpdateRoleBody) {
  if (input.permissions !== undefined) {
    validatePermissions(input.permissions);
  }
  const role = await Role.findByIdAndUpdate(id, { $set: input }, { new: true, runValidators: true }).lean();
  return role ?? null;
}

export async function remove(id: string) {
  const inUseByUser = await User.exists({ roleId: id });
  const inUseByMember = await ProjectMember.exists({ role: id });
  if (inUseByUser || inUseByMember) {
    throw new ApiError(400, 'Cannot delete role that is assigned to users or project members. Reassign them first.');
  }
  const result = await Role.findByIdAndDelete(id);
  return result != null;
}

export function getAllPermissionCodes() {
  return PERMISSION_CODES;
}
