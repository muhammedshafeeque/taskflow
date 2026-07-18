import type { ReactNode } from 'react';
import { canAny } from '../utils/moduleAccess';
import { canAccessTaskflowWorkspaceSettings } from '../utils/taskflowWorkspaceSettingsAccess';
import {
  DashboardIcon,
  InboxIcon,
  ProjectsIcon,
  UsersIcon,
  RolesIcon,
  IssuesIcon,
  SettingsIcon,
  AppHubSettingsIcon,
  TimesheetIcon,
  PackageIcon,
} from './icons/NavigationIcons';

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

type NavUser = {
  mustChangePassword?: boolean;
  permissions?: string[];
  role?: string;
  userType?: string;
  organizations?: { id: string }[];
} | null;

/** Super admins see all matching nav entries; others need at least one matching permission. */
function allow(user: NavUser, ...required: string[]) {
  return canAny(user, ...required);
}

/** Project Manager — delivery first, then time, then insights, then admin */
export function buildPmNav(user: NavUser): NavItem[] {
  const nav: NavItem[] = [];

  if (allow(user, 'project.project.list', 'projects:list', 'project.project.create', 'projects:create')) {
    nav.push({ to: '/dashboard', label: 'Dashboard', icon: <DashboardIcon />, end: true });
    nav.push({ to: '/projects', label: 'Projects', icon: <ProjectsIcon /> });
  }
  if (allow(user, 'project.project.list', 'projects:list')) {
    nav.push({ to: '/issues', label: 'Issues', icon: <IssuesIcon /> });
  }
  if (allow(user, 'project.project.create', 'projects:create')) {
    nav.push({ to: '/project-templates', label: 'Templates', icon: <PackageIcon /> });
  }

  if (allow(user, 'taskflow.report.read', 'reports:view')) {
    nav.push({ to: '/timesheet', label: 'Timesheet', icon: <TimesheetIcon /> });
    nav.push({ to: '/estimates', label: 'Estimates', icon: <TimesheetIcon /> });
  }

  if (allow(user, 'taskflow.analytics.view', 'analytics:view')) {
    nav.push({ to: '/workload', label: 'Workload', icon: <TimesheetIcon /> });
  }
  if (
    allow(
      user,
      'taskflow.analytics.view',
      'analytics:view',
      'taskflow.report.read',
      'reports:view',
      'project.project.list',
      'projects:list'
    )
  ) {
    nav.push({ to: '/portfolio', label: 'Portfolio', icon: <ProjectsIcon /> });
  }
  if (allow(user, 'taskflow.analytics.view', 'analytics:view')) {
    nav.push({ to: '/performance-report', label: 'Performance', icon: <TimesheetIcon /> });
    nav.push({ to: '/analytics', label: 'Analytics', icon: <SettingsIcon /> });
  }
  if (allow(user, 'taskflow.report.read', 'reports:view')) {
    nav.push({ to: '/reports', label: 'Reports', icon: <SettingsIcon /> });
  }
  if (
    allow(
      user,
      'taskflow.analytics.view',
      'analytics:view',
      'taskflow.report.read',
      'reports:view',
      'project.project.list',
      'projects:list'
    )
  ) {
    nav.push({ to: '/defect-metrics', label: 'Defect metrics', icon: <IssuesIcon /> });
  }

  if (allow(user, 'taskflow.platform.executive.read')) {
    nav.push({ to: '/executive', label: 'Executive', icon: <DashboardIcon /> });
  }
  if (allow(user, 'taskflow.platform.audit.read')) {
    nav.push({ to: '/audit-logs', label: 'Audit logs', icon: <SettingsIcon /> });
  }

  return nav;
}

/** Auth — identity, access & organization */
export function buildAuthNav(user: NavUser): NavItem[] {
  const nav: NavItem[] = [];
  if (allow(user, 'auth.user.list', 'auth.user.create', 'users:list', 'users:invite')) {
    nav.push({ to: '/users', label: 'Users', icon: <UsersIcon />, end: true });
  }
  if (allow(user, 'auth.role.manage_all', 'roles:manage')) {
    nav.push({ to: '/roles', label: 'Roles', icon: <RolesIcon /> });
  }
  if (
    user?.userType === 'taskflow' &&
    (user.organizations?.length ?? 0) > 0 &&
    canAccessTaskflowWorkspaceSettings(user)
  ) {
    nav.push({ to: '/settings/workspace', label: 'Organization', icon: <AppHubSettingsIcon /> });
  }
  return nav;
}

