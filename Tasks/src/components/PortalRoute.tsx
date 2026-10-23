import { Navigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import PortalLayout from './PortalLayout';
import { ModuleLoader } from './loaders/ModuleLoader';

export default function PortalRoute() {
  const { token, user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <ModuleLoader module="app" label="Opening your portal…" className="min-h-screen bg-[color:var(--bg-page)]" />;
  }

  if (!token || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user.userType === 'taskflow') {
    return <Navigate to="/" replace />;
  }

  const mustChangePassword = user?.mustChangePassword ?? false;
  const isProfilePage = location.pathname === '/portal/profile';
  if (mustChangePassword && !isProfilePage) {
    return <Navigate to="/portal/profile" replace />;
  }

  return (
    <PortalLayout>
      <Outlet />
    </PortalLayout>
  );
}
