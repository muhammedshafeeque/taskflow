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
  | 'inbox';

type AccessUser = {
  role?: string;
  permissions?: string[];
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
    'auth.role.manage_all',
    'users:list',
    'users:invite',
    'roles:manage',
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
};

export function canAccessModule(user: AccessUser, moduleId: ModuleId): boolean {
  if (moduleId === 'inbox') return true;
  return canAny(user, ...MODULE_ACCESS[moduleId]);
}