/** CRM — pipeline order: lead → account → contact → deal → quote */
export function buildCrmNav(user: NavUser): NavItem[] {
  const nav: NavItem[] = [];
  if (!allow(user, 'taskflow.crm.account.list', 'taskflow.crm.report.read', 'taskflow.crm.lead.list', 'taskflow.crm.deal.list')) {
    return nav;
  }
  nav.push({ to: '/crm', label: 'Dashboard', icon: <DashboardIcon />, end: true });
  if (allow(user, 'taskflow.crm.lead.list', 'taskflow.crm.lead.create')) {
    nav.push({ to: '/crm/leads', label: 'Leads', icon: <IssuesIcon /> });
  }
  if (allow(user, 'taskflow.crm.account.list')) {
    nav.push({ to: '/crm/accounts', label: 'Accounts', icon: <UsersIcon /> });
  }
  if (allow(user, 'taskflow.crm.contact.list')) {
    nav.push({ to: '/crm/contacts', label: 'Contacts', icon: <UsersIcon /> });
  }
  if (allow(user, 'taskflow.crm.deal.list')) {
    nav.push({ to: '/crm/deals', label: 'Deals', icon: <PackageIcon /> });
  }
  if (allow(user, 'taskflow.crm.quote.list')) {
    nav.push({ to: '/crm/quotes', label: 'Quotes', icon: <SettingsIcon /> });
  }
  if (allow(user, 'taskflow.crm.activity.list', 'taskflow.crm.activity.create')) {
    nav.push({ to: '/crm/activities', label: 'Activities', icon: <TimesheetIcon /> });
  }
  if (allow(user, 'taskflow.crm.contract.list', 'taskflow.crm.contract.create')) {
    nav.push({ to: '/crm/contracts', label: 'Contracts', icon: <PackageIcon /> });
  }
  if (allow(user, 'taskflow.crm.settings.manage')) {
    nav.push({ to: '/crm/settings', label: 'Settings', icon: <AppHubSettingsIcon /> });
  }
  return nav;
}

/** Mail */
export function buildMailNav(user: NavUser): NavItem[] {
  const nav: NavItem[] = [];
  if (!allow(user, 'taskflow.mail.mailbox.read', 'taskflow.mail.message.read', 'taskflow.mail.mailbox.send')) {
    return nav;
  }
  nav.push({ to: '/mail', label: 'Inbox', icon: <InboxIcon />, end: true });
  if (allow(user, 'taskflow.mail.mailbox.send', 'taskflow.mail.mailbox.read')) {
    nav.push({ to: '/mail/compose', label: 'Compose', icon: <SettingsIcon /> });
  }
  return nav;
}

/** Service Desk */
export function buildServiceNav(user: NavUser): NavItem[] {
  const nav: NavItem[] = [];
  if (!allow(user, 'taskflow.service.ticket.list', 'taskflow.service.kb.read')) return nav;
  if (allow(user, 'taskflow.service.ticket.list')) {
    nav.push({ to: '/service', label: 'Dashboard', icon: <DashboardIcon />, end: true });
  }
  nav.push({ to: '/service/tickets', label: 'Tickets', icon: <IssuesIcon /> });
  if (allow(user, 'taskflow.service.sla.manage')) {
    nav.push({ to: '/service/sla', label: 'SLA policies', icon: <SettingsIcon /> });
  }
  nav.push({ to: '/service/kb', label: 'Knowledge base', icon: <SettingsIcon /> });
  return nav;
}

/** Customer Portal admin */
export function buildPortalAdminNav(user: NavUser): NavItem[] {
  const nav: NavItem[] = [];
  if (
    allow(
      user,
      'taskflow.customer_portal.org.manage',
      'taskflow.customer_portal.org.view',
      'customers:manage',
      'customers:view'
    )
  ) {
    nav.push({ to: '/admin/customer-orgs', label: 'Organizations', icon: <UsersIcon />, end: true });
  }
  if (allow(user, 'taskflow.customer_portal.request.approve', 'customer-requests:approve')) {
    nav.push({ to: '/admin/customer-requests', label: 'Requests', icon: <IssuesIcon /> });
  }
  return nav;
}

