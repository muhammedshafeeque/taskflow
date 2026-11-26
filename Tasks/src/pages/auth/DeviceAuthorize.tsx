import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { mcpDeviceApi, type McpDeviceRequest } from '../../lib/api';
import { APP_NAME } from '../../brand';

const field =
  'rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm text-[color:var(--text-primary)]';

/** "bcdf ghjk" → "BCDF-GHJK" as the user types. */
const formatCode = (raw: string) => {
  const letters = raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8);
  return letters.length > 4 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : letters;
};

/**
 * Connect a command-line tool (an MCP client in a terminal, over SSH, in CI…) by entering the code it shows.
 * Approving gives the tool a personal API token, listed and revocable under Profile → API tokens.
 */
export default function DeviceAuthorize() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { token, user, loading, switchWorkspace } = useAuth();
  const [code, setCode] = useState(() => formatCode(search.get('code') ?? ''));
  const [req, setReq] = useState<McpDeviceRequest | null>(null);
  const [error, setError] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState<'' | 'check' | 'workspace' | 'approve' | 'deny'>('');
  const [done, setDone] = useState<'' | 'approved' | 'denied'>('');

  useEffect(() => {
    if (loading) return;
    if (!token || !user) navigate(`/login?returnUrl=${encodeURIComponent(`/auth/device${code ? `?code=${code}` : ''}`)}`, { replace: true });
  }, [loading, token, user, navigate, code]);

  async function check(e?: React.FormEvent) {
    e?.preventDefault();
    if (!token || code.replace('-', '').length !== 8) return setError('Enter the 8-letter code shown in your terminal.');
    setBusy('check');
    setError('');
    const res = await mcpDeviceApi.request(code, token);
    setBusy('');
    if (!res.success || !res.data) return setError(res.message || 'That code is not valid or has expired.');
    setReq(res.data);
    if (res.data.expiryChoices.length && !res.data.expiryChoices.includes(90)) setDays(res.data.expiryChoices[0]);
  }

  async function decide(approve: boolean) {
    if (!token || !req) return;
    setBusy(approve ? 'approve' : 'deny');
    setError('');
    const res = await mcpDeviceApi.approve(req.userCode, { approve, readOnly, expiresInDays: days }, token);
    setBusy('');
    if (!res.success || !res.data) return setError(res.message || 'Could not complete sign-in. Start again in your terminal.');
    setDone(res.data.status);
  }

  async function changeWorkspace(id: string) {
    setBusy('workspace');
    const r = await switchWorkspace(id);
    setBusy('');
    if (!r.ok) return setError(r.error || 'Could not switch workspace');
    void check();
  }

  const organizations = user?.organizations ?? [];
  const blocked = user?.userType === 'customer' ? `Command-line tools can only connect to ${APP_NAME} workspace accounts.` : '';

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-[color:var(--bg-page)]">
      <div className="w-full max-w-md rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-modal)] p-8 shadow-lg">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">Connect a terminal</p>
        {blocked ? (
          <p className="mt-4 text-sm text-[color:var(--color-danger)]">{blocked}</p>
        ) : done ? (
          <div className="mt-2 space-y-3">
            <h1 className="text-lg font-semibold text-[color:var(--text-primary)]">{done === 'approved' ? `${req?.clientName} is connected` : 'Sign-in declined'}</h1>
            <p className="text-sm text-[color:var(--text-muted)]">
              {done === 'approved' ? 'Go back to your terminal; it finishes signing in within a few seconds. You can close this page.' : 'Nothing was connected. You can close this page.'}
            </p>
            <Link to="/profile" className="inline-block text-sm text-[color:var(--color-accent)] hover:underline">
              Manage connections under Profile → API tokens
            </Link>
          </div>
        ) : !req ? (
          <form className="mt-2 space-y-4" onSubmit={(e) => void check(e)}>
            <h1 className="text-lg font-semibold text-[color:var(--text-primary)]">Enter the code from your terminal</h1>
            <input
              className={`${field} w-full text-center font-mono text-2xl tracking-[0.3em]`}
              value={code}
              onChange={(e) => setCode(formatCode(e.target.value))}
              placeholder="BCDF-GHJK"
              aria-label="Code"
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
            {error && <p className="text-xs text-[color:var(--color-danger)]">{error}</p>}
            <button type="submit" className="btn-primary w-full rounded-lg px-4 py-2 text-sm disabled:opacity-50" disabled={busy === 'check'}>
              {busy === 'check' ? 'Checking…' : 'Continue'}
            </button>
            <p className="text-[11px] text-[color:var(--text-muted)]">
              Only enter a code you started yourself, just now, in your own terminal. Never enter a code someone sent you.
            </p>
          </form>
        ) : (
          <div className="mt-1 space-y-5">
            <div>
              <h1 className="text-lg font-semibold text-[color:var(--text-primary)]">
                Allow <span className="text-[color:var(--color-accent)]">{req.clientName}</span> to use {APP_NAME} as you?
              </h1>
              <p className="mt-2 text-sm text-[color:var(--text-muted)]">
                The terminal showing <strong className="font-mono text-[color:var(--text-primary)]">{req.userCode}</strong> will see what you can see and can only do what your permissions
                allow.
              </p>
            </div>
            <div className="space-y-3 rounded-xl bg-[color:var(--bg-page)] p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[color:var(--text-muted)]">Signed in as</span>
                <span className="truncate font-medium text-[color:var(--text-primary)]">{user?.email}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[color:var(--text-muted)]">Workspace</span>
                {organizations.length > 1 ? (
                  <select className={field} value={req.workspace?.id ?? ''} disabled={Boolean(busy)} onChange={(e) => void changeWorkspace(e.target.value)} aria-label="Workspace">
                    {organizations.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="font-medium text-[color:var(--text-primary)]">{req.workspace?.name ?? '—'}</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[color:var(--text-muted)]">Access expires</span>
                <select className={field} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Access expires">
                  {req.expiryChoices.map((d) => (
                    <option key={d} value={d}>
                      {d === 365 ? 'in 1 year' : `in ${d} days`}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-start gap-2 pt-1">
                <input type="checkbox" className="mt-0.5" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
                <span>
                  <span className="font-medium text-[color:var(--text-primary)]">Read-only</span>
                  <span className="block text-xs text-[color:var(--text-muted)]">The tool can look things up but never create, change or delete anything.</span>
                </span>
              </label>
            </div>
            {!req.workspace && <p className="text-xs text-[color:var(--color-danger)]">Choose a workspace to continue.</p>}
            {error && <p className="text-xs text-[color:var(--color-danger)]">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg border border-[color:var(--border-subtle)] px-4 py-2 text-sm text-[color:var(--text-primary)] disabled:opacity-50"
                disabled={Boolean(busy)}
                onClick={() => void decide(false)}
              >
                {busy === 'deny' ? 'Declining…' : 'Decline'}
              </button>
              <button type="button" className="btn-primary flex-1 rounded-lg px-4 py-2 text-sm disabled:opacity-50" disabled={Boolean(busy) || !req.workspace} onClick={() => void decide(true)}>
                {busy === 'approve' ? 'Allowing…' : 'Allow'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
