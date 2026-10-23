import { Navigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import PortalLayout from './PortalLayout';

export default function PortalRoute() {
  const { token, user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[color:var(--bg-page)]">
        <div className="animate-pulse text-[color:var(--text-muted)]">Loading…</div>
      </div>
    );
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