/** Inbox notifications */
export function buildInboxNav(_user: NavUser): NavItem[] {
  return [
    { to: '/inbox', label: 'Inbox', icon: <InboxIcon />, end: true },
    { to: '/profile/notifications', label: 'Preferences', icon: <SettingsIcon /> },
  ];
}

/** HRMS — people lifecycle */
export function buildHrmsNav(user: NavUser): NavItem[] {
  const nav: NavItem[] = [];
  if (
    !allow(
      user,
      'taskflow.hr.dashboard.read',
      'taskflow.hr.employee.list',
      'taskflow.hr.designation.manage',
      'taskflow.hr.attendance.read',
      'taskflow.hr.leave.read',
      'taskflow.hr.payroll.read'
    )
  ) {
    return nav;
  }
  nav.push({ to: '/hrms', label: 'Dashboard', icon: <DashboardIcon />, end: true });
  if (allow(user, 'taskflow.hr.employee.list', 'taskflow.hr.employee.read', 'taskflow.hr.designation.manage')) {
    nav.push({ to: '/hrms/employees', label: 'Employees', icon: <UsersIcon /> });
  }
  if (allow(user, 'taskflow.hr.attendance.read', 'taskflow.hr.attendance.manage')) {
    nav.push({ to: '/hrms/attendance', label: 'Attendance', icon: <TimesheetIcon /> });
  }
  if (allow(user, 'taskflow.hr.leave.read', 'taskflow.hr.leave.manage')) {
    nav.push({ to: '/hrms/leave', label: 'Leave', icon: <IssuesIcon /> });
  }
  if (allow(user, 'taskflow.hr.payroll.read', 'taskflow.hr.payroll.manage')) {
    nav.push({ to: '/hrms/payroll', label: 'Payroll', icon: <PackageIcon /> });
  }
  return nav;
}

/** Accounts — books & cost (finance system of record) */
export function buildAccountsNav(user: NavUser): NavItem[] {
  const nav: NavItem[] = [];
  if (
    !allow(
      user,
      'taskflow.accounts.dashboard.read',
      'taskflow.accounts.ledger.read',
      'taskflow.accounts.invoice.list',
      'taskflow.accounts.expense.list',
      'taskflow.accounts.report.read',
      'taskflow.cost_report.view'
    )
  ) {
    return nav;
  }
  nav.push({ to: '/accounts', label: 'Dashboard', icon: <DashboardIcon />, end: true });
  if (allow(user, 'taskflow.accounts.ledger.read', 'taskflow.accounts.ledger.manage')) {
    nav.push({ to: '/accounts/ledger', label: 'Ledger', icon: <SettingsIcon /> });
  }
  if (allow(user, 'taskflow.accounts.invoice.list', 'taskflow.accounts.invoice.read')) {
    nav.push({ to: '/accounts/invoices', label: 'Invoices', icon: <PackageIcon /> });
  }
  if (allow(user, 'taskflow.accounts.expense.list', 'taskflow.accounts.expense.read')) {
    nav.push({ to: '/accounts/expenses', label: 'Expenses', icon: <TimesheetIcon /> });
  }
  if (allow(user, 'taskflow.cost_report.view')) {
    nav.push({ to: '/cost-usage', label: 'Cost report', icon: <TimesheetIcon /> });
  }
  if (allow(user, 'taskflow.accounts.report.read', 'taskflow.cost_report.view')) {
    nav.push({ to: '/accounts/reports', label: 'Reports', icon: <SettingsIcon /> });
  }
  return nav;
}

/** Contracts — agreement lifecycle */
export function buildContractsNav(user: NavUser): NavItem[] {
  const nav: NavItem[] = [];
  if (
    !allow(
      user,
      'taskflow.contracts.dashboard.read',
      'taskflow.contracts.msa.list',
      'taskflow.contracts.retainer.list',
      'taskflow.contracts.renewal.read',
      'taskflow.contracts.sla.read',
      'taskflow.crm.contract.list'
    )
  ) {
    return nav;
  }
  nav.push({ to: '/contracts', label: 'Dashboard', icon: <DashboardIcon />, end: true });
  if (allow(user, 'taskflow.contracts.msa.list', 'taskflow.contracts.msa.read', 'taskflow.crm.contract.list')) {
    nav.push({ to: '/contracts/msas', label: 'MSAs', icon: <PackageIcon /> });
  }
  if (allow(user, 'taskflow.contracts.sla.read', 'taskflow.contracts.sla.manage', 'taskflow.crm.contract.list')) {
    nav.push({ to: '/contracts/slas', label: 'SLAs', icon: <SettingsIcon /> });
  }
  if (allow(user, 'taskflow.contracts.retainer.list', 'taskflow.crm.contract.list')) {
    nav.push({ to: '/contracts/retainers', label: 'Retainers & AMC', icon: <TimesheetIcon /> });
  }
  if (allow(user, 'taskflow.contracts.renewal.read', 'taskflow.crm.contract.list')) {
    nav.push({ to: '/contracts/renewals', label: 'Renewals', icon: <IssuesIcon /> });
  }
  return nav;
}

