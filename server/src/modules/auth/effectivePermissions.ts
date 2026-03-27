import { PERMISSION_CODES } from '../../constants/permissions';

/**
 * Resolve global permissions from role payload and user type.
 * Admin users fall back to full permission set when role permissions are empty.
 */
export function resolveEffectiveGlobalPermissions(input: {
  rolePermissions?: string[] | null;
  role: 'user' | 'admin';
  mustChangePassword?: boolean;
}): string[] {
  const basePermissions = Array.isArray(input.rolePermissions) ? [...input.rolePermissions] : [];
  const withAdminFallback =
    basePermissions.length === 0 && input.role === 'admin' ? [...PERMISSION_CODES] : basePermissions;

  if (input.mustChangePassword && withAdminFallback.includes('projects:create')) {
    return withAdminFallback.filter((p) => p !== 'projects:create');
  }
  return withAdminFallback;
}
