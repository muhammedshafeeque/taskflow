// Single source of truth for TaskFlow dot-notation permission strings (spec).
// Migrate routes and roles from server/src/constants/permissions.ts incrementally.

// ─── GLOBAL (TaskFlow) PERMISSIONS ────────────────────────────────────────────

export const TASK_FLOW_PERMISSIONS = {
  AUTH: {
    ROLE: {
      CREATE: 'auth.role.create',
      READ: 'auth.role.read',
      UPDATE: 'auth.role.update',
      DELETE: 'auth.role.delete',
      LIST: 'auth.role.list',
      /** Legacy single guard for admin role CRUD UI */
      MANAGE_ALL: 'auth.role.manage_all',
    },
    USER: {
      CREATE: 'auth.user.create',
      READ: 'auth.user.read',
      UPDATE: 'auth.user.update',
      DELETE: 'auth.user.delete',
      LIST: 'auth.user.list',
      ENABLE_DISABLE: 'auth.user.enable_disable',
      RESET_PASSWORD: 'auth.user.reset_password',
      CHANGE_ROLE: 'auth.user.change_role',
      MANAGE_PERMISSIONS: 'auth.user.manage_permissions',
    },
  },

  PROJECT: {
    PROJECT: {
      CREATE: 'project.project.create',
      READ: 'project.project.read',
      UPDATE: 'project.project.update',
      DELETE: 'project.project.delete',
      LIST: 'project.project.list',
      ARCHIVE: 'project.project.archive',
      ASSIGN_TO_ORG: 'project.project.assign_to_org',
    },
    DESIGNATION: {
      CREATE: 'project.designation.create',
      READ: 'project.designation.read',
      UPDATE: 'project.designation.update',
      DELETE: 'project.designation.delete',
      LIST: 'project.designation.list',
      MANAGE_PERMISSIONS: 'project.designation.manage_permissions',
    },
    MEMBER: {
      CREATE: 'project.member.create',
      READ: 'project.member.read',
      UPDATE: 'project.member.update',
      DELETE: 'project.member.delete',
      LIST: 'project.member.list',
      MANAGE_PERMISSIONS: 'project.member.manage_permissions',
      CHANGE_DESIGNATION: 'project.member.change_designation',
    },
  },

  ORG: {
    ORG: {
      CREATE: 'org.org.create',
      READ: 'org.org.read',
      UPDATE: 'org.org.update',
      DELETE: 'org.org.delete',
      LIST: 'org.org.list',
    },
    ORG_USER_ROLE: {
      CREATE: 'org.org_user_role.create',
      READ: 'org.org_user_role.read',
      UPDATE: 'org.org_user_role.update',
      DELETE: 'org.org_user_role.delete',
      LIST: 'org.org_user_role.list',
      MANAGE_PERMISSIONS: 'org.org_user_role.manage_permissions',
    },
    ORG_MEMBER: {
      CREATE: 'org.org_member.create',
      READ: 'org.org_member.read',
      UPDATE: 'org.org_member.update',
      DELETE: 'org.org_member.delete',
      LIST: 'org.org_member.list',
      ENABLE_DISABLE: 'org.org_member.enable_disable',
      CHANGE_ROLE: 'org.org_member.change_role',
      MANAGE_PERMISSIONS: 'org.org_member.manage_permissions',
      RESET_PASSWORD: 'org.org_member.reset_password',
    },
  },

  INBOX: {
    INBOX: {
      READ: 'inbox.inbox.read',
      LIST: 'inbox.inbox.list',
    },
    NOTIFICATION: {
      READ: 'inbox.notification.read',
      LIST: 'inbox.notification.list',
      MARK_READ: 'inbox.notification.mark_read',
      MARK_ALL_READ: 'inbox.notification.mark_all_read',
      DELETE: 'inbox.notification.delete',
    },
    MENTION: {
      READ: 'inbox.mention.read',
      LIST: 'inbox.mention.list',
    },
    ACTIVITY: {
      READ: 'inbox.activity.read',
      LIST: 'inbox.activity.list',
    },
  },

  /** TaskFlow-only features not in the original spec snippet */
  TASKFLOW: {
    ANALYTICS: { VIEW: 'taskflow.analytics.view' },
    REPORT: {
      READ: 'taskflow.report.read',
      CREATE: 'taskflow.report.create',
      UPDATE: 'taskflow.report.update',
      DELETE: 'taskflow.report.delete',
    },
    COST_REPORT: { VIEW: 'taskflow.cost_report.view' },
    LICENSE: { VIEW: 'taskflow.license.view' },
    HR: {
      /** Company job titles (legacy designations collection) */
      DESIGNATION_MANAGE: 'taskflow.hr.designation.manage',
    },
    PROJECT: {
      /** See all projects (legacy projects:listAll) */
      LIST_ALL: 'taskflow.project.list_all',
    },
    CUSTOMER_PORTAL: {
      ORG_MANAGE: 'taskflow.customer_portal.org.manage',
      ORG_VIEW: 'taskflow.customer_portal.org.view',
      REQUEST_APPROVE: 'taskflow.customer_portal.request.approve',
    },
  },
} as const;