/** Billing — commercial billing before posting to Accounts */
export function buildBillingNav(user: NavUser): NavItem[] {
  const nav: NavItem[] = [];
  if (
    !allow(
      user,
      'taskflow.billing.dashboard.read',
      'taskflow.billing.subscription.list',
      'taskflow.billing.invoice.list',
      'taskflow.billing.time_to_invoice.read',
      'taskflow.billing.tax.read',
      'taskflow.accounts.invoice.list'
    )
  ) {
    return nav;
  }
  nav.push({ to: '/billing', label: 'Dashboard', icon: <DashboardIcon />, end: true });
  if (allow(user, 'taskflow.billing.time_to_invoice.read', 'taskflow.billing.time_to_invoice.manage', 'taskflow.billing.dashboard.read')) {
    nav.push({ to: '/billing/time-to-invoice', label: 'Time to invoice', icon: <TimesheetIcon /> });
  }
  if (allow(user, 'taskflow.billing.subscription.list', 'taskflow.billing.subscription.manage', 'taskflow.billing.dashboard.read')) {
    nav.push({ to: '/billing/subscriptions', label: 'Subscriptions', icon: <PackageIcon /> });
  }
  if (allow(user, 'taskflow.billing.invoice.list', 'taskflow.billing.invoice.create', 'taskflow.billing.invoice.manage', 'taskflow.billing.dashboard.read')) {
    nav.push({ to: '/billing/invoices', label: 'Invoices', icon: <SettingsIcon /> });
  }
  if (allow(user, 'taskflow.billing.tax.read', 'taskflow.billing.tax.manage', 'taskflow.billing.dashboard.read')) {
    nav.push({ to: '/billing/tax', label: 'Tax & GST', icon: <IssuesIcon /> });
  }
  return nav;
}

/** Assets / CMDB */
export function buildAssetsNav(user: NavUser): NavItem[] {
  const nav: NavItem[] = [];
  if (
    !allow(
      user,
      'taskflow.assets.dashboard.read',
      'taskflow.assets.inventory.list',
      'taskflow.assets.license.list',
      'taskflow.assets.server.list',
      'taskflow.assets.warranty.read'
    )
  ) {
    return nav;
  }
  nav.push({ to: '/assets', label: 'Dashboard', icon: <DashboardIcon />, end: true });
  nav.push({ to: '/assets/inventory', label: 'Inventory', icon: <PackageIcon /> });
  nav.push({ to: '/assets/servers', label: 'Servers', icon: <IssuesIcon /> });
  nav.push({ to: '/assets/licenses', label: 'Licenses', icon: <SettingsIcon /> });
  nav.push({ to: '/assets/warranty', label: 'Warranty', icon: <TimesheetIcon /> });
  return nav;
}

