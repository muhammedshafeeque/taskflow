import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { PlatformModulesProvider } from './contexts/PlatformModulesContext';
import { usePushRegistration } from './hooks/usePushRegistration';
import { MonitorInstrumentation } from './components/MonitorInstrumentation';
import { AppDisplayTitle } from './hooks/useAppDisplayName';
import { NotificationsProvider } from './contexts/NotificationsContext';
import { TaskflowAuthGuard } from './components/ProtectedRoute';
import HomeLayout from './components/layouts/HomeLayout';
import {
  PmModuleLayout,
  AuthModuleLayout,
  CrmModuleLayout,
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
  MonitorModuleLayout,
  CoreModuleLayout,
} from './components/layouts/ModuleLayouts';
import PortalRoute from './components/PortalRoute';
import GuestRoute from './components/GuestRoute';
import ProjectLayout from './components/ProjectLayout';
import Login from './pages/Login';
import Register from './pages/Register';
import OAuthCallback from './pages/auth/OAuthCallback';
import OAuthError from './pages/auth/OAuthError';
import IdeLogin from './pages/auth/IdeLogin';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import Home from './pages/Home';
import Projects from './pages/Projects';
import ProjectTemplates from './pages/ProjectTemplates';
import Inbox from './pages/Inbox';
import Profile from './pages/Profile';
import NotificationPreferences from './pages/NotificationPreferences';
import SelfService from './pages/me/SelfService';
import ProjectGovernance, { PortalStatusReports } from './pages/ProjectGovernance';
import { PublicRate, PublicStatus } from './pages/PublicPages';
import { HrSettingsPage, HrLeaveTypesPage, HrHolidaysPage, HrOnboardingPage, HrRecruitmentPage, HrAppraisalsPage } from './pages/hrms/HrPeople';
import { BooksSettings, ChartOfAccounts, Journals, FinancialReports, VendorBills, CreditNotes, Banking } from './pages/accounts/Books';
import { CorePreferences, AnnouncementsAdmin, ManagementInsights } from './pages/core/CoreAdmin';
import { ServiceSettingsPage, SavedRepliesPage } from './pages/service/ServiceSettings';
import { CrmCommissions, MailboxSettings } from './pages/crm/CrmSalesTools';
import { MonitorStatusPages, MonitorPostmortems } from './pages/monitor/MonitorStatusAndPostmortems';
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
import Roles from './pages/Roles';
import RolePermissions from './pages/RolePermissions';
import UserPermissions from './pages/UserPermissions';
import Users from './pages/Users';
// Customer Portal pages
import PortalDashboard from './pages/portal/PortalDashboard';
import RequestList from './pages/portal/RequestList';
import NewRequest from './pages/portal/NewRequest';
import RequestDetail from './pages/portal/RequestDetail';
import PortalTeam from './pages/portal/PortalTeam';
import PortalRoles from './pages/portal/PortalRoles';
import PortalProjects from './pages/portal/PortalProjects';
import PortalTickets from './pages/portal/PortalTickets';
import PortalTicketDetail from './pages/portal/PortalTicketDetail';
import PortalApprovalQueue from './pages/portal/PortalApprovalQueue';
import PortalProfile from './pages/portal/PortalProfile';
// Admin customer pages
import CustomerOrgs from './pages/admin/CustomerOrgs';
import CustomerOrgDetail from './pages/admin/CustomerOrgDetail';
import CustomerRequestApprovals from './pages/admin/CustomerRequestApprovals';
import StandaloneAppSettings from './pages/StandaloneAppSettings';
import KnowledgeBase from './pages/service/KnowledgeBase';
import CrmDashboard from './pages/crm/CrmDashboard';
import CrmAccounts from './pages/crm/CrmAccounts';
import CrmAccountDetail from './pages/crm/CrmAccountDetail';
import CrmContacts from './pages/crm/CrmContacts';
import CrmDeals from './pages/crm/CrmDeals';
import CrmLeads from './pages/crm/CrmLeads';
import CrmLeadForm from './pages/crm/CrmLeadForm';
import CrmLeadDetail from './pages/crm/CrmLeadDetail';
import CrmQuotes from './pages/crm/CrmQuotes';
import CrmQuoteDetail from './pages/crm/CrmQuoteDetail';
import CrmQuoteForm from './pages/crm/CrmQuoteForm';
import CrmActivities from './pages/crm/CrmActivities';
import CrmCampaigns from './pages/crm/CrmCampaigns';
import CrmCampaignDetail from './pages/crm/CrmCampaignDetail';
import CrmFollowUps from './pages/crm/CrmFollowUps';
import CrmContracts from './pages/crm/CrmContracts';
import CrmSettings from './pages/crm/CrmSettings';

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
  ContractsHourly,
  ContractsRenewals,
  ContractsSlas,
  ContractsAgreementDetail,
} from './pages/contracts/ContractsSections';
import BillingDashboard from './pages/billing/BillingDashboard';
import {
  BillingSubscriptions,
  BillingTimeToInvoice,
  BillingInvoices,
  BillingTax,
} from './pages/billing/BillingSections';
import BillingInvoiceForm from './pages/billing/BillingInvoiceForm';
import BillingInvoiceDetail from './pages/billing/BillingInvoiceDetail';
import CoreCompany from './pages/core/CoreCompany';
import CoreCurrencies from './pages/core/CoreCurrencies';
import CoreExchangeRates from './pages/core/CoreExchangeRates';
import CoreModules from './pages/core/CoreModules';
import AssetsDashboard from './pages/assets/AssetsDashboard';
import {
  AssetsInventory,
  AssetsLicenses,
  AssetsServers,
  AssetsWarranty,
} from './pages/assets/AssetsSections';
import ResourcesDashboard from './pages/resources/ResourcesDashboard';
import ResourcesEngagement from './pages/resources/ResourcesEngagement';
import ResourcesUtilization from './pages/resources/ResourcesUtilization';
import ResourcesBench from './pages/resources/ResourcesBench';
import ResourcesAllocations from './pages/resources/ResourcesAllocations';
import ResourcesSchedule from './pages/resources/ResourcesSchedule';
import ResourcesForecast from './pages/resources/ResourcesForecast';
import ResourcesConflicts from './pages/resources/ResourcesConflicts';
import ResourcesTeam from './pages/resources/ResourcesTeam';
import ResourcesTeams from './pages/resources/ResourcesTeams';
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
import MonitorProjects from './pages/monitor/MonitorProjects';
import MonitorWorkspace from './pages/monitor/MonitorWorkspace';
import MonitorOverview from './pages/monitor/MonitorOverview';
import MonitorSetup from './pages/monitor/MonitorSetup';
import MonitorTelemetry from './pages/monitor/MonitorTelemetry';
import MonitorAlerts from './pages/monitor/MonitorAlerts';
import PublicSign from './pages/PublicSign';
import { I18nProvider } from './i18n/I18nProvider';

