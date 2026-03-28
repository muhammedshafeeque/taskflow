import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { usePushRegistration } from './hooks/usePushRegistration';
import { NotificationsProvider } from './contexts/NotificationsContext';
import ProtectedRoute from './components/ProtectedRoute';
import ProjectLayout from './components/ProjectLayout';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import ProjectTemplates from './pages/ProjectTemplates';
import Inbox from './pages/Inbox';
import Profile from './pages/Profile';
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
import Versions from './pages/Versions';
import Timesheet from './pages/Timesheet';
import Users from './pages/Users';
import Designations from './pages/Designations';
import Roles from './pages/Roles';

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/register" element={<Navigate to="/login" replace />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/issues" element={<GlobalIssues />} />
        <Route path="/workload" element={<Workload />} />
        <Route path="/estimates" element={<Estimates />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/executive" element={<ExecutiveDashboard />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/audit-logs" element={<AuditLogs />} />
        <Route path="/users" element={<Users />} />
        <Route path="/designations" element={<Designations />} />
        <Route path="/roles" element={<Roles />} />
        <Route path="/timesheet" element={<Timesheet />} />
        <Route path="/defect-metrics" element={<DefectMetrics />} />
        <Route path="/cost-usage" element={<CostUsage />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/project-templates" element={<ProjectTemplates />} />
        <Route path="/projects/:projectId" element={<ProjectLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<ProjectDashboard />} />
          <Route path="issues" element={<Issues />} />
          <Route path="issues/:ticketId" element={<IssueDetail />} />
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
