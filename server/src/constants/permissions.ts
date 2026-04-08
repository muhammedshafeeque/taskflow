/**
 * UI labels for permission pickers (colon-era codes).
 * Runtime checks use dot notation from `@shared/constants/permissions` via isValidPermission.
 */
import { ALL_PERMISSIONS as ALL_DOT_PERMISSIONS } from '../shared/constants/permissions';
import { LEGACY_COLON_TO_DOT, LEGACY_CUSTOMER_COLON_TO_DOT } from '../shared/constants/legacyPermissionMap';

export const GLOBAL_PERMISSIONS = [
  { code: 'inbox:read', label: 'View inbox' },
  { code: 'users:list', label: 'List users' },
  { code: 'users:invite', label: 'Invite (add) user' },
  { code: 'users:edit', label: 'Edit users' },
  { code: 'designations:manage', label: 'Manage designations' },
  { code: 'roles:manage', label: 'Manage roles' },
  { code: 'projects:list', label: 'List projects' },
  { code: 'projects:listAll', label: 'List all projects' },
  { code: 'projects:create', label: 'Create project' },
  { code: 'analytics:view', label: 'View analytics' },
  { code: 'reports:view', label: 'View reports' },
  { code: 'reports:create', label: 'Create reports' },
  { code: 'taskflow.cost_report.view', label: 'View cost report' },
  { code: 'license:view', label: 'View license' },
  { code: 'customers:manage', label: 'Manage customer organizations' },
  { code: 'customers:view', label: 'View customer organizations' },
  { code: 'customer-requests:approve', label: 'Approve / reject customer requests' },
] as const;

export const PROJECT_PERMISSIONS = [
  { code: 'project:view', label: 'View project' },
  { code: 'project:edit', label: 'Edit project' },
  { code: 'project:delete', label: 'Delete project' },
  { code: 'project:manageMembers', label: 'Manage project members' },
  { code: 'issues:view', label: 'View issues' },
  { code: 'issues:create', label: 'Create issues' },
  { code: 'issues:edit', label: 'Edit issues' },
  { code: 'issues:delete', label: 'Delete issues' },
  { code: 'boards:view', label: 'View boards' },
  { code: 'boards:edit', label: 'Edit boards' },
  { code: 'sprints:view', label: 'View sprints' },
  { code: 'sprints:edit', label: 'Edit sprints' },
  { code: 'versions:view', label: 'View versions' },
  { code: 'versions:release', label: 'Release version' },
  { code: 'versions:edit', label: 'Edit versions' },
  { code: 'settings:manage', label: 'Manage project settings' },
  { code: 'roadmaps:view', label: 'View roadmaps' },
  { code: 'roadmaps:edit', label: 'Edit roadmaps' },
  { code: 'testManagement:view', label: 'View test management' },
  { code: 'testManagement:edit', label: 'Edit test management' },
] as const;

/** Combined global + project permission definitions for admin UI (colon codes + labels). */
export const ALL_PERMISSIONS = [...GLOBAL_PERMISSIONS, ...PROJECT_PERMISSIONS];

/** Accept dot-notation and legacy colon codes */
export const PERMISSION_CODES = [...ALL_DOT_PERMISSIONS, ...ALL_PERMISSIONS.map((p) => p.code)] as string[];

export const DEFAULT_PROJECT_MEMBER_PERMISSION_CODES = PROJECT_PERMISSIONS.filter(
  (p) => p.code !== 'settings:manage' && p.code !== 'project:edit' && p.code !== 'project:delete'
).map((p) => p.code);

export const FULL_PROJECT_ROLE_PERMISSION_CODES = PROJECT_PERMISSIONS.map((p) => p.code);

export const CUSTOMER_PERMISSIONS = [
  { code: 'requests:create', label: 'Raise new requests' },
  { code: 'requests:view_own', label: 'View own requests' },
  { code: 'requests:view_all', label: 'View all org requests' },
  { code: 'requests:approve', label: 'Approve / reject member requests' },
  { code: 'team:view', label: 'View team members' },
  { code: 'team:invite', label: 'Invite team members' },
  { code: 'team:manage', label: 'Manage team members' },
  { code: 'roles:manage', label: 'Manage custom roles' },
  { code: 'projects:view', label: 'View linked projects' },
] as const;

export const CUSTOMER_PERMISSION_CODES = CUSTOMER_PERMISSIONS.map((p) => p.code);
export type CustomerPermissionCode = (typeof CUSTOMER_PERMISSION_CODES)[number];

export const ORG_ADMIN_PERMISSION_CODES = CUSTOMER_PERMISSION_CODES as unknown as string[];

export const ORG_MEMBER_PERMISSION_CODES: string[] = [
  'requests:create',
  'requests:view_own',
  'team:view',
  'projects:view',
];

export type PermissionCode = string;

export function isValidPermission(code: string): code is PermissionCode {
  if (ALL_DOT_PERMISSIONS.includes(code)) return true;
  if (code in LEGACY_COLON_TO_DOT || code in LEGACY_CUSTOMER_COLON_TO_DOT) return true;
  return ALL_PERMISSIONS.some((p) => p.code === code);
}
