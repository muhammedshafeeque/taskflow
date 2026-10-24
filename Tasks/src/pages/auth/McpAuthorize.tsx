import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { mcpOAuthApi, type McpAuthorizeRequest } from '../../lib/api';
import { APP_NAME } from '../../brand';

const PARAMS = ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'];

const field =
  'rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm text-[color:var(--text-primary)]';

/**
 * Consent screen for an AI assistant (claude.ai, Claude Desktop, Claude Code…) signing in over MCP.
 * Approving gives the assistant a personal API token, listed and revocable under Profile → API tokens.
 */
export default function McpAuthorize() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { token, user, loading, switchWorkspace } = useAuth();
  const params = useMemo(() => {
    const out: Record<string, string> = {};
    for (const k of PARAMS) {
      const v = search.get(k);
      if (v) out[k] = v;
    }
    return out;
  }, [search]);

  const [req, setReq] = useState<McpAuthorizeRequest | null>(null);
  const [error, setError] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState<'' | 'workspace' | 'approve' | 'deny' | 'redirecting'>('');

  const blocked = !params.client_id || !params.redirect_uri
    ? 'This sign-in link is incomplete. Start connecting again from your AI assistant.'
    : user?.userType === 'customer'
      ? `AI assistants can only connect to ${APP_NAME} workspace accounts.`
      : '';

  useEffect(() => {
    if (loading || blocked) return;
    if (!token || !user) {
      navigate(`/login?returnUrl=${encodeURIComponent(`/auth/mcp?${search.toString()}`)}`, { replace: true });
      return;
    }
    let cancelled = false;
    // Re-runs when the user switches workspace, so the consent shows the new one.
    void mcpOAuthApi.request(params, token).then((res) => {
      if (cancelled) return;
      if (!res.success || !res.data) return setError(res.message || 'This sign-in request is not valid. Start connecting again.');
      setReq(res.data);
      if (res.data.expiryChoices.length && !res.data.expiryChoices.includes(90)) setDays(res.data.expiryChoices[0]);
    });
    return () => {
      cancelled = true;
    };
  }, [loading, blocked, token, user, params, search, navigate]);

  async function decide(approve: boolean) {
    if (!token) return;
    setBusy(approve ? 'approve' : 'deny');
    setError('');
    const res = await mcpOAuthApi.approve(params, { approve, readOnly, expiresInDays: days }, token);
    if (!res.success || !res.data) {
      setBusy('');
      return setError(res.message || 'Could not complete sign-in. Start connecting again.');
    }
    setBusy('redirecting');
    window.location.href = res.data.redirect;
  }

  async function changeWorkspace(id: string) {
    setBusy('workspace');
    const r = await switchWorkspace(id);
    setBusy('');
    if (!r.ok) setError(r.error || 'Could not switch workspace');
  }

  const organizations = user?.organizations ?? [];

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-[color:var(--bg-page)]">
      <div className="w-full max-w-md rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-modal)] p-8 shadow-lg">
        {(blocked || error) && !req ? (
          <div className="text-center">
            <h1 className="text-lg font-semibold text-[color:var(--text-primary)]">Connect an AI assistant</h1>
            <p className="mt-4 text-sm text-[color:var(--color-danger)]">{blocked || error}</p>
            <Link to="/" className="mt-6 inline-block text-sm text-[color:var(--color-accent)] hover:underline">
              Back to {APP_NAME}
            </Link>
          </div>
        ) : !req ? (
          <p className="text-center text-sm text-[color:var(--text-muted)]">Checking the sign-in request…</p>
        ) : req.error ? (
          <div className="text-center">
            <h1 className="text-lg font-semibold text-[color:var(--text-primary)]">Can’t connect {req.clientName}</h1>
            <p className="mt-4 text-sm text-[color:var(--color-danger)]">{req.error}</p>
            {req.errorRedirect && (
              <button type="button" className="mt-6 text-sm text-[color:var(--color-accent)] hover:underline" onClick={() => (window.location.href = req.errorRedirect!)}>
                Return to {req.clientName}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">Connect an AI assistant</p>
              <h1 className="mt-1 text-lg font-semibold text-[color:var(--text-primary)]">
                Allow <span className="text-[color:var(--color-accent)]">{req.clientName}</span> to use {APP_NAME} as you?
              </h1>
              <p className="mt-2 text-sm text-[color:var(--text-muted)]">
                It will see the projects, issues, docs and other records you can see, and can only do what your permissions allow. Access goes back to{' '}
                <strong className="text-[color:var(--text-primary)]">{req.redirectHost}</strong> — only continue if you started this from that app.
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
                  <select className={field} value={req.workspace?.id ?? ''} disabled={Boolean(busy)} onChange={(e) => void changeWorkspace(e.target.value)}>
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
                <select className={field} value={days} onChange={(e) => setDays(Number(e.target.value))}>
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
                  <span className="block text-xs text-[color:var(--text-muted)]">The assistant can look things up but never create, change or delete anything.</span>
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
                {busy === 'deny' ? 'Cancelling…' : 'Cancel'}
              </button>
              <button
                type="button"
                className="btn-primary flex-1 rounded-lg px-4 py-2 text-sm disabled:opacity-50"
                disabled={Boolean(busy) || !req.workspace}
                onClick={() => void decide(true)}
              >
                {busy === 'approve' ? 'Allowing…' : busy === 'redirecting' ? `Returning to ${req.clientName}…` : 'Allow'}
              </button>
            </div>
            <p className="text-center text-[11px] text-[color:var(--text-muted)]">You can disconnect it any time under Profile → API tokens.</p>
          </div>
        )}
      </div>
    </div>
  );
}
