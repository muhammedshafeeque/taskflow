import { userHasPermission } from './legacyPermissionMap';

export type ModuleId =
  | 'pm'
  | 'resources'
  | 'crm'
  | 'contracts'
  | 'billing'
  | 'accounts'
  | 'hrms'
  | 'auth'
  | 'assets'
  | 'procurement'
  | 'service'
  | 'portal-admin'
  | 'mail'
  | 'calendar'
  | 'documents'
  | 'inbox'
  | 'core';

/** Cannot be turned off — needed to stay signed in, notified, and re-enable modules. */
export const ALWAYS_ON_MODULES = ['core', 'auth'] as const satisfies readonly ModuleId[];

export const TOGGLEABLE_MODULES = [
  'pm',
  'resources',
  'crm',
  'contracts',
  'billing',
  'accounts',
  'hrms',
  'assets',
  'procurement',
  'service',
  'portal-admin',
  'mail',
  'calendar',
  'documents',
] as const satisfies readonly ModuleId[];

export type ToggleableModuleId = (typeof TOGGLEABLE_MODULES)[number];
export type AlwaysOnModuleId = (typeof ALWAYS_ON_MODULES)[number];

export type EnabledModulesMap = Partial<Record<ModuleId, boolean>>;

type AccessUser = {
  role?: string;
  permissions?: string[] | null;
} | null | undefined;

/** Platform superuser — receives full catalog via resolveEffectiveGlobalPermissions. */
export function isPlatformAdmin(user: AccessUser): boolean {
  return user?.role === 'admin';
}

export function canAny(user: AccessUser, ...required: string[]): boolean {
  if (!user) return false;
  if (isPlatformAdmin(user)) return true;
  const perms = user.permissions ?? [];
  return required.some((p) => userHasPermission(perms, p));
}

/** Platform kill-switch: missing / undefined map or key ⇒ enabled (backward compatible). */
export function isModuleEnabled(
  moduleId: ModuleId,
  enabledModules?: EnabledModulesMap | null
): boolean {
  if ((ALWAYS_ON_MODULES as readonly string[]).includes(moduleId)) return true;
  if (!enabledModules) return true;
  return enabledModules[moduleId] !== false;
}

/** Module entry points: any one permission grants hub tile / module shell access. */
export const MODULE_ACCESS: Record<ModuleId, readonly string[]> = {
  pm: [
    'project.project.list',
    'projects:list',
    'project.project.create',
    'projects:create',
    'issue.issue.read',
  ],
  resources: [
    'taskflow.resources.dashboard.read',
    'taskflow.resources.utilization.read',
    'taskflow.resources.bench.read',
    'taskflow.resources.allocation.read',
    'taskflow.resources.forecast.read',
    'taskflow.analytics.view',
  ],
  crm: [
    'taskflow.crm.account.list',
    'taskflow.crm.report.read',
    'taskflow.crm.lead.list',
    'taskflow.crm.deal.list',
    'taskflow.crm.contact.list',
    'taskflow.crm.quote.list',
    'taskflow.crm.activity.list',
    'taskflow.crm.contract.list',
    'taskflow.crm.settings.manage',
  ],
  contracts: [
    'taskflow.contracts.dashboard.read',
    'taskflow.contracts.msa.list',
    'taskflow.contracts.retainer.list',
    'taskflow.contracts.renewal.read',
    'taskflow.contracts.sla.read',
    'taskflow.crm.contract.list',
  ],
  billing: [
    'taskflow.billing.dashboard.read',
    'taskflow.billing.subscription.list',
    'taskflow.billing.invoice.list',
    'taskflow.billing.time_to_invoice.read',
    'taskflow.billing.tax.read',
  ],
  accounts: [
    'taskflow.accounts.dashboard.read',
    'taskflow.accounts.ledger.read',
    'taskflow.accounts.invoice.list',
    'taskflow.accounts.expense.list',
    'taskflow.accounts.report.read',
    'taskflow.cost_report.view',
  ],
  hrms: [
    'taskflow.hr.dashboard.read',
    'taskflow.hr.employee.list',
    'taskflow.hr.designation.manage',
    'taskflow.hr.attendance.read',
    'taskflow.hr.leave.read',
    'taskflow.hr.payroll.read',
  ],
  auth: [
    'auth.user.list',
    'auth.user.create',
    'auth.user.update',
    'auth.user.read',
    'auth.role.manage_all',
    'auth.role.list',
    'auth.role.read',
    'users:list',
    'users:invite',
    'users:edit',
    'roles:manage',
    'org.org.read',
    'org.org.update',
  ],
  assets: [
    'taskflow.assets.dashboard.read',
    'taskflow.assets.inventory.list',
    'taskflow.assets.license.list',
    'taskflow.assets.server.list',
  ],
  procurement: [
    'taskflow.procurement.dashboard.read',
    'taskflow.procurement.vendor.list',
    'taskflow.procurement.po.list',
  ],
  service: ['taskflow.service.ticket.list', 'taskflow.service.kb.read'],
  'portal-admin': [
    'taskflow.customer_portal.org.manage',
    'taskflow.customer_portal.org.view',
    'customers:manage',
    'customers:view',
  ],
  mail: ['taskflow.mail.mailbox.read', 'taskflow.mail.message.read', 'taskflow.mail.mailbox.send'],
  calendar: [
    'taskflow.calendar.dashboard.read',
    'taskflow.calendar.meeting.list',
    'taskflow.calendar.demo.list',
    'taskflow.calendar.review.list',
  ],
  documents: [
    'taskflow.documents.dashboard.read',
    'taskflow.documents.proposal.list',
    'taskflow.documents.sow.list',
    'taskflow.documents.policy.list',
  ],
  inbox: ['inbox.inbox.read', 'inbox.inbox.list', 'inbox:read'],
  core: [
    'taskflow.core.company.read',
    'taskflow.core.company.update',
    'taskflow.core.currency.read',
    'taskflow.core.currency.manage',
    'taskflow.core.exchange_rate.read',
    'taskflow.core.exchange_rate.manage',
    'taskflow.core.modules.manage',
  ],
};

