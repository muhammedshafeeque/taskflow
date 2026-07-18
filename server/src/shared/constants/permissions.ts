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
    PLATFORM: {
      EXECUTIVE: { READ: 'taskflow.platform.executive.read' },
      AUDIT: { READ: 'taskflow.platform.audit.read' },
    },
    HR: {
      /** Company job titles (legacy designations collection) */
      DESIGNATION_MANAGE: 'taskflow.hr.designation.manage',
      DASHBOARD: { READ: 'taskflow.hr.dashboard.read' },
      EMPLOYEE: {
        LIST: 'taskflow.hr.employee.list',
        READ: 'taskflow.hr.employee.read',
        CREATE: 'taskflow.hr.employee.create',
        UPDATE: 'taskflow.hr.employee.update',
      },
      ATTENDANCE: {
        READ: 'taskflow.hr.attendance.read',
        MANAGE: 'taskflow.hr.attendance.manage',
      },
      LEAVE: {
        READ: 'taskflow.hr.leave.read',
        MANAGE: 'taskflow.hr.leave.manage',
      },
      PAYROLL: {
        READ: 'taskflow.hr.payroll.read',
        MANAGE: 'taskflow.hr.payroll.manage',
      },
    },
    ACCOUNTS: {
      DASHBOARD: { READ: 'taskflow.accounts.dashboard.read' },
      LEDGER: {
        READ: 'taskflow.accounts.ledger.read',
        MANAGE: 'taskflow.accounts.ledger.manage',
      },
      INVOICE: {
        LIST: 'taskflow.accounts.invoice.list',
        READ: 'taskflow.accounts.invoice.read',
        CREATE: 'taskflow.accounts.invoice.create',
        UPDATE: 'taskflow.accounts.invoice.update',
      },
      EXPENSE: {
        LIST: 'taskflow.accounts.expense.list',
        READ: 'taskflow.accounts.expense.read',
        CREATE: 'taskflow.accounts.expense.create',
        UPDATE: 'taskflow.accounts.expense.update',
      },
      REPORT: { READ: 'taskflow.accounts.report.read' },
    },
    CONTRACTS: {
      DASHBOARD: { READ: 'taskflow.contracts.dashboard.read' },
      MSA: { LIST: 'taskflow.contracts.msa.list', READ: 'taskflow.contracts.msa.read', MANAGE: 'taskflow.contracts.msa.manage' },
      RETAINER: { LIST: 'taskflow.contracts.retainer.list', MANAGE: 'taskflow.contracts.retainer.manage' },
      RENEWAL: { READ: 'taskflow.contracts.renewal.read', MANAGE: 'taskflow.contracts.renewal.manage' },
      SLA: { READ: 'taskflow.contracts.sla.read', MANAGE: 'taskflow.contracts.sla.manage' },
    },
    BILLING: {
      DASHBOARD: { READ: 'taskflow.billing.dashboard.read' },
      SUBSCRIPTION: { LIST: 'taskflow.billing.subscription.list', MANAGE: 'taskflow.billing.subscription.manage' },
      INVOICE: { LIST: 'taskflow.billing.invoice.list', CREATE: 'taskflow.billing.invoice.create', MANAGE: 'taskflow.billing.invoice.manage' },
      TIME_TO_INVOICE: { READ: 'taskflow.billing.time_to_invoice.read', MANAGE: 'taskflow.billing.time_to_invoice.manage' },
      TAX: { READ: 'taskflow.billing.tax.read', MANAGE: 'taskflow.billing.tax.manage' },
    },
    ASSETS: {
      DASHBOARD: { READ: 'taskflow.assets.dashboard.read' },
      INVENTORY: { LIST: 'taskflow.assets.inventory.list', MANAGE: 'taskflow.assets.inventory.manage' },
      LICENSE: { LIST: 'taskflow.assets.license.list', MANAGE: 'taskflow.assets.license.manage' },
      SERVER: { LIST: 'taskflow.assets.server.list', MANAGE: 'taskflow.assets.server.manage' },
      WARRANTY: { READ: 'taskflow.assets.warranty.read', MANAGE: 'taskflow.assets.warranty.manage' },
    },
    RESOURCES: {
      DASHBOARD: { READ: 'taskflow.resources.dashboard.read' },
      UTILIZATION: { READ: 'taskflow.resources.utilization.read' },
      BENCH: { READ: 'taskflow.resources.bench.read' },
      FORECAST: { READ: 'taskflow.resources.forecast.read', MANAGE: 'taskflow.resources.forecast.manage' },
      ALLOCATION: { READ: 'taskflow.resources.allocation.read', MANAGE: 'taskflow.resources.allocation.manage' },
    },
    PROCUREMENT: {
      DASHBOARD: { READ: 'taskflow.procurement.dashboard.read' },
      VENDOR: { LIST: 'taskflow.procurement.vendor.list', MANAGE: 'taskflow.procurement.vendor.manage' },
      PO: { LIST: 'taskflow.procurement.po.list', CREATE: 'taskflow.procurement.po.create', MANAGE: 'taskflow.procurement.po.manage' },
      LICENSE: { LIST: 'taskflow.procurement.license.list', MANAGE: 'taskflow.procurement.license.manage' },
    },
    DOCUMENTS: {
      DASHBOARD: { READ: 'taskflow.documents.dashboard.read' },
      PROPOSAL: { LIST: 'taskflow.documents.proposal.list', MANAGE: 'taskflow.documents.proposal.manage' },
      SOW: { LIST: 'taskflow.documents.sow.list', MANAGE: 'taskflow.documents.sow.manage' },
      POLICY: { LIST: 'taskflow.documents.policy.list', MANAGE: 'taskflow.documents.policy.manage' },
      TEMPLATE: { LIST: 'taskflow.documents.template.list', MANAGE: 'taskflow.documents.template.manage' },
    },
    CALENDAR: {
      DASHBOARD: { READ: 'taskflow.calendar.dashboard.read' },
      MEETING: { LIST: 'taskflow.calendar.meeting.list', MANAGE: 'taskflow.calendar.meeting.manage' },
      DEMO: { LIST: 'taskflow.calendar.demo.list', MANAGE: 'taskflow.calendar.demo.manage' },
      REVIEW: { LIST: 'taskflow.calendar.review.list', MANAGE: 'taskflow.calendar.review.manage' },
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
    CRM: {
      ACCOUNT: {
        CREATE: 'taskflow.crm.account.create',
        READ: 'taskflow.crm.account.read',
        UPDATE: 'taskflow.crm.account.update',
        DELETE: 'taskflow.crm.account.delete',
        LIST: 'taskflow.crm.account.list',
      },
      CONTACT: {
        CREATE: 'taskflow.crm.contact.create',
        READ: 'taskflow.crm.contact.read',
        UPDATE: 'taskflow.crm.contact.update',
        DELETE: 'taskflow.crm.contact.delete',
        LIST: 'taskflow.crm.contact.list',
      },
      LEAD: {
        CREATE: 'taskflow.crm.lead.create',
        READ: 'taskflow.crm.lead.read',
        UPDATE: 'taskflow.crm.lead.update',
        DELETE: 'taskflow.crm.lead.delete',
        LIST: 'taskflow.crm.lead.list',
      },
      DEAL: {
        CREATE: 'taskflow.crm.deal.create',
        READ: 'taskflow.crm.deal.read',
        UPDATE: 'taskflow.crm.deal.update',
        DELETE: 'taskflow.crm.deal.delete',
        LIST: 'taskflow.crm.deal.list',
      },
      QUOTE: {
        CREATE: 'taskflow.crm.quote.create',
        READ: 'taskflow.crm.quote.read',
        UPDATE: 'taskflow.crm.quote.update',
        DELETE: 'taskflow.crm.quote.delete',
        LIST: 'taskflow.crm.quote.list',
      },
      ACTIVITY: {
        CREATE: 'taskflow.crm.activity.create',
        READ: 'taskflow.crm.activity.read',
        UPDATE: 'taskflow.crm.activity.update',
        DELETE: 'taskflow.crm.activity.delete',
        LIST: 'taskflow.crm.activity.list',
      },
      CONTRACT: {
        CREATE: 'taskflow.crm.contract.create',
        READ: 'taskflow.crm.contract.read',
        UPDATE: 'taskflow.crm.contract.update',
        DELETE: 'taskflow.crm.contract.delete',
        LIST: 'taskflow.crm.contract.list',
      },
      REPORT: { READ: 'taskflow.crm.report.read' },
      SETTINGS: { MANAGE: 'taskflow.crm.settings.manage' },
    },
    MAIL: {
      MAILBOX: {
        MANAGE: 'taskflow.mail.mailbox.manage',
        READ: 'taskflow.mail.mailbox.read',
        SEND: 'taskflow.mail.mailbox.send',
      },
      MESSAGE: {
        READ: 'taskflow.mail.message.read',
        DELETE: 'taskflow.mail.message.delete',
      },
    },
    SERVICE: {
      TICKET: {
        CREATE: 'taskflow.service.ticket.create',
        READ: 'taskflow.service.ticket.read',
        UPDATE: 'taskflow.service.ticket.update',
        DELETE: 'taskflow.service.ticket.delete',
        LIST: 'taskflow.service.ticket.list',
      },
      KB: {
        CREATE: 'taskflow.service.kb.create',
        READ: 'taskflow.service.kb.read',
        UPDATE: 'taskflow.service.kb.update',
        DELETE: 'taskflow.service.kb.delete',
        LIST: 'taskflow.service.kb.list',
      },
      SLA: { MANAGE: 'taskflow.service.sla.manage' },
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
    ESTIMATE: {
      SUBMIT: 'issue.estimate.submit',
      APPROVE: 'issue.estimate.approve',
      VIEW: 'issue.estimate.view',
    },
    RULE: {
      MANAGE: 'issue.rule.manage',
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
