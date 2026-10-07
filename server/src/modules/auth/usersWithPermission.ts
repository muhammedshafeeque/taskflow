import mongoose from 'mongoose';
import { Role } from '../roles/role.model';
import { User } from './user.model';
import { OrganizationMember } from '../organizations/organizationMember.model';

/**
 * Users who hold a permission through their role or a personal grant — the
 * data-driven way to find approvers/recipients instead of naming a role.
 * Optionally limited to members of a workspace.
 */
export async function usersWithPermission(permission: string, workspaceId?: string | null): Promise<string[]> {
  const prefixes = permission.split('.').map((_, i, parts) => `${parts.slice(0, i).join('.')}${i ? '.' : ''}*`).filter((p) => p !== '*');
  const roleIds = await Role.find({ permissions: { $in: [permission, ...prefixes] } }).distinct('_id');
  const users = await User.find({
    enabled: { $ne: false },
    'permissionOverrides.revoked': { $ne: permission },
    $or: [{ roleId: { $in: roleIds } }, { 'permissionOverrides.granted': permission }, { role: 'admin' }],
  })
    .select('_id')
    .lean();
  let ids = users.map((u) => String(u._id));
  if (workspaceId && mongoose.Types.ObjectId.isValid(workspaceId)) {
    const members = await OrganizationMember.find({ organization: workspaceId, user: { $in: ids }, status: 'active' }).distinct('user');
    const set = new Set(members.map(String));
    ids = ids.filter((id) => set.has(id));
  }
  return ids;
}
