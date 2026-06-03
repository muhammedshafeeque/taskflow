import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { usePushRegistration } from './hooks/usePushRegistration';
import { NotificationsProvider } from './contexts/NotificationsContext';
import TaskflowAppShell, { TaskflowAuthGuard } from './components/ProtectedRoute';
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
import ProjectImport from './pages/ProjectImport';
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

      {/* TaskFlow internal routes: auth guard, then standalone workspace hub or Project Manager shell */}
      <Route element={<TaskflowAuthGuard />}>
        <Route path="/app-settings" element={<StandaloneAppSettings />} />
        <Route element={<TaskflowAppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/profile/notifications" element={<NotificationPreferences />} />
        <Route path="/settings/workspace" element={<TaskflowWorkspaceSettings />} />
        <Route path="/issues" element={<GlobalIssues />} />
        <Route path="/workload" element={<Workload />} />
        <Route path="/estimates" element={<Estimates />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/executive" element={<ExecutiveDashboard />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/audit-logs" element={<AuditLogs />} />
        <Route path="/users" element={<Users />} />
        <Route path="/roles" element={<Roles />} />

        <Route path="/timesheet" element={<Timesheet />} />
        <Route path="/defect-metrics" element={<DefectMetrics />} />
        <Route path="/cost-usage" element={<CostUsage />} />
        <Route path="/performance-report" element={<PerformanceReport />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/project-templates" element={<ProjectTemplates />} />
        {/* Admin: customer organisation management */}
        <Route path="/admin/customer-orgs" element={<CustomerOrgs />} />
        <Route path="/admin/customer-orgs/:id" element={<CustomerOrgDetail />} />
        <Route path="/admin/customer-requests" element={<CustomerRequestApprovals />} />
        <Route path="/projects/:projectId" element={<ProjectLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<ProjectDashboard />} />
          <Route path="issues" element={<Issues />} />
          <Route path="issues/:ticketId" element={<IssueDetail />} />
          <Route path="link-graph" element={<IssueLinkGraph />} />
          <Route path="import" element={<ProjectImport />} />
          <Route path="boards" element={<Boards />} />
          <Route path="backlog" element={<Backlog />} />
          <Route path="sprints" element={<Sprints />} />
          <Route path="sprints/:sprintId/report" element={<SprintReport />} />
          <Route path="versions" element={<Versions />} />
          <Route path="gantt" element={<Gantt />} />
          <Route path="roadmap" element={<Roadmap />} />
          <Route path="settings" element={<ProjectSettings />} />
          <Route path="test-cases" element={<TestCases />} />
          <Route path="test-plans" element={<TestPlans />} />
          <Route path="test-plans/:planId/cycles/:cycleId/run" element={<TestCycleRun />} />
          <Route path="traceability" element={<Traceability />} />
          <Route path="defect-metrics" element={<DefectMetrics />} />
          <Route path="timesheet" element={<Timesheet />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
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
