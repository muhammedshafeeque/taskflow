import { Navigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ModuleLoader } from './loaders/ModuleLoader';

/** Auth + customer check only; renders child routes. */
export function TaskflowAuthGuard() {
  const { token, user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <ModuleLoader module="app" label="Restoring your session…" className="min-h-screen bg-[color:var(--bg-page)]" />;
  }

  if (!token || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user.userType === 'customer') return <Navigate to="/portal" replace />;

  // Workspace policy requires 2FA: send the user to set it up first.
  if (user?.mustSetupTwoFactor && location.pathname !== '/profile') {
    return <Navigate to="/profile?setup2fa=1" replace />;
  }

  return <Outlet />;
}

/** @deprecated Use module-specific layouts in App.tsx. */
export default function TaskflowAppShell() {
  return <Outlet />;
}
