/**
 * Predefined permissions — single source of truth. Every API route and UI action maps to one of these.
 * Roles in DB store an array of these codes; no permissions are stored except as part of a role.
 */

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
  { code: 'license:view', label: 'View license' },
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

export const ALL_PERMISSIONS = [...GLOBAL_PERMISSIONS, ...PROJECT_PERMISSIONS];

export const PERMISSION_CODES = ALL_PERMISSIONS.map((p) => p.code);

/** All project permission codes except settings:manage, project:edit, project:delete — used for default "Project Member" role on accept. Edit/delete require a role with those permissions (e.g. Project Lead). */
export const DEFAULT_PROJECT_MEMBER_PERMISSION_CODES = PROJECT_PERMISSIONS.filter(
  (p) => p.code !== 'settings:manage' && p.code !== 'project:edit' && p.code !== 'project:delete'
).map((p) => p.code);

/** Every project-scoped permission — assigned to the project lead (and creator when different) on project create. */
export const FULL_PROJECT_ROLE_PERMISSION_CODES = PROJECT_PERMISSIONS.map((p) => p.code);

export type PermissionCode = (typeof PERMISSION_CODES)[number];

export function isValidPermission(code: string): code is PermissionCode {
  return PERMISSION_CODES.includes(code as PermissionCode);
}
