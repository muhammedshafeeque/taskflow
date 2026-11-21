/**
 * Maps colon-era permission codes (DB / old routes) to dot-notation strings.
 * Use in one-off migrations and when reading legacy documents.
 */
import { ALL_PROJECT_PERMISSIONS, CUSTOMER_PERMISSIONS, PROJECT_PERMISSIONS, TASK_FLOW_PERMISSIONS } from './permissions';

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
 * user posting blind (and the issue page showing no comments), so any comment action implies reading —
 * and likewise for every other project resource (see sameResourceViewRules).
 * `issue.issue.comment` is the older "comment on issue" code and implies creating comments.
 */
const VIEW_VERBS = new Set(['read', 'list', 'view']);

/**
 * The same rule for every project resource: any action on it (create, update, delete, submit, manage…) implies
 * seeing it. Without this, a designation that lets members log work or submit estimates, but has no matching
 * read, leaves them unable to see what they just did (the issue page and AI assistants get a 403).
 */
function sameResourceViewRules(): Array<{ ifAny: string[]; grant: string[] }> {
  const byResource = new Map<string, { view: string[]; act: string[] }>();
  for (const code of ALL_PROJECT_PERMISSIONS as string[]) {
    const dot = code.lastIndexOf('.');
    if (dot <= 0) continue;
    const entry = byResource.get(code.slice(0, dot)) ?? { view: [], act: [] };
    (VIEW_VERBS.has(code.slice(dot + 1)) ? entry.view : entry.act).push(code);
    byResource.set(code.slice(0, dot), entry);
  }
  return [...byResource.values()].filter((r) => r.view.length && r.act.length).map((r) => ({ ifAny: r.act, grant: r.view }));
}

const IMPLIED_PERMISSIONS: Array<{ ifAny: string[]; grant: string[] }> = [
  { ifAny: [PF.ISSUE.ISSUE.COMMENT], grant: [PF.ISSUE.COMMENT.CREATE] },
  {
    ifAny: [PF.ISSUE.ISSUE.COMMENT, PF.ISSUE.COMMENT.CREATE, PF.ISSUE.COMMENT.UPDATE, PF.ISSUE.COMMENT.DELETE, PF.ISSUE.COMMENT.LIST],
    grant: [PF.ISSUE.COMMENT.READ, PF.ISSUE.COMMENT.LIST],
  },
  ...sameResourceViewRules(),
];

/**
 * Rights a colon-era code carried that later became separate permissions. Before 2026-06 comments had no
 * permission of their own: whoever could view an issue could read its comments, and whoever could edit it could
 * comment. When comment permissions were introduced, roles still on these codes (and members whose access comes
 * from such a role) silently lost comments, because each code translated only to its one dot-notation twin.
 */
const LEGACY_COLON_ALSO_GRANTS: Record<string, string[]> = {
  'issues:view': [PF.ISSUE.COMMENT.READ, PF.ISSUE.COMMENT.LIST],
  'issues:edit': [PF.ISSUE.COMMENT.CREATE],
};

/** A permission code in dot notation, plus anything a colon-era code also granted. */
function expandLegacyCode(p: string): string[] {
  const dot = LEGACY_COLON_TO_DOT[p] ?? p;
  const extra = LEGACY_COLON_ALSO_GRANTS[p];
  return extra ? [dot, ...extra] : [dot];
}

export function withImpliedPermissions(perms: string[]): string[] {
  const set = new Set(perms);
  for (const rule of IMPLIED_PERMISSIONS) {
    if (rule.ifAny.some((p) => set.has(p))) rule.grant.forEach((p) => set.add(p));
  }
  return [...set];
}

export function mapLegacyProjectOrGlobalPermissions(perms: string[]): string[] {
  return withImpliedPermissions([...new Set(perms.flatMap(expandLegacyCode))]);
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
    // Same precedence as permissionToDot: staff codes first, then customer-portal codes.
    const granted = !LEGACY_COLON_TO_DOT[p] && LEGACY_CUSTOMER_COLON_TO_DOT[p] ? [LEGACY_CUSTOMER_COLON_TO_DOT[p]] : expandLegacyCode(p);
    return granted.some((dot) => {
      if (dot === needed) return true;
      // Wildcard: "foo.bar.*" matches any permission that starts with "foo.bar."
      return dot.endsWith('.*') && needed.startsWith(dot.slice(0, -1));
    });
  });
}
