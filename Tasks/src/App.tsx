import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { usePushRegistration } from './hooks/usePushRegistration';
import { NotificationsProvider } from './contexts/NotificationsContext';
import { TaskflowAuthGuard } from './components/ProtectedRoute';
import HomeLayout from './components/layouts/HomeLayout';
import {
  PmModuleLayout,
  AuthModuleLayout,
  CrmModuleLayout,
  MailModuleLayout,
  ServiceModuleLayout,
  PortalAdminModuleLayout,
  InboxModuleLayout,
  HrmsModuleLayout,
  AccountsModuleLayout,
  ContractsModuleLayout,
  BillingModuleLayout,
  AssetsModuleLayout,
  ResourcesModuleLayout,
  ProcurementModuleLayout,
  DocumentsModuleLayout,
  CalendarModuleLayout,
} from './components/layouts/ModuleLayouts';
import PortalRoute from './components/PortalRoute';
import GuestRoute from './components/GuestRoute';
import ProjectLayout from './components/ProjectLayout';
import Login from './pages/Login';
import Register from './pages/Register';
import OAuthCallback from './pages/auth/OAuthCallback';
import OAuthError from './pages/auth/OAuthError';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import Home from './pages/Home';
import Projects from './pages/Projects';
import ProjectTemplates from './pages/ProjectTemplates';
import Inbox from './pages/Inbox';
import Profile from './pages/Profile';
import NotificationPreferences from './pages/NotificationPreferences';
import Issues from './pages/Issues';
import GlobalIssues from './pages/GlobalIssues';
import Workload from './pages/Workload';
import Estimates from './pages/Estimates';
import Portfolio from './pages/Portfolio';
import ExecutiveDashboard from './pages/ExecutiveDashboard';
import Analytics from './pages/Analytics';
import TestCases from './pages/TestCases';
import TestPlans from './pages/TestPlans';
import TestCycleRun from './pages/TestCycleRun';
import DefectMetrics from './pages/DefectMetrics';
import CostUsage from './pages/CostUsage';
import PerformanceReport from './pages/PerformanceReport';
import Reports from './pages/Reports';
import Traceability from './pages/Traceability';
import AuditLogs from './pages/AuditLogs';
import IssueDetail from './pages/IssueDetail';
import Boards from './pages/Boards';
import Backlog from './pages/Backlog';
import Sprints from './pages/Sprints';
import SprintReport from './pages/SprintReport';
import Gantt from './pages/Gantt';
import Roadmap from './pages/Roadmap';
import ProjectDashboard from './pages/ProjectDashboard';
import ProjectSettings from './pages/ProjectSettings';
import EstimateApprovals from './pages/EstimateApprovals';
import ProjectImport from './pages/ProjectImport';
import ProjectAdoSync from './pages/ProjectAdoSync';
import IssueLinkGraph from './pages/IssueLinkGraph';
import Versions from './pages/Versions';
import Timesheet from './pages/Timesheet';
import Users from './pages/Users';
import Roles from './pages/Roles';
// Customer Portal pages
import PortalDashboard from './pages/portal/PortalDashboard';
import RequestList from './pages/portal/RequestList';
import NewRequest from './pages/portal/NewRequest';
import RequestDetail from './pages/portal/RequestDetail';
import PortalTeam from './pages/portal/PortalTeam';
import PortalRoles from './pages/portal/PortalRoles';
import PortalProjects from './pages/portal/PortalProjects';
import PortalApprovalQueue from './pages/portal/PortalApprovalQueue';
import PortalProfile from './pages/portal/PortalProfile';
// Admin customer pages
import CustomerOrgs from './pages/admin/CustomerOrgs';
import CustomerOrgDetail from './pages/admin/CustomerOrgDetail';
import CustomerRequestApprovals from './pages/admin/CustomerRequestApprovals';
import StandaloneAppSettings from './pages/StandaloneAppSettings';
import TaskflowWorkspaceSettings from './pages/TaskflowWorkspaceSettings';
import KnowledgeBase from './pages/service/KnowledgeBase';
import CrmDashboard from './pages/crm/CrmDashboard';
import CrmAccounts from './pages/crm/CrmAccounts';
import CrmAccountDetail from './pages/crm/CrmAccountDetail';
import CrmContacts from './pages/crm/CrmContacts';
import CrmDeals from './pages/crm/CrmDeals';
import CrmLeads from './pages/crm/CrmLeads';
import CrmQuotes from './pages/crm/CrmQuotes';
import CrmActivities from './pages/crm/CrmActivities';
import CrmContracts from './pages/crm/CrmContracts';
import CrmSettings from './pages/crm/CrmSettings';

