import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FiAlertCircle, FiLock, FiLogIn, FiMail } from 'react-icons/fi';
import { FaMicrosoft } from 'react-icons/fa';
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
    <div
      className="min-h-screen px-4 py-6 sm:px-6 sm:py-8 flex items-center justify-center"
      style={{ background: 'var(--auth-page-bg)' }}
    >
      <div className="w-full max-w-5xl animate-scale-in">
        <div className="grid overflow-hidden rounded-3xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-modal)]/90 shadow-2xl backdrop-blur lg:grid-cols-[1.05fr_1fr]">
          <section className="relative hidden lg:flex flex-col justify-between border-r border-[color:var(--border-subtle)]/70 bg-[color:var(--bg-elevated)]/65 p-10">
            <div>
              <span className="inline-flex items-center rounded-full border border-[color:var(--border-subtle)] bg-[color:var(--bg-modal)]/75 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-muted)]">
                TaskFlow
              </span>
              <h1 className="mt-5 text-4xl font-bold leading-tight text-[color:var(--text-primary)]">
                Plan faster.
                <br />
                Deliver smarter.
              </h1>
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-[color:var(--text-muted)]">
                Manage projects, issues, and teams in one focused workspace built for clarity and speed.
              </p>
            </div>
            <div className="space-y-3 text-sm text-[color:var(--text-muted)]">
              <p className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--accent)]" />
                Unified issue tracking and reporting
              </p>
              <p className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--accent)]" />
                Real-time collaboration with your team
              </p>
              <p className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--accent)]" />
                Better visibility from backlog to delivery
              </p>
            </div>
          </section>

          <section className="p-6 sm:p-8 lg:p-10">
            <div className="mb-6 lg:hidden">
              <span className="inline-flex items-center rounded-full border border-[color:var(--border-subtle)] bg-[color:var(--bg-modal)]/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-muted)]">
                TaskFlow
              </span>
            </div>
            <div className="mb-7">
              <h2 className="text-3xl font-bold tracking-tight text-[color:var(--text-primary)]">Welcome back</h2>
              <p className="mt-1.5 text-sm text-[color:var(--text-muted)]">Sign in to continue to your workspace</p>
            </div>

            <form onSubmit={handleSubmit}>
              {error && (
                <div
                  role="alert"
                  className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-sm text-red-300 animate-fade-in"
                >
                  <FiAlertCircle className="mt-0.5 shrink-0" />
                  {error}
                </div>
              )}
              <div className="space-y-5">
                <div>
                  <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-[color:var(--text-primary)]">
                    Email
                  </label>
                  <div className="relative">
                    <FiMail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]" />
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] py-3 pl-11 pr-4 text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] transition focus:border-[color:var(--accent)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/45"
                      placeholder="you@example.com"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-[color:var(--text-primary)]">
                    Password
                  </label>
                  <div className="relative">
                    <FiLock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]" />
                    <input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="w-full rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] py-3 pl-11 pr-4 text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] transition focus:border-[color:var(--accent)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/45"
                      placeholder="••••••••"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || ssoLoading}
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 font-medium text-white transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 focus:ring-offset-2 focus:ring-offset-[color:var(--bg-page)] disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400 disabled:opacity-100"
              >
                <FiLogIn className="text-base" />
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
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-4 py-3 font-medium text-[color:var(--text-primary)] transition hover:bg-[color:var(--bg-surface)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FaMicrosoft className="text-lg text-sky-500" />
                {ssoLoading ? 'Signing in with Microsoft…' : 'Sign in with Microsoft'}
              </button>

              <p className="mt-6 text-center text-sm text-[color:var(--text-muted)]">
                <Link to="/forgot-password" className="font-medium text-[color:var(--accent)] hover:underline">
                  Forgot password?
                </Link>
              </p>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