/**
 * Prefixes used to detect “any permission belonging to this module”
 * (covers grants beyond the curated MODULE_ACCESS entry points).
 */
export const MODULE_PERMISSION_PREFIXES: Record<ModuleId, readonly string[]> = {
  pm: [
    'project.',
    'issue.',
    'sprint.',
    'board.',
    'version.',
    'roadmap.',
    'test_management.',
    'milestone.',
    'work_log.',
    'timesheet.',
    'setting.',
    'report.',
    'taskflow.project',
    'taskflow.cost_report',
    'taskflow.platform.',
    'projects:',
  ],
  resources: ['taskflow.resources.', 'taskflow.analytics.'],
  crm: ['taskflow.crm.'],
  contracts: ['taskflow.contracts.'],
  billing: ['taskflow.billing.'],
  accounts: ['taskflow.accounts.', 'taskflow.cost_report'],
  hrms: ['taskflow.hr.', 'designations:'],
  auth: ['auth.', 'users:', 'roles:', 'org.'],
  assets: ['taskflow.assets.'],
  procurement: ['taskflow.procurement.'],
  service: ['taskflow.service.'],
  'portal-admin': ['taskflow.customer_portal.', 'customers:', 'customer-requests:'],
  mail: ['taskflow.mail.'],
  calendar: ['taskflow.calendar.'],
  documents: ['taskflow.documents.'],
  inbox: ['inbox.', 'inbox:'],
  core: ['taskflow.core.'],
};

/** True when the user holds at least one permission for the module (ignores admin short-circuit). */
export function userHasModulePermission(user: AccessUser, moduleId: ModuleId): boolean {
  if (!user) return false;
  const perms = user.permissions ?? [];
  if (perms.length === 0) return false;

  if (MODULE_ACCESS[moduleId].some((code) => userHasPermission(perms, code))) {
    return true;
  }

  const prefixes = MODULE_PERMISSION_PREFIXES[moduleId];
  return perms.some((code) => prefixes.some((prefix) => code.startsWith(prefix)));
}

/**
 * Hub tile / module shell access:
 * platform module must be enabled AND the user must have at least one permission for it.
 * Platform admins are not exempt — their effective permission list (including revokes) is used.
 */
export function canAccessModule(
  user: AccessUser,
  moduleId: ModuleId,
  enabledModules?: EnabledModulesMap | null
): boolean {
  if (!isModuleEnabled(moduleId, enabledModules)) return false;
  return userHasModulePermission(user, moduleId);
}