// ─── CUSTOMER (Org-scoped) PERMISSIONS ────────────────────────────────────────

export const CUSTOMER_PERMISSIONS = {
  ORG: {
    PROFILE: {
      READ: 'customer.org.profile.read',
      UPDATE: 'customer.org.profile.update',
    },
  },

  PROJECT: {
    PROJECT: {
      READ: 'customer.project.project.read',
      LIST: 'customer.project.project.list',
    },
  },

  ISSUE: {
    ISSUE: {
      CREATE: 'customer.issue.issue.create',
      READ: 'customer.issue.issue.read',
      UPDATE: 'customer.issue.issue.update',
      DELETE: 'customer.issue.issue.delete',
      LIST: 'customer.issue.issue.list',
      COMMENT: 'customer.issue.issue.comment',
      CLOSE: 'customer.issue.issue.close',
      REOPEN: 'customer.issue.issue.reopen',
    },
    COMMENT: {
      CREATE: 'customer.issue.comment.create',
      READ: 'customer.issue.comment.read',
      UPDATE: 'customer.issue.comment.update',
      DELETE: 'customer.issue.comment.delete',
      LIST: 'customer.issue.comment.list',
    },
    ATTACHMENT: {
      CREATE: 'customer.issue.attachment.create',
      READ: 'customer.issue.attachment.read',
      DELETE: 'customer.issue.attachment.delete',
      LIST: 'customer.issue.attachment.list',
    },
  },

  REPORT: {
    REPORT: {
      READ: 'customer.report.report.read',
      LIST: 'customer.report.report.list',
    },
  },

  MEMBER: {
    ORG_MEMBER: {
      READ: 'customer.member.org_member.read',
      LIST: 'customer.member.org_member.list',
      INVITE: 'customer.member.org_member.invite',
      REMOVE: 'customer.member.org_member.remove',
    },
  },

  /** Legacy customer portal codes (colon-era) — map via legacyPermissionMap for DB migration */
  LEGACY: {
    REQUEST: {
      CREATE: 'customer.legacy.request.create',
      VIEW_OWN: 'customer.legacy.request.view_own',
      VIEW_ALL: 'customer.legacy.request.view_all',
      APPROVE: 'customer.legacy.request.approve',
    },
    TEAM: {
      VIEW: 'customer.legacy.team.view',
      INVITE: 'customer.legacy.team.invite',
      MANAGE: 'customer.legacy.team.manage',
    },
    ROLE_MANAGE: 'customer.legacy.roles.manage',
    PROJECT_VIEW: 'customer.legacy.projects.view',
  },
} as const;

// ─── PROJECT-SCOPED PERMISSIONS ───────────────────────────────────────────────

