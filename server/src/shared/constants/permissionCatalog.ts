import {
  ALL_PROJECT_PERMISSIONS,
  ALL_TASK_FLOW_PERMISSIONS,
} from './permissions';
import { LEGACY_COLON_TO_DOT } from './legacyPermissionMap';

export interface PermissionCatalogEntry {
  code: string;
  label: string;
  group: string;
}

/** Workspace roles may assign global + project-member permissions (not customer portal). */
export const WORKSPACE_ROLE_PERMISSION_CODES = [
  ...ALL_TASK_FLOW_PERMISSIONS,
  ...ALL_PROJECT_PERMISSIONS,
] as const;

const LEGACY_LABELS: Record<string, string> = {
  'inbox:read': 'View inbox',
  'users:list': 'List users',
  'users:invite': 'Invite user',
  'users:edit': 'Edit users',
  'designations:manage': 'Manage HR designations',
  'roles:manage': 'Manage roles',
  'projects:list': 'List projects',
  'projects:listAll': 'List all projects',
  'projects:create': 'Create project',
  'analytics:view': 'View analytics',
  'reports:view': 'View reports',
  'reports:create': 'Create reports',
  'taskflow.cost_report.view': 'View cost report',
  'license:view': 'View license',
  'customers:manage': 'Manage customer organizations',
  'customers:view': 'View customer organizations',
  'customer-requests:approve': 'Approve customer requests',
  'project:view': 'View project',
  'project:edit': 'Edit project',
  'project:delete': 'Delete project',
  'project:manageMembers': 'Manage project members',
  'issues:view': 'View issues',
  'issues:create': 'Create issues',
  'issues:edit': 'Edit issues',
  'issues:delete': 'Delete issues',
  'boards:view': 'View boards',
  'boards:edit': 'Edit boards',
  'sprints:view': 'View sprints',
  'sprints:edit': 'Edit sprints',
  'versions:view': 'View versions',
  'versions:release': 'Release version',
  'versions:edit': 'Edit versions',
  'settings:manage': 'Manage project settings',
  'roadmaps:view': 'View roadmaps',
  'roadmaps:edit': 'Edit roadmaps',
  'testManagement:view': 'View test management',
  'testManagement:edit': 'Edit test management',
  'taskflow.platform.executive.read': 'View executive dashboard',
  'taskflow.platform.audit.read': 'View audit logs',
};

const ACTION_LABELS: Record<string, string> = {
  create: 'Create',
  read: 'Read',
  update: 'Update',
  delete: 'Delete',
  list: 'List',
  manage: 'Manage',
  view: 'View',
  send: 'Send',
  export: 'Export',
  release: 'Release',
  start: 'Start',
  close: 'Close',
  archive: 'Archive',
  comment: 'Comment',
  reopen: 'Reopen',
  enable_disable: 'Enable / disable',
  reset_password: 'Reset password',
  change_role: 'Change role',
  manage_permissions: 'Manage permissions',
  manage_all: 'Manage all',
  change_designation: 'Change designation',
  mark_read: 'Mark read',
  mark_all_read: 'Mark all read',
  assign_to_org: 'Assign to organization',
  invitations_manage: 'Manage invitations',
};

function titleCase(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function legacyLabelForDot(code: string): string | undefined {
  if (LEGACY_LABELS[code]) return LEGACY_LABELS[code];
  for (const [legacy, dot] of Object.entries(LEGACY_COLON_TO_DOT)) {
    if (dot === code && LEGACY_LABELS[legacy]) return LEGACY_LABELS[legacy];
  }
  return undefined;
}

export function permissionGroup(code: string): string {
  if (code.startsWith('taskflow.crm.')) return 'CRM';
  if (code.startsWith('taskflow.hr.')) return 'HRMS';
  if (code.startsWith('taskflow.accounts.')) return 'Accounts';
  if (code.startsWith('taskflow.contracts.')) return 'Contracts';
  if (code.startsWith('taskflow.billing.')) return 'Billing';
  if (code.startsWith('taskflow.assets.')) return 'Assets';
  if (code.startsWith('taskflow.resources.')) return 'Resources';
  if (code.startsWith('taskflow.procurement.')) return 'Procurement';
  if (code.startsWith('taskflow.documents.')) return 'Documents';
  if (code.startsWith('taskflow.calendar.')) return 'Calendar';
  if (code.startsWith('taskflow.mail.')) return 'Mail';
  if (code.startsWith('taskflow.service.')) return 'Service Desk';
  if (code.startsWith('taskflow.customer_portal.')) return 'Customer Portal';
  if (code.startsWith('taskflow.platform.')) return 'Platform';
  if (code.startsWith('taskflow.')) return 'Project Manager';
  if (code.startsWith('auth.')) return 'Auth';
  if (code.startsWith('project.')) return 'Project Manager';
  if (code.startsWith('org.')) return 'Organization';
  if (code.startsWith('inbox.')) return 'Inbox';
  if (
    code.startsWith('issue.') ||
    code.startsWith('sprint.') ||
    code.startsWith('board.') ||
    code.startsWith('report.') ||
    code.startsWith('setting.') ||
    code.startsWith('version.') ||
    code.startsWith('roadmap.') ||
    code.startsWith('test_management.') ||
    code.startsWith('milestone.') ||
    code.startsWith('work_log.') ||
    code.startsWith('timesheet.')
  ) {
    return 'Project (member)';
  }
  return 'Other';
}

export function permissionLabel(code: string): string {
  const legacy = legacyLabelForDot(code);
  if (legacy) return legacy;

  const parts = code.split('.');
  if (parts.length < 2) return titleCase(code);
  const action = parts[parts.length - 1] ?? code;
  const resourceParts = parts.slice(0, -1);
  const resource = resourceParts.map((p) => titleCase(p)).join(' · ');
  const actionLabel = ACTION_LABELS[action] ?? titleCase(action);
  return `${resource} · ${actionLabel}`;
}

export function buildWorkspaceRolePermissionCatalog(): PermissionCatalogEntry[] {
  const unique = [...new Set(WORKSPACE_ROLE_PERMISSION_CODES)];
  return unique
    .map((code) => ({
      code,
      label: permissionLabel(code),
      group: permissionGroup(code),
    }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
}

/** Flat list for role validation and Roles UI. */
export const WORKSPACE_ROLE_PERMISSION_CATALOG = buildWorkspaceRolePermissionCatalog();
