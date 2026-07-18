import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authApi } from '../lib/api';
import { APP_NAME } from '../brand';
import AtriumLogo from '../components/AtriumLogo';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const res = await authApi.forgotPassword(email.trim());
    setLoading(false);
    if (res.success) setSent(true);
    else setError((res as { message?: string }).message ?? 'Request failed');
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--auth-page-bg)' }}>
        <div className="w-full max-w-md text-center">
          <div className="bg-[color:var(--bg-modal)]/90 backdrop-blur border border-[color:var(--border-subtle)] rounded-2xl p-8 shadow-xl">
            <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">Check your email</h1>
            <p className="mt-2 text-[color:var(--text-muted)] text-sm">
              If an account exists for that email, you will receive a link to reset your password.
            </p>
            <Link
              to="/login"
              className="mt-6 inline-block text-indigo-500 hover:text-indigo-600 font-medium text-sm"
            >
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--auth-page-bg)' }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8 flex flex-col items-center gap-3">
          <AtriumLogo variant="mark" className="h-12 w-12" useSvg={false} />
          <h1 className="text-3xl font-bold text-[color:var(--text-primary)] tracking-tight">{APP_NAME}</h1>
          <p className="text-[color:var(--text-muted)] -mt-1">Reset your password</p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="bg-[color:var(--bg-modal)]/90 backdrop-blur border border-[color:var(--border-subtle)] rounded-2xl p-8 shadow-xl"
        >
          {error && (
            <div
              role="alert"
              className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-sm"
            >
              {error}
            </div>
          )}
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
          <button
            type="submit"
            disabled={loading}
            className="mt-6 w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-[color:var(--bg-page)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
          <p className="mt-6 text-center text-[color:var(--text-muted)] text-sm">
            <Link to="/login" className="text-indigo-500 hover:text-indigo-600 font-medium">
              Back to sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
