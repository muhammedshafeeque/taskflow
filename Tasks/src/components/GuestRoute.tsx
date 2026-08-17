import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { resolvePostAuthRoute } from '../lib/postAuthRedirect';

type GuestRouteProps = {
  children: ReactNode;
  /** When true, do not redirect if `?code=` is present (e.g. Microsoft OAuth return on /login). */
  allowOAuthCallback?: boolean;
};

export default function GuestRoute({ children, allowOAuthCallback = false }: GuestRouteProps) {
  const { token, user, loading, switchWorkspace } = useAuth();
  const location = useLocation();
  const [redirectTo, setRedirectTo] = useState<string | null>(null);

  const oauthCode = allowOAuthCallback ? new URLSearchParams(location.search).get('code') : null;
  const skipRedirect = Boolean(oauthCode);
  const returnUrlRaw = new URLSearchParams(location.search).get('returnUrl');
  const safeReturnUrl =
    returnUrlRaw && returnUrlRaw.startsWith('/') && !returnUrlRaw.startsWith('//') ? returnUrlRaw : null;

  useEffect(() => {
    if (loading || !token || skipRedirect) {
      setRedirectTo(null);
      return;
    }
    if (safeReturnUrl) {
      setRedirectTo(safeReturnUrl);
      return;
    }
    let cancelled = false;
    (async () => {
      const path = user ? await resolvePostAuthRoute(user, switchWorkspace) : '/';
      if (!cancelled) setRedirectTo(path);
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, token, user, switchWorkspace, skipRedirect, safeReturnUrl]);

  if (loading || (token && !skipRedirect && redirectTo === null)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[color:var(--bg-page)]">
        <div className="animate-pulse text-[color:var(--text-muted)]">Loading…</div>
      </div>
    );
  }

  if (redirectTo) {
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
}
