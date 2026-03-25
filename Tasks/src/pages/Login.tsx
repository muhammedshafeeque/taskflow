import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { authApi } from '../lib/api';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, microsoftSso } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);

  const msRedirectUri = useMemo(() => {
    if (typeof window === 'undefined') return 'http://localhost:5173/login';
    return `${window.location.origin}/login`;
  }, []);

  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const oauthCode = query.get('code');
  const oauthState = query.get('state');
  const oauthError = query.get('error');
  const oauthErrorDescription = query.get('error_description');

  useEffect(() => {
    if (oauthError) {
      const msg = oauthErrorDescription ? decodeURIComponent(oauthErrorDescription) : oauthError;
      setError(msg || 'Microsoft sign-in failed');
    }
  }, [oauthError, oauthErrorDescription]);

  useEffect(() => {
    async function run() {
      if (!oauthCode) return;
      setError('');

      const expectedState = sessionStorage.getItem('ms_oauth_state');
      sessionStorage.removeItem('ms_oauth_state');
      if (expectedState && oauthState && expectedState !== oauthState) {
        setError('Microsoft sign-in failed (state mismatch). Please try again.');
        return;
      }

      setSsoLoading(true);
      const result = await microsoftSso(oauthCode, msRedirectUri);
      setSsoLoading(false);
      if (!result.ok) {
        setError(result.error ?? 'Microsoft sign-in failed');
        return;
      }
      // Clean URL (remove ?code=...).
      window.history.replaceState({}, document.title, '/login');
      const stored = localStorage.getItem('pm_user');
      const u = stored ? (JSON.parse(stored) as { mustChangePassword?: boolean }) : null;
      navigate(u?.mustChangePassword ? '/inbox' : '/');
    }
    run();
  }, [oauthCode, oauthState, microsoftSso, msRedirectUri, navigate]);

  async function startMicrosoftLogin() {
    setError('');
    setSsoLoading(true);
    const res = await authApi.microsoftSsoAuthorizeUrl(msRedirectUri);
    setSsoLoading(false);
    if (!res.success || !res.data) {
      setError((res as { message?: string }).message ?? 'Microsoft SSO URL generation failed');
      return;
    }
    sessionStorage.setItem('ms_oauth_state', res.data.state);
    window.location.assign(res.data.url);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await login(email, password);
    setLoading(false);
    if (result.ok) {
      const stored = localStorage.getItem('pm_user');
      const u = stored ? (JSON.parse(stored) as { mustChangePassword?: boolean }) : null;
      navigate(u?.mustChangePassword ? '/inbox' : '/');
      return;
    }
    else setError(result.error ?? 'Login failed');
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--auth-page-bg)' }}>
      <div className="w-full max-w-md animate-scale-in">
        <div className="text-center mb-8 animate-fade-in">
          <h1 className="text-3xl font-bold text-[color:var(--text-primary)] tracking-tight">TaskFlow</h1>
          <p className="text-[color:var(--text-muted)] mt-1">Sign in to your account</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-[color:var(--bg-modal)]/90 backdrop-blur border border-[color:var(--border-subtle)] rounded-2xl p-8 shadow-xl animate-fade-in animation-delay-100"
        >
          {error && (
            <div
              role="alert"
              className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-sm animate-fade-in"
            >
              {error}
            </div>
          )}
          <div className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-xl bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/50 focus:border-[color:var(--accent)] transition"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-xl bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/50 focus:border-[color:var(--accent)] transition"
                placeholder="••••••••"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={loading || ssoLoading}
            className="mt-6 w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-[color:var(--bg-page)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="mt-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-[color:var(--border-subtle)]" />
            <span className="text-[11px] text-[color:var(--text-muted)]">or</span>
            <div className="h-px flex-1 bg-[color:var(--border-subtle)]" />
          </div>

          <button
            type="button"
            onClick={startMicrosoftLogin}
            disabled={loading || ssoLoading}
            className="mt-5 w-full py-3 px-4 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-[color:var(--text-primary)] font-medium transition hover:bg-[color:var(--bg-surface)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {ssoLoading ? 'Signing in with Microsoft…' : 'Sign in with Microsoft'}
          </button>

          <p className="mt-6 text-center text-[color:var(--text-muted)] text-sm">
            <Link to="/forgot-password" className="text-indigo-500 hover:text-indigo-600 font-medium">
              Forgot password?
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
