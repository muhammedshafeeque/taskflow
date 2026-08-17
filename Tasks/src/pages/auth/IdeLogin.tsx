import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { authApi } from '../../lib/api';
import { APP_NAME } from '../../brand';

export default function IdeLogin() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { token, user, loading } = useAuth();
  const sid = params.get('sid') ?? '';
  const [error, setError] = useState('');
  const [status, setStatus] = useState<'idle' | 'approving' | 'redirecting'>('idle');

  const returnUrl = useMemo(() => {
    if (!sid) return '/auth/ide';
    return `/auth/ide?sid=${encodeURIComponent(sid)}`;
  }, [sid]);

  useEffect(() => {
    if (loading) return;
    if (!sid) {
      setError('Missing IDE login session. Start sign-in again from the Atrium Workbench extension.');
      return;
    }
    if (!token || !user) {
      navigate(`/login?returnUrl=${encodeURIComponent(returnUrl)}`, { replace: true });
      return;
    }
    if (user.userType === 'customer') {
      setError('IDE login is only available for Atrium workspace users.');
      return;
    }

    let cancelled = false;
    (async () => {
      setStatus('approving');
      const res = await authApi.ideApprove(sid, token);
      if (cancelled) return;
      if (!res.success || !res.data) {
        setError(res.message || 'Could not approve IDE login. The session may have expired.');
        setStatus('idle');
        return;
      }
      const { code, redirectUri, state } = res.data;
      setStatus('redirecting');
      const url = new URL(redirectUri);
      url.searchParams.set('code', code);
      url.searchParams.set('state', state);
      window.location.href = url.toString();
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, sid, token, user, navigate, returnUrl]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-[color:var(--bg-page)]">
      <div className="w-full max-w-md rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-modal)] p-8 shadow-lg text-center">
        <h1 className="text-lg font-semibold text-[color:var(--text-primary)]">{APP_NAME} Workbench</h1>
        {error ? (
          <>
            <p className="mt-4 text-sm text-[color:var(--color-danger)]">{error}</p>
            <Link
              to="/login"
              className="mt-6 inline-block text-sm text-[color:var(--color-accent)] hover:underline"
            >
              Back to login
            </Link>
          </>
        ) : (
          <p className="mt-4 text-sm text-[color:var(--text-muted)]">
            {status === 'redirecting'
              ? 'Opening Atrium Workbench in your editor…'
              : status === 'approving'
                ? 'Approving IDE sign-in…'
                : 'Preparing IDE sign-in…'}
          </p>
        )}
      </div>
    </div>
  );
}
