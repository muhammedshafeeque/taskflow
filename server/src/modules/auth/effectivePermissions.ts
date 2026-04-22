import { ALL_TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import { mapLegacyProjectOrGlobalPermissions } from '../../shared/constants/legacyPermissionMap';

/**
 * Resolve global permissions from role payload, user type, and per-user overrides.
 * Admin users fall back to full TaskFlow permission set when role permissions are empty.
 * Colon-era codes are mapped to dot notation on output.
 */
export function resolveEffectiveGlobalPermissions(input: {
  rolePermissions?: string[] | null;
  role: 'user' | 'admin';
  mustChangePassword?: boolean;
  permissionOverrides?: { granted?: string[]; revoked?: string[] } | null;
}): string[] {
  const basePermissions = Array.isArray(input.rolePermissions) ? [...input.rolePermissions] : [];
  let effective =
    basePermissions.length === 0 && input.role === 'admin'
      ? [...ALL_TASK_FLOW_PERMISSIONS]
      : basePermissions;

  const granted = input.permissionOverrides?.granted ?? [];
  const revoked = input.permissionOverrides?.revoked ?? [];
  if (granted.length > 0) {
    for (const p of granted) {
      if (!effective.includes(p)) effective.push(p);
    }
  }
  if (revoked.length > 0) {
    effective = effective.filter((p) => !revoked.includes(p));
  }

  effective = mapLegacyProjectOrGlobalPermissions(effective);

  if (effective.includes('issue.issue.create') && !effective.includes('auth.user.list')) {
    effective.push('auth.user.list');
  }

  return effective;
}