function PortalResetPasswordRedirect() {
  const [params] = useSearchParams();
  const q = params.toString();
  return <Navigate to={q ? `/reset-password?${q}` : '/reset-password'} replace />;
}

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
      <Route path="/auth/ide" element={<IdeLogin />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/sign/:token" element={<PublicSign />} />
      <Route path="/rate/:token" element={<PublicRate />} />
      <Route path="/status/:slug" element={<PublicStatus />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/portal/login" element={<Navigate to="/login" replace />} />
      <Route path="/portal/reset-password" element={<PortalResetPasswordRedirect />} />
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
        <Route path="/portal/tickets" element={<PortalTickets />} />
        <Route path="/portal/tickets/:id" element={<PortalTicketDetail />} />
        <Route path="/portal/approval-queue" element={<PortalApprovalQueue />} />
        <Route path="/portal/status-reports" element={<PortalStatusReports />} />
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
          <Route path="governance" element={<ProjectGovernance />} />
          <Route path="defect-metrics" element={<DefectMetrics />} />
          <Route path="timesheet" element={<Timesheet />} />
        </Route>
        </Route>

        {/* Auth module — users, roles & organization */}
        <Route element={<AuthModuleLayout />}>
          <Route path="/users" element={<Users />} />
          <Route path="/users/:userId/permissions" element={<UserPermissions />} />
          <Route path="/roles" element={<Roles />} />
          <Route path="/roles/:roleId/permissions" element={<RolePermissions />} />
        </Route>

        {/* CRM module */}
        <Route element={<CrmModuleLayout />}>
        <Route path="/crm" element={<CrmDashboard />} />
        <Route path="/crm/accounts" element={<CrmAccounts />} />
        <Route path="/crm/accounts/:id" element={<CrmAccountDetail />} />
        <Route path="/crm/contacts" element={<CrmContacts />} />
        <Route path="/crm/deals" element={<CrmDeals />} />
        <Route path="/crm/leads" element={<CrmLeads />} />
        <Route path="/crm/leads/new" element={<CrmLeadForm />} />
        <Route path="/crm/leads/:id/edit" element={<CrmLeadForm />} />
        <Route path="/crm/leads/:id" element={<CrmLeadDetail />} />
        <Route path="/crm/quotes" element={<CrmQuotes />} />
        <Route path="/crm/quotes/new" element={<CrmQuoteForm />} />
        <Route path="/crm/quotes/:id/edit" element={<CrmQuoteForm />} />
        <Route path="/crm/quotes/:id" element={<CrmQuoteDetail />} />
        <Route path="/crm/activities" element={<CrmActivities />} />
        <Route path="/crm/follow-ups" element={<CrmFollowUps />} />
        <Route path="/crm/campaigns" element={<CrmCampaigns />} />
        <Route path="/crm/campaigns/:id" element={<CrmCampaignDetail />} />
        <Route path="/crm/contracts" element={<CrmContracts />} />
        <Route path="/crm/settings" element={<CrmSettings />} />
        <Route path="/crm/commissions" element={<CrmCommissions />} />
        <Route path="/crm/email-sync" element={<MailboxSettings />} />
        </Route>

        {/* Service desk module */}
        <Route element={<ServiceModuleLayout />}>
        <Route path="/service" element={<ServiceDashboard />} />
        <Route path="/service/tickets" element={<ServiceDesk />} />
        <Route path="/service/sla" element={<ServiceSla />} />
        <Route path="/service/kb" element={<KnowledgeBase />} />
        <Route path="/service/settings" element={<ServiceSettingsPage />} />
        <Route path="/service/saved-replies" element={<SavedRepliesPage />} />
        </Route>

        {/* HRMS module */}
        <Route element={<HrmsModuleLayout />}>
          <Route path="/hrms" element={<HrmsDashboard />} />
          <Route path="/hrms/employees" element={<HrmsEmployees />} />
          <Route path="/hrms/attendance" element={<HrmsAttendance />} />
          <Route path="/hrms/leave" element={<HrmsLeave />} />
          <Route path="/hrms/payroll" element={<HrmsPayroll />} />
          <Route path="/hrms/settings" element={<HrSettingsPage />} />
          <Route path="/hrms/leave-types" element={<HrLeaveTypesPage />} />
          <Route path="/hrms/holidays" element={<HrHolidaysPage />} />
          <Route path="/hrms/onboarding" element={<HrOnboardingPage />} />
          <Route path="/hrms/recruitment" element={<HrRecruitmentPage />} />
          <Route path="/hrms/appraisals" element={<HrAppraisalsPage />} />
        </Route>

        {/* Accounts (finance) module */}
        <Route element={<AccountsModuleLayout />}>
          <Route path="/accounts" element={<AccountsDashboard />} />
          <Route path="/accounts/ledger" element={<AccountsLedger />} />
          <Route path="/accounts/invoices" element={<AccountsInvoices />} />
          <Route path="/accounts/expenses" element={<AccountsExpenses />} />
          <Route path="/accounts/reports" element={<AccountsReports />} />
          <Route path="/accounts/statements" element={<FinancialReports />} />
          <Route path="/accounts/journals" element={<Journals />} />
          <Route path="/accounts/bills" element={<VendorBills />} />
          <Route path="/accounts/credit-notes" element={<CreditNotes />} />
          <Route path="/accounts/banking" element={<Banking />} />
          <Route path="/accounts/chart" element={<ChartOfAccounts />} />
          <Route path="/accounts/books-settings" element={<BooksSettings />} />
          <Route path="/cost-usage" element={<CostUsage />} />
        </Route>

        {/* Contracts */}
        <Route element={<ContractsModuleLayout />}>
          <Route path="/contracts" element={<ContractsDashboard />} />
          <Route path="/contracts/msas" element={<ContractsMsas />} />
          <Route path="/contracts/retainers" element={<ContractsRetainers />} />
          <Route path="/contracts/hourly" element={<ContractsHourly />} />
          <Route path="/contracts/renewals" element={<ContractsRenewals />} />
          <Route path="/contracts/slas" element={<ContractsSlas />} />
          <Route path="/contracts/:id" element={<ContractsAgreementDetail />} />
        </Route>

        {/* Billing */}
        <Route element={<BillingModuleLayout />}>
          <Route path="/billing" element={<BillingDashboard />} />
          <Route path="/billing/subscriptions" element={<BillingSubscriptions />} />
          <Route path="/billing/time-to-invoice" element={<BillingTimeToInvoice />} />
          <Route path="/billing/invoices" element={<BillingInvoices />} />
          <Route path="/billing/invoices/new" element={<BillingInvoiceForm />} />
          <Route path="/billing/invoices/:id/edit" element={<BillingInvoiceForm />} />
          <Route path="/billing/invoices/:id" element={<BillingInvoiceDetail />} />
          <Route path="/billing/tax" element={<BillingTax />} />
        </Route>

        {/* Core */}
        <Route element={<CoreModuleLayout />}>
          <Route path="/core" element={<Navigate to="/core/company" replace />} />
          <Route path="/core/company" element={<CoreCompany />} />
          <Route path="/core/currencies" element={<CoreCurrencies />} />
          <Route path="/core/exchange-rates" element={<CoreExchangeRates />} />
          <Route path="/core/modules" element={<CoreModules />} />
          <Route path="/core/preferences" element={<CorePreferences />} />
          <Route path="/core/announcements" element={<AnnouncementsAdmin />} />
          <Route path="/core/insights" element={<ManagementInsights />} />
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
          <Route path="/resources/engagement" element={<ResourcesEngagement />} />
          <Route path="/resources/bench" element={<ResourcesBench />} />
          <Route path="/resources/allocations" element={<ResourcesAllocations />} />
          <Route path="/resources/schedule" element={<ResourcesSchedule />} />
          <Route path="/resources/forecast" element={<ResourcesForecast />} />
          <Route path="/resources/conflicts" element={<ResourcesConflicts />} />
          <Route path="/resources/team" element={<ResourcesTeam />} />
          <Route path="/resources/teams" element={<ResourcesTeams />} />
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

        {/* Project Monitor */}
        <Route element={<MonitorModuleLayout />}>
          <Route path="/monitor" element={<MonitorProjects />} />
          <Route path="/monitor/status-pages" element={<MonitorStatusPages />} />
          <Route path="/monitor/postmortems" element={<MonitorPostmortems />} />
          <Route path="/monitor/:monitorProjectId" element={<MonitorWorkspace />}>
            <Route index element={<MonitorOverview />} />
            <Route path="setup" element={<MonitorSetup />} />
            <Route path="alerts" element={<MonitorAlerts />} />
            <Route path="logs" element={<MonitorTelemetry />} />
            <Route path="errors" element={<MonitorTelemetry />} />
            <Route path="live" element={<MonitorTelemetry />} />
            <Route path="performance" element={<MonitorTelemetry />} />
            <Route path="http" element={<MonitorTelemetry />} />
            <Route path="vitals" element={<MonitorTelemetry />} />
            <Route path="uptime" element={<MonitorTelemetry />} />
            <Route path="releases" element={<MonitorTelemetry />} />
            <Route path="events" element={<MonitorTelemetry />} />
            <Route path="devices" element={<MonitorTelemetry />} />
          </Route>
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
        <Route path="/me" element={<SelfService />} />
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
        <I18nProvider>
        <AuthProvider>
          <PlatformModulesProvider>
            <AppWithNotifications />
          </PlatformModulesProvider>
        </AuthProvider>
        </I18nProvider>
      </ThemeInit>
    </BrowserRouter>
  );
}

function AppWithNotifications() {
  const { token } = useAuth();
  usePushRegistration(token);
  return (
    <NotificationsProvider token={token}>
      <MonitorInstrumentation />
      <AppDisplayTitle />
      <AppRoutes />
    </NotificationsProvider>
  );
}
