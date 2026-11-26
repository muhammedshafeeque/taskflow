import mongoose from 'mongoose';
import { roleTreePermissions, ruleRolesByUser } from './accessProfile';
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
  // Roles that carry it, themselves or through a role they build on.
  const roles = await Role.find().select('_id').lean();
  const roleIds: mongoose.Types.ObjectId[] = [];
  for (const r of roles) {
    const perms = await roleTreePermissions([r._id]);
    if (perms.some((p) => p === permission || prefixes.includes(p))) roleIds.push(r._id as mongoose.Types.ObjectId);
  }
  // People who get one of those roles from their team or level in this workspace.
  const viaRules =
    workspaceId && mongoose.Types.ObjectId.isValid(workspaceId)
      ? [...(await ruleRolesByUser(workspaceId))].filter(([, rs]) => roleIds.some((id) => rs.has(String(id)))).map(([u]) => new mongoose.Types.ObjectId(u))
      : [];
  const users = await User.find({
    enabled: { $ne: false },
    isServiceAccount: { $ne: true },
    'permissionOverrides.revoked': { $ne: permission },
    $or: [{ roleId: { $in: roleIds } }, { _id: { $in: viaRules } }, { 'permissionOverrides.granted': permission }, { role: 'admin' }],
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