import MailInbox from './pages/mail/MailInbox';
import MailCompose from './pages/mail/MailCompose';
import ServiceDesk from './pages/service/ServiceDesk';
import ServiceDashboard from './pages/service/ServiceDashboard';
import ServiceSla from './pages/service/ServiceSla';
import HrmsDashboard from './pages/hrms/HrmsDashboard';
import { HrmsEmployees, HrmsAttendance, HrmsLeave, HrmsPayroll } from './pages/hrms/HrmsSections';
import AccountsDashboard from './pages/accounts/AccountsDashboard';
import {
  AccountsLedger,
  AccountsInvoices,
  AccountsExpenses,
  AccountsReports,
} from './pages/accounts/AccountsSections';
import ContractsDashboard from './pages/contracts/ContractsDashboard';
import {
  ContractsMsas,
  ContractsRetainers,
  ContractsRenewals,
  ContractsSlas,
} from './pages/contracts/ContractsSections';
import BillingDashboard from './pages/billing/BillingDashboard';
import {
  BillingSubscriptions,
  BillingTimeToInvoice,
  BillingInvoices,
  BillingTax,
} from './pages/billing/BillingSections';
import AssetsDashboard from './pages/assets/AssetsDashboard';
import {
  AssetsInventory,
  AssetsLicenses,
  AssetsServers,
  AssetsWarranty,
} from './pages/assets/AssetsSections';
import ResourcesDashboard from './pages/resources/ResourcesDashboard';
import {
  ResourcesUtilization,
  ResourcesBench,
  ResourcesAllocations,
  ResourcesForecast,
  ResourcesConflicts,
  ResourcesTeam,
} from './pages/resources/ResourcesSections';
import ProcurementDashboard from './pages/procurement/ProcurementDashboard';
import {
  ProcurementVendors,
  ProcurementPos,
  ProcurementLicenses,
} from './pages/procurement/ProcurementSections';
import DocumentsDashboard from './pages/documents/DocumentsDashboard';
import {
  DocumentsProposals,
  DocumentsSows,
  DocumentsPolicies,
  DocumentsTemplates,
} from './pages/documents/DocumentsSections';
import CalendarDashboard from './pages/calendar/CalendarDashboard';
import {
  CalendarMeetings,
  CalendarDemos,
  CalendarReviews,
  CalendarStandups,
} from './pages/calendar/CalendarSections';

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <GuestRoute allowOAuthCallback>
            <Login />
          </GuestRoute>
        }
      />
      <Route path="/auth/oauth-callback" element={<OAuthCallback />} />
      <Route path="/auth/error" element={<OAuthError />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/register" element={<Register />} />

      {/* Customer Portal routes */}
      <Route element={<PortalRoute />}>
        <Route path="/portal" element={<PortalDashboard />} />
        <Route path="/portal/profile" element={<PortalProfile />} />
        <Route path="/portal/requests" element={<RequestList />} />
        <Route path="/portal/requests/new" element={<NewRequest />} />
        <Route path="/portal/requests/:id" element={<RequestDetail />} />
        <Route path="/portal/team" element={<PortalTeam />} />
        <Route path="/portal/roles" element={<PortalRoles />} />
        <Route path="/portal/projects" element={<PortalProjects />} />
        <Route path="/portal/approval-queue" element={<PortalApprovalQueue />} />
      </Route>

      {/* Atrium internal routes: auth guard, then standalone workspace hub or Project Manager shell */}
      <Route element={<TaskflowAuthGuard />}>
        <Route path="/app-settings" element={<StandaloneAppSettings />} />

        {/* Home hub — no sidebar */}
        <Route element={<HomeLayout />}>
          <Route path="/" element={<Home />} />
        </Route>

        {/* Project Manager module */}
        <Route element={<PmModuleLayout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/issues" element={<GlobalIssues />} />
        <Route path="/workload" element={<Workload />} />
        <Route path="/estimates" element={<Estimates />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/executive" element={<ExecutiveDashboard />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/audit-logs" element={<AuditLogs />} />
        <Route path="/timesheet" element={<Timesheet />} />
        <Route path="/defect-metrics" element={<DefectMetrics />} />
        <Route path="/performance-report" element={<PerformanceReport />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/project-templates" element={<ProjectTemplates />} />
        <Route path="/projects/:projectId" element={<ProjectLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<ProjectDashboard />} />
          <Route path="issues" element={<Issues />} />
          <Route path="issues/:ticketId" element={<IssueDetail />} />
          <Route path="link-graph" element={<IssueLinkGraph />} />
          <Route path="import" element={<ProjectImport />} />
          <Route path="ado-sync" element={<ProjectAdoSync />} />
          <Route path="boards" element={<Boards />} />
          <Route path="backlog" element={<Backlog />} />
          <Route path="sprints" element={<Sprints />} />
          <Route path="sprints/:sprintId/report" element={<SprintReport />} />
          <Route path="versions" element={<Versions />} />
          <Route path="gantt" element={<Gantt />} />
          <Route path="roadmap" element={<Roadmap />} />
          <Route path="settings" element={<ProjectSettings />} />
          <Route path="estimate-approvals" element={<EstimateApprovals />} />
          <Route path="test-cases" element={<TestCases />} />
          <Route path="test-plans" element={<TestPlans />} />
          <Route path="test-plans/:planId/cycles/:cycleId/run" element={<TestCycleRun />} />
          <Route path="traceability" element={<Traceability />} />
          <Route path="defect-metrics" element={<DefectMetrics />} />
          <Route path="timesheet" element={<Timesheet />} />
        </Route>
        </Route>

        {/* Auth module — users, roles & organization */}
        <Route element={<AuthModuleLayout />}>
          <Route path="/users" element={<Users />} />
          <Route path="/roles" element={<Roles />} />
          <Route path="/settings/workspace" element={<TaskflowWorkspaceSettings />} />
        </Route>

        {/* CRM module */}
        <Route element={<CrmModuleLayout />}>
        <Route path="/crm" element={<CrmDashboard />} />
        <Route path="/crm/accounts" element={<CrmAccounts />} />
        <Route path="/crm/accounts/:id" element={<CrmAccountDetail />} />
        <Route path="/crm/contacts" element={<CrmContacts />} />
        <Route path="/crm/deals" element={<CrmDeals />} />
        <Route path="/crm/leads" element={<CrmLeads />} />
        <Route path="/crm/quotes" element={<CrmQuotes />} />
        <Route path="/crm/activities" element={<CrmActivities />} />
        <Route path="/crm/contracts" element={<CrmContracts />} />
        <Route path="/crm/settings" element={<CrmSettings />} />
        </Route>

        {/* Mail module */}
        <Route element={<MailModuleLayout />}>
        <Route path="/mail" element={<MailInbox />} />
        <Route path="/mail/compose" element={<MailCompose />} />
        </Route>

        {/* Service desk module */}
        <Route element={<ServiceModuleLayout />}>
        <Route path="/service" element={<ServiceDashboard />} />
        <Route path="/service/tickets" element={<ServiceDesk />} />
        <Route path="/service/sla" element={<ServiceSla />} />
        <Route path="/service/kb" element={<KnowledgeBase />} />
        </Route>

        {/* HRMS module */}
        <Route element={<HrmsModuleLayout />}>
          <Route path="/hrms" element={<HrmsDashboard />} />
          <Route path="/hrms/employees" element={<HrmsEmployees />} />
          <Route path="/hrms/attendance" element={<HrmsAttendance />} />
          <Route path="/hrms/leave" element={<HrmsLeave />} />
          <Route path="/hrms/payroll" element={<HrmsPayroll />} />
        </Route>

        {/* Accounts (finance) module */}
        <Route element={<AccountsModuleLayout />}>
          <Route path="/accounts" element={<AccountsDashboard />} />
          <Route path="/accounts/ledger" element={<AccountsLedger />} />
          <Route path="/accounts/invoices" element={<AccountsInvoices />} />
          <Route path="/accounts/expenses" element={<AccountsExpenses />} />
          <Route path="/accounts/reports" element={<AccountsReports />} />
          <Route path="/cost-usage" element={<CostUsage />} />
        </Route>

        {/* Contracts */}
        <Route element={<ContractsModuleLayout />}>
          <Route path="/contracts" element={<ContractsDashboard />} />
          <Route path="/contracts/msas" element={<ContractsMsas />} />
          <Route path="/contracts/retainers" element={<ContractsRetainers />} />
          <Route path="/contracts/renewals" element={<ContractsRenewals />} />
          <Route path="/contracts/slas" element={<ContractsSlas />} />
        </Route>

        {/* Billing */}
        <Route element={<BillingModuleLayout />}>
          <Route path="/billing" element={<BillingDashboard />} />
          <Route path="/billing/subscriptions" element={<BillingSubscriptions />} />
          <Route path="/billing/time-to-invoice" element={<BillingTimeToInvoice />} />
          <Route path="/billing/invoices" element={<BillingInvoices />} />
          <Route path="/billing/tax" element={<BillingTax />} />
        </Route>

        {/* Assets / CMDB */}
        <Route element={<AssetsModuleLayout />}>
          <Route path="/assets" element={<AssetsDashboard />} />
          <Route path="/assets/inventory" element={<AssetsInventory />} />
          <Route path="/assets/licenses" element={<AssetsLicenses />} />
          <Route path="/assets/servers" element={<AssetsServers />} />
          <Route path="/assets/warranty" element={<AssetsWarranty />} />
        </Route>

        {/* Resources */}
        <Route element={<ResourcesModuleLayout />}>
          <Route path="/resources" element={<ResourcesDashboard />} />
          <Route path="/resources/utilization" element={<ResourcesUtilization />} />
          <Route path="/resources/bench" element={<ResourcesBench />} />
          <Route path="/resources/allocations" element={<ResourcesAllocations />} />
          <Route path="/resources/forecast" element={<ResourcesForecast />} />
          <Route path="/resources/conflicts" element={<ResourcesConflicts />} />
          <Route path="/resources/team" element={<ResourcesTeam />} />
        </Route>

        {/* Procurement */}
        <Route element={<ProcurementModuleLayout />}>
          <Route path="/procurement" element={<ProcurementDashboard />} />
          <Route path="/procurement/vendors" element={<ProcurementVendors />} />
          <Route path="/procurement/pos" element={<ProcurementPos />} />
          <Route path="/procurement/licenses" element={<ProcurementLicenses />} />
        </Route>

        {/* Documents */}
        <Route element={<DocumentsModuleLayout />}>
          <Route path="/documents" element={<DocumentsDashboard />} />
          <Route path="/documents/proposals" element={<DocumentsProposals />} />
          <Route path="/documents/sows" element={<DocumentsSows />} />
          <Route path="/documents/policies" element={<DocumentsPolicies />} />
          <Route path="/documents/templates" element={<DocumentsTemplates />} />
        </Route>

        {/* Calendar */}
        <Route element={<CalendarModuleLayout />}>
          <Route path="/calendar" element={<CalendarDashboard />} />
          <Route path="/calendar/meetings" element={<CalendarMeetings />} />
          <Route path="/calendar/demos" element={<CalendarDemos />} />
          <Route path="/calendar/reviews" element={<CalendarReviews />} />
          <Route path="/calendar/standups" element={<CalendarStandups />} />
        </Route>

        {/* Customer portal admin module */}
        <Route element={<PortalAdminModuleLayout />}>
        <Route path="/admin/customer-orgs" element={<CustomerOrgs />} />
        <Route path="/admin/customer-orgs/:id" element={<CustomerOrgDetail />} />
        <Route path="/admin/customer-requests" element={<CustomerRequestApprovals />} />
        </Route>

        {/* Inbox & profile */}
        <Route element={<InboxModuleLayout />}>
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/profile/notifications" element={<NotificationPreferences />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function ThemeInit({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const stored = localStorage.getItem('taskflow_theme');
    if (stored === 'light' || stored === 'dark') {
      document.documentElement.dataset.theme = stored;
    } else if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
      document.documentElement.dataset.theme = 'light';
    } else {
      document.documentElement.dataset.theme = 'dark';
    }
  }, []);
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeInit>
        <AuthProvider>
          <AppWithNotifications />
        </AuthProvider>
      </ThemeInit>
    </BrowserRouter>
  );
}

function AppWithNotifications() {
  const { token } = useAuth();
  usePushRegistration(token);
  return (
    <NotificationsProvider token={token}>
      <AppRoutes />
    </NotificationsProvider>
  );
}