export const PROJECT_PERMISSIONS = {
  /** Global keys under project.* for member snapshot (legacy colon-era) */
  MEMBER: {
    INVITATIONS_MANAGE: 'project.member.invitations_manage',
  },
  SCOPE: {
    DELETE: 'project.scope.delete',
  },

  ISSUE: {
    ISSUE: {
      CREATE: 'issue.issue.create',
      READ: 'issue.issue.read',
      UPDATE: 'issue.issue.update',
      DELETE: 'issue.issue.delete',
      LIST: 'issue.issue.list',
      ASSIGN: 'issue.issue.assign',
      COMMENT: 'issue.issue.comment',
      CLOSE: 'issue.issue.close',
      REOPEN: 'issue.issue.reopen',
    },
    ISSUE_TYPE: {
      CREATE: 'issue.issue_type.create',
      READ: 'issue.issue_type.read',
      UPDATE: 'issue.issue_type.update',
      DELETE: 'issue.issue_type.delete',
      LIST: 'issue.issue_type.list',
    },
    ISSUE_STATUS: {
      CREATE: 'issue.issue_status.create',
      READ: 'issue.issue_status.read',
      UPDATE: 'issue.issue_status.update',
      DELETE: 'issue.issue_status.delete',
      LIST: 'issue.issue_status.list',
    },
    ISSUE_PRIORITY: {
      CREATE: 'issue.issue_priority.create',
      READ: 'issue.issue_priority.read',
      UPDATE: 'issue.issue_priority.update',
      DELETE: 'issue.issue_priority.delete',
      LIST: 'issue.issue_priority.list',
    },
    COMMENT: {
      CREATE: 'issue.comment.create',
      READ: 'issue.comment.read',
      UPDATE: 'issue.comment.update',
      DELETE: 'issue.comment.delete',
      LIST: 'issue.comment.list',
    },
    ATTACHMENT: {
      CREATE: 'issue.attachment.create',
      READ: 'issue.attachment.read',
      DELETE: 'issue.attachment.delete',
      LIST: 'issue.attachment.list',
    },
  },

  SPRINT: {
    SPRINT: {
      CREATE: 'sprint.sprint.create',
      READ: 'sprint.sprint.read',
      UPDATE: 'sprint.sprint.update',
      DELETE: 'sprint.sprint.delete',
      LIST: 'sprint.sprint.list',
      START: 'sprint.sprint.start',
      CLOSE: 'sprint.sprint.close',
    },
  },

  BOARD: {
    BOARD: {
      READ: 'board.board.read',
      UPDATE: 'board.board.update',
    },
  },

  REPORT: {
    REPORT: {
      READ: 'report.report.read',
      LIST: 'report.report.list',
    },
  },

  SETTING: {
    PROJECT_SETTING: {
      READ: 'setting.project_setting.read',
      UPDATE: 'setting.project_setting.update',
    },
  },

  VERSION: {
    VERSION: {
      READ: 'version.version.read',
      RELEASE: 'version.version.release',
      UPDATE: 'version.version.update',
    },
  },

  ROADMAP: {
    ROADMAP: {
      READ: 'roadmap.roadmap.read',
      UPDATE: 'roadmap.roadmap.update',
    },
  },

  TEST_MANAGEMENT: {
    SUITE: {
      READ: 'test_management.suite.read',
      UPDATE: 'test_management.suite.update',
    },
  },

  MILESTONE: {
    MILESTONE: {
      CREATE: 'milestone.milestone.create',
      UPDATE: 'milestone.milestone.update',
      DELETE: 'milestone.milestone.delete',
    },
  },

  WORK_LOG: {
    WORK_LOG: {
      READ: 'work_log.work_log.read',
      CREATE: 'work_log.work_log.create',
      UPDATE: 'work_log.work_log.update',
      DELETE: 'work_log.work_log.delete',
    },
  },

  TIMESHEET: {
    TIMESHEET: {
      READ: 'timesheet.timesheet.read',
      EXPORT: 'timesheet.timesheet.export',
    },
  },
} as const;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

export function flattenPermissions(obj: Record<string, unknown>): string[] {
  return Object.values(obj).flatMap((v) =>
    typeof v === 'string' ? [v] : flattenPermissions(v as Record<string, unknown>)
  );
}

export const ALL_TASK_FLOW_PERMISSIONS = flattenPermissions(
  TASK_FLOW_PERMISSIONS as unknown as Record<string, unknown>
);
export const ALL_PROJECT_PERMISSIONS = flattenPermissions(
  PROJECT_PERMISSIONS as unknown as Record<string, unknown>
);
export const ALL_CUSTOMER_PERMISSIONS = flattenPermissions(
  CUSTOMER_PERMISSIONS as unknown as Record<string, unknown>
);
export const ALL_PERMISSIONS = [
  ...ALL_TASK_FLOW_PERMISSIONS,
  ...ALL_PROJECT_PERMISSIONS,
  ...ALL_CUSTOMER_PERMISSIONS,
];

/**
 * Injected into every new user at creation; never stripped on role change.
 */
export const DEFAULT_USER_PERMISSIONS: string[] = [
  TASK_FLOW_PERMISSIONS.INBOX.INBOX.READ,
  TASK_FLOW_PERMISSIONS.INBOX.INBOX.LIST,
  TASK_FLOW_PERMISSIONS.INBOX.NOTIFICATION.READ,
  TASK_FLOW_PERMISSIONS.INBOX.NOTIFICATION.LIST,
  TASK_FLOW_PERMISSIONS.INBOX.NOTIFICATION.MARK_READ,
  TASK_FLOW_PERMISSIONS.INBOX.NOTIFICATION.MARK_ALL_READ,
  TASK_FLOW_PERMISSIONS.INBOX.MENTION.READ,
  TASK_FLOW_PERMISSIONS.INBOX.MENTION.LIST,
  TASK_FLOW_PERMISSIONS.INBOX.ACTIVITY.READ,
  TASK_FLOW_PERMISSIONS.INBOX.ACTIVITY.LIST,
];
