/**
 * Maps colon-era permission codes (DB / old routes) to dot-notation strings.
 * Use in one-off migrations and when reading legacy documents.
 */
import { CUSTOMER_PERMISSIONS, PROJECT_PERMISSIONS, TASK_FLOW_PERMISSIONS } from './permissions';

const TF = TASK_FLOW_PERMISSIONS;
const PF = PROJECT_PERMISSIONS;
const CF = CUSTOMER_PERMISSIONS;

export const LEGACY_COLON_TO_DOT: Record<string, string> = {
  'inbox:read': TF.INBOX.INBOX.READ,

  'users:list': TF.AUTH.USER.LIST,
  'users:invite': TF.AUTH.USER.CREATE,
  'users:edit': TF.AUTH.USER.UPDATE,

  'designations:manage': TF.TASKFLOW.HR.DESIGNATION_MANAGE,
  'roles:manage': TF.AUTH.ROLE.MANAGE_ALL,

  'projects:list': TF.PROJECT.PROJECT.LIST,
  'projects:listAll': TF.TASKFLOW.PROJECT.LIST_ALL,
  'projects:create': TF.PROJECT.PROJECT.CREATE,

  'analytics:view': TF.TASKFLOW.ANALYTICS.VIEW,
  'reports:view': TF.TASKFLOW.REPORT.READ,
  'reports:create': TF.TASKFLOW.REPORT.CREATE,

  'license:view': TF.TASKFLOW.LICENSE.VIEW,

  'customers:manage': TF.TASKFLOW.CUSTOMER_PORTAL.ORG_MANAGE,
  'customers:view': TF.TASKFLOW.CUSTOMER_PORTAL.ORG_VIEW,
  'customer-requests:approve': TF.TASKFLOW.CUSTOMER_PORTAL.REQUEST_APPROVE,

  'project:view': PF.ISSUE.ISSUE.READ,
  'project:edit': PF.SETTING.PROJECT_SETTING.UPDATE,
  'project:delete': PF.SCOPE.DELETE,
  'project:manageMembers': PF.MEMBER.INVITATIONS_MANAGE,

  'issues:view': PF.ISSUE.ISSUE.READ,
  'issues:create': PF.ISSUE.ISSUE.CREATE,
  'issues:edit': PF.ISSUE.ISSUE.UPDATE,
  'issues:delete': PF.ISSUE.ISSUE.DELETE,

  'boards:view': PF.BOARD.BOARD.READ,
  'boards:edit': PF.BOARD.BOARD.UPDATE,

  'sprints:view': PF.SPRINT.SPRINT.READ,
  'sprints:edit': PF.SPRINT.SPRINT.UPDATE,

  'versions:view': PF.VERSION.VERSION.READ,
  'versions:release': PF.VERSION.VERSION.RELEASE,
  'versions:edit': PF.VERSION.VERSION.UPDATE,

  'settings:manage': PF.SETTING.PROJECT_SETTING.UPDATE,

  'roadmaps:view': PF.ROADMAP.ROADMAP.READ,
  'roadmaps:edit': PF.ROADMAP.ROADMAP.UPDATE,

  'testManagement:view': PF.TEST_MANAGEMENT.SUITE.READ,
  'testManagement:edit': PF.TEST_MANAGEMENT.SUITE.UPDATE,
};

/** Customer portal role permissions (colon-era) */
export const LEGACY_CUSTOMER_COLON_TO_DOT: Record<string, string> = {
  'requests:create': CF.LEGACY.REQUEST.CREATE,
  'requests:view_own': CF.LEGACY.REQUEST.VIEW_OWN,
  'requests:view_all': CF.LEGACY.REQUEST.VIEW_ALL,
  'requests:approve': CF.LEGACY.REQUEST.APPROVE,
  'team:view': CF.LEGACY.TEAM.VIEW,
  'team:invite': CF.LEGACY.TEAM.INVITE,
  'team:manage': CF.LEGACY.TEAM.MANAGE,
  'roles:manage': CF.LEGACY.ROLE_MANAGE,
  'projects:view': CF.LEGACY.PROJECT_VIEW,
};

/**
 * Permissions that only make sense together. Writing to a comment thread you can't read leaves the
 * user posting blind (and the issue page showing no comments), so any comment action implies reading.
 * `issue.issue.comment` is the older "comment on issue" code and implies creating comments.
 */
const IMPLIED_PERMISSIONS: Array<{ ifAny: string[]; grant: string[] }> = [
  { ifAny: [PF.ISSUE.ISSUE.COMMENT], grant: [PF.ISSUE.COMMENT.CREATE] },
  {
    ifAny: [PF.ISSUE.ISSUE.COMMENT, PF.ISSUE.COMMENT.CREATE, PF.ISSUE.COMMENT.UPDATE, PF.ISSUE.COMMENT.DELETE, PF.ISSUE.COMMENT.LIST],
    grant: [PF.ISSUE.COMMENT.READ, PF.ISSUE.COMMENT.LIST],
  },
];

export function withImpliedPermissions(perms: string[]): string[] {
  const set = new Set(perms);
  for (const rule of IMPLIED_PERMISSIONS) {
    if (rule.ifAny.some((p) => set.has(p))) rule.grant.forEach((p) => set.add(p));
  }
  return [...set];
}

export function mapLegacyProjectOrGlobalPermissions(perms: string[]): string[] {
  return withImpliedPermissions([...new Set(perms.map((p) => LEGACY_COLON_TO_DOT[p] ?? p))]);
}

export function mapLegacyCustomerPermissions(perms: string[]): string[] {
  return [...new Set(perms.map((p) => LEGACY_CUSTOMER_COLON_TO_DOT[p] ?? LEGACY_COLON_TO_DOT[p] ?? p))];
}

/** Normalize one code to dot (taskflow/project or customer legacy). */
export function permissionToDot(p: string): string {
  return LEGACY_COLON_TO_DOT[p] ?? LEGACY_CUSTOMER_COLON_TO_DOT[p] ?? p;
}

/** True if the user holds the required permission (dot or legacy colon on either side).
 *  Supports wildcard suffix: "project.*" matches any "project.xxx" permission. */
export function userHasPermission(userPerms: string[], required: string): boolean {
  const needed = permissionToDot(required);
  return userPerms.some((p) => {
    const dot = permissionToDot(p);
    if (dot === needed) return true;
    // Wildcard: "foo.bar.*" matches any permission that starts with "foo.bar."
    if (dot.endsWith('.*') && needed.startsWith(dot.slice(0, -1))) return true;
    return false;
  });
}
