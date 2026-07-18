import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FiAlertCircle, FiLock, FiLogIn, FiMail } from 'react-icons/fi';
import { FcGoogle } from 'react-icons/fc';
import { FaMicrosoft } from 'react-icons/fa';
import { useAuth } from '../contexts/AuthContext';
import { authApi, type PublicAuthConfig } from '../lib/api';
import { resolvePostAuthRoute } from '../lib/postAuthRedirect';
import { APP_NAME, APP_TAGLINE } from '../brand';
import AtriumLogo from '../components/AtriumLogo';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, microsoftSso, switchWorkspace } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [publicConfig, setPublicConfig] = useState<PublicAuthConfig>({
    signupEnabled: false,
    emailPasswordEnabled: true,
    providers: { google: false, microsoft: false },
  });

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
    authApi.publicConfig().then((res) => {
      if (res.success && res.data) setPublicConfig(res.data);
    });
  }, []);

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
      const u = stored ? JSON.parse(stored) : null;
      const next = u ? await resolvePostAuthRoute(u, switchWorkspace) : '/';
      navigate(next);
    }
    run();
  }, [oauthCode, oauthState, microsoftSso, msRedirectUri, navigate]);

  async function startMicrosoftLogin() {
    setSsoLoading(true);
    const res = await authApi.microsoftSsoAuthorizeUrl(msRedirectUri);
    setSsoLoading(false);
    if (!res.success || !res.data?.url) {
      setError('Could not start Microsoft sign-in. Please try again.');
      return;
    }
    if (res.data.state) {
      sessionStorage.setItem('ms_oauth_state', res.data.state);
    }
    window.location.href = res.data.url;
  }

  function startGoogleLogin() {
    const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
    const base = apiBase.endsWith('/api') ? apiBase.slice(0, -4) : apiBase;
    window.location.href = `${base}/api/auth/oauth/google`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await login(email, password);
    setLoading(false);
    if (result.ok) {
      const stored = localStorage.getItem('pm_user');
      const u = stored ? JSON.parse(stored) : null;
      const next = u ? await resolvePostAuthRoute(u, switchWorkspace) : '/';
      navigate(next);
      return;
    }
    setError(result.error ?? 'Login failed');
  }

  return (
    <div
      className="min-h-screen px-4 py-6 sm:px-6 sm:py-8 flex items-center justify-center"
      style={{ background: 'var(--auth-page-bg)' }}
    >
      <div className="w-full max-w-5xl animate-scale-in">
        <div className="grid overflow-hidden rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-modal)] shadow-[0_24px_64px_rgba(0,0,0,0.4)] lg:grid-cols-[1.05fr_1fr]">
          <section className="relative hidden lg:flex flex-col justify-between border-r border-[color:var(--border-subtle)]/70 bg-[color:var(--bg-elevated)] p-10">
            <div>
              <div className="flex items-center gap-3 mb-6">
                <AtriumLogo variant="mark" className="h-11 w-11" useSvg={false} />
                <span className="text-xl font-bold tracking-tight text-[color:var(--text-primary)]">{APP_NAME}</span>
              </div>
              <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-[color:var(--text-primary)]">
                One hub.
                <br />
                Every module.
              </h1>
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-[color:var(--text-muted)]">
                {APP_TAGLINE}. Run projects, CRM, mail, and service desks from one clean workspace.
              </p>
            </div>
            <div className="space-y-3 text-sm text-[color:var(--text-muted)]">
              <p className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-done)]" />
                Unified projects, CRM, and service
              </p>
              <p className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-done)]" />
                Shared mail and team collaboration
              </p>
              <p className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-done)]" />
                Clear visibility from pipeline to delivery
              </p>
            </div>
          </section>

          <section className="p-6 sm:p-8 lg:p-10">
            <div className="mb-6 lg:hidden flex items-center gap-2.5">
              <AtriumLogo variant="mark" className="h-9 w-9" useSvg={false} />
              <span className="text-lg font-bold tracking-tight text-[color:var(--text-primary)]">{APP_NAME}</span>
            </div>
            <div className="mb-7">
              <h2 className="text-2xl font-bold tracking-tight text-[color:var(--text-primary)]">Welcome back</h2>
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
              {publicConfig.emailPasswordEnabled ? (
                <>
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
                          className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] py-3 pl-11 pr-4 text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] transition focus:border-[color:var(--accent)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/45"
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
                          className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] py-3 pl-11 pr-4 text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] transition focus:border-[color:var(--accent)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/45"
                          placeholder="••••••••"
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || ssoLoading}
                    className="btn-primary btn-primary-lg mt-6 w-full gap-2"
                  >
                    <FiLogIn className="text-base" />
                    {loading ? 'Signing in…' : 'Sign in'}
                  </button>
                </>
              ) : (
                <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-4 py-3 text-sm text-[color:var(--text-muted)]">
                  Email and password sign-in is disabled by the administrator.
                </div>
              )}

              {(publicConfig.providers.google || publicConfig.providers.microsoft) && (
                <div className="mt-5 flex items-center gap-3">
                  <div className="h-px flex-1 bg-[color:var(--border-subtle)]" />
                  <span className="text-[11px] text-[color:var(--text-muted)]">or</span>
                  <div className="h-px flex-1 bg-[color:var(--border-subtle)]" />
                </div>
              )}

              {publicConfig.providers.google && (
                <button
                  type="button"
                  onClick={startGoogleLogin}
                  disabled={loading || ssoLoading}
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-4 py-3 font-medium text-[color:var(--text-primary)] transition hover:bg-[color:var(--bg-surface)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FcGoogle className="text-lg" />
                  Sign in with Google
                </button>
              )}
              {publicConfig.providers.microsoft && (
                <button
                  type="button"
                  onClick={startMicrosoftLogin}
                  disabled={loading || ssoLoading}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-4 py-3 font-medium text-[color:var(--text-primary)] transition hover:bg-[color:var(--bg-surface)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FaMicrosoft className="text-lg text-sky-500" />
                  {ssoLoading ? 'Signing in with Microsoft…' : 'Sign in with Microsoft'}
                </button>
              )}

              {publicConfig.emailPasswordEnabled && (
                <p className="mt-6 text-center text-sm text-[color:var(--text-muted)]">
                  <Link to="/forgot-password" title="Reset your password" className="font-medium text-[color:var(--accent)] hover:underline">
                    Forgot password?
                  </Link>
                </p>
              )}
              {publicConfig.signupEnabled && publicConfig.emailPasswordEnabled && (
                <p className="mt-2 text-center text-sm text-[color:var(--text-muted)]">
                  Don&apos;t have an account?{' '}
                  <Link to="/register" className="font-medium text-[color:var(--accent)] hover:underline">
                    Sign up
                  </Link>
                </p>
              )}
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