/** Resources — plan staffing then measure */
export function buildResourcesNav(user: NavUser): NavItem[] {
  const nav: NavItem[] = [];
  if (
    !allow(
      user,
      'taskflow.resources.dashboard.read',
      'taskflow.resources.utilization.read',
      'taskflow.resources.bench.read',
      'taskflow.resources.allocation.read',
      'taskflow.resources.forecast.read',
      'taskflow.analytics.view'
    )
  ) {
    return nav;
  }
  if (
    allow(
      user,
      'taskflow.resources.dashboard.read',
      'taskflow.resources.utilization.read',
      'taskflow.resources.bench.read',
      'taskflow.resources.allocation.read',
      'taskflow.resources.forecast.read',
      'taskflow.analytics.view'
    )
  ) {
    nav.push({ to: '/resources', label: 'Dashboard', icon: <DashboardIcon />, end: true });
  }
  if (allow(user, 'taskflow.resources.allocation.read', 'taskflow.resources.allocation.manage')) {
    nav.push({ to: '/resources/allocations', label: 'Allocations', icon: <ProjectsIcon /> });
  }
  if (allow(user, 'taskflow.resources.utilization.read')) {
    nav.push({ to: '/resources/utilization', label: 'Utilization', icon: <TimesheetIcon /> });
  }
  if (allow(user, 'taskflow.resources.bench.read')) {
    nav.push({ to: '/resources/bench', label: 'Bench', icon: <UsersIcon /> });
  }
  if (allow(user, 'taskflow.resources.forecast.read', 'taskflow.resources.forecast.manage')) {
    nav.push({ to: '/resources/forecast', label: 'Forecast', icon: <SettingsIcon /> });
  }
  if (allow(user, 'taskflow.resources.allocation.read')) {
    nav.push({ to: '/resources/conflicts', label: 'Conflicts', icon: <IssuesIcon /> });
  }
  if (
    allow(
      user,
      'taskflow.resources.allocation.read',
      'taskflow.resources.allocation.manage',
      'taskflow.resources.bench.read',
      'taskflow.resources.utilization.read'
    )
  ) {
    nav.push({ to: '/resources/team', label: 'Team', icon: <UsersIcon /> });
  }
  return nav;
}

/** Procurement */
export function buildProcurementNav(user: NavUser): NavItem[] {
  const nav: NavItem[] = [];
  if (
    !allow(
      user,
      'taskflow.procurement.dashboard.read',
      'taskflow.procurement.vendor.list',
      'taskflow.procurement.po.list',
      'taskflow.procurement.license.list'
    )
  ) {
    return nav;
  }
  nav.push({ to: '/procurement', label: 'Dashboard', icon: <DashboardIcon />, end: true });
  nav.push({ to: '/procurement/vendors', label: 'Vendors', icon: <UsersIcon /> });
  nav.push({ to: '/procurement/pos', label: 'Purchase orders', icon: <PackageIcon /> });
  nav.push({ to: '/procurement/licenses', label: 'License buys', icon: <SettingsIcon /> });
  return nav;
}

/** Documents — templates then commercial then policies */
export function buildDocumentsNav(user: NavUser): NavItem[] {
  const nav: NavItem[] = [];
  if (
    !allow(
      user,
      'taskflow.documents.dashboard.read',
      'taskflow.documents.proposal.list',
      'taskflow.documents.sow.list',
      'taskflow.documents.policy.list',
      'taskflow.documents.template.list'
    )
  ) {
    return nav;
  }
  nav.push({ to: '/documents', label: 'Dashboard', icon: <DashboardIcon />, end: true });
  nav.push({ to: '/documents/templates', label: 'Templates', icon: <RolesIcon /> });
  nav.push({ to: '/documents/proposals', label: 'Proposals', icon: <PackageIcon /> });
  nav.push({ to: '/documents/sows', label: 'SOWs', icon: <IssuesIcon /> });
  nav.push({ to: '/documents/policies', label: 'Policies', icon: <SettingsIcon /> });
  return nav;
}

/** Calendar — recurring team vs customer-facing */
export function buildCalendarNav(user: NavUser): NavItem[] {
  const nav: NavItem[] = [];
  if (
    !allow(
      user,
      'taskflow.calendar.dashboard.read',
      'taskflow.calendar.meeting.list',
      'taskflow.calendar.demo.list',
      'taskflow.calendar.review.list'
    )
  ) {
    return nav;
  }
  nav.push({ to: '/calendar', label: 'Dashboard', icon: <DashboardIcon />, end: true });
  nav.push({ to: '/calendar/meetings', label: 'Meetings', icon: <InboxIcon /> });
  nav.push({ to: '/calendar/standups', label: 'Standups', icon: <TimesheetIcon /> });
  nav.push({ to: '/calendar/demos', label: 'Demos', icon: <ProjectsIcon /> });
  nav.push({ to: '/calendar/reviews', label: 'Reviews', icon: <IssuesIcon /> });
  return nav;
}

/** @deprecated use module-specific builders */
export function buildGlobalNav(user: NavUser): NavItem[] {
  return buildPmNav(user);
}
