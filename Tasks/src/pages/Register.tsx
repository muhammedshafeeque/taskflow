import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiAlertCircle, FiLock, FiMail, FiUser } from 'react-icons/fi';
import { FcGoogle } from 'react-icons/fc';
import { FaMicrosoft } from 'react-icons/fa';
import { useAuth } from '../contexts/AuthContext';
import { authApi, type PublicAuthConfig } from '../lib/api';
import { resolvePostAuthRoute } from '../lib/postAuthRedirect';

export default function Register() {
  const navigate = useNavigate();
  const { register, switchWorkspace } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [publicConfig, setPublicConfig] = useState<PublicAuthConfig>({
    signupEnabled: false,
    emailPasswordEnabled: true,
    providers: { google: false, microsoft: false },
  });

  useEffect(() => {
    authApi.publicConfig().then((res) => {
      if (res.success && res.data) {
        setPublicConfig(res.data);
        if (!res.data.signupEnabled || !res.data.emailPasswordEnabled) navigate('/login', { replace: true });
      }
    });
  }, [navigate]);

  function startGoogleLogin() {
    const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
    const base = apiBase.endsWith('/api') ? apiBase.slice(0, -4) : apiBase;
    window.location.href = `${base}/api/auth/oauth/google`;
  }

  function startMicrosoftLogin() {
    const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
    const base = apiBase.endsWith('/api') ? apiBase.slice(0, -4) : apiBase;
    window.location.href = `${base}/api/auth/oauth/microsoft`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await register(name.trim(), email.trim(), password);
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? 'Sign up failed');
      return;
    }
    const stored = localStorage.getItem('pm_user');
    const user = stored ? JSON.parse(stored) : null;
    const next = user ? await resolvePostAuthRoute(user, switchWorkspace) : '/';
    navigate(next, { replace: true });
  }

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 sm:py-8 flex items-center justify-center" style={{ background: 'var(--auth-page-bg)' }}>
      <div className="w-full max-w-xl rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-modal)] p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-[color:var(--text-primary)]">Create account</h1>
        <p className="mt-1 text-sm text-[color:var(--text-muted)]">Sign up to get started.</p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-sm text-red-300">
              <FiAlertCircle className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}
          <div className="relative">
            <FiUser className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]" />
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Full name" className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] py-3 pl-11 pr-4" />
          </div>
          <div className="relative">
            <FiMail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]" />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="Email" className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] py-3 pl-11 pr-4" />
          </div>
          <div className="relative">
            <FiLock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required placeholder="Password" className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] py-3 pl-11 pr-4" />
          </div>
          <button type="submit" disabled={loading} className="btn-primary btn-primary-lg w-full">
            {loading ? 'Creating account…' : 'Sign up'}
          </button>
        </form>

        {(publicConfig.providers.google || publicConfig.providers.microsoft) && (
          <>
            <div className="mt-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-[color:var(--border-subtle)]" />
              <span className="text-[11px] text-[color:var(--text-muted)]">or</span>
              <div className="h-px flex-1 bg-[color:var(--border-subtle)]" />
            </div>
            {publicConfig.providers.google && (
              <button type="button" onClick={startGoogleLogin} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-4 py-3 font-medium">
                <FcGoogle className="text-lg" />
                Sign up with Google
              </button>
            )}
            {publicConfig.providers.microsoft && (
              <button type="button" onClick={startMicrosoftLogin} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-4 py-3 font-medium">
                <FaMicrosoft className="text-lg text-sky-500" />
                Sign up with Microsoft
              </button>
            )}
          </>
        )}

        <p className="mt-6 text-center text-sm text-[color:var(--text-muted)]">
          Already have an account? <Link to="/login" className="font-medium text-[color:var(--accent)] hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
