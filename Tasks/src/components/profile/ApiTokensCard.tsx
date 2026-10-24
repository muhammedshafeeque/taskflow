import { useEffect, useState } from 'react';
import { apiTokensApi, type ApiTokenRecord } from '../../lib/api';
import McpConnectCard from './McpConnectCard';

const input =
  'rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm text-[color:var(--text-primary)]';

function fmt(d?: string) {
  return d ? new Date(d).toLocaleDateString() : '—';
}

/** Personal access tokens for scripts, CI and integrations (`Authorization: Bearer atr_…`). */
export default function ApiTokensCard({ token }: { token: string }) {
  const [rows, setRows] = useState<ApiTokenRecord[]>([]);
  const [name, setName] = useState('');
  const [days, setDays] = useState(90);
  const [readOnly, setReadOnly] = useState(false);
  const [created, setCreated] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => apiTokensApi.list(token).then((r) => r.success && r.data && setRows(r.data));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function create() {
    setBusy(true);
    setError('');
    const r = await apiTokensApi.create({ name: name.trim(), expiresInDays: days, readOnly }, token);
    setBusy(false);
    if (r.success && r.data) {
      setCreated(r.data.token);
      setName('');
      void load();
    } else setError(r.message ?? 'Could not create token');
  }

  async function revoke(id: string) {
    const r = await apiTokensApi.revoke(id, token);
    if (r.success) void load();
    else setError(r.message ?? 'Could not revoke token');
  }

  return (
    <>
      <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6 space-y-4">
        <div>
          <h2 className="text-base font-medium text-[color:var(--text-primary)]">API tokens</h2>
          <p className="text-sm text-[color:var(--text-muted)] mt-1">
            Use with <code className="text-xs">Authorization: Bearer atr_…</code> to call the Atrium API from scripts and integrations. A token acts as you, with your
            permissions, in your current workspace.
          </p>
        </div>

        {created && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-2">
            <p className="text-xs font-semibold text-emerald-600">Copy this token now — it won’t be shown again.</p>
            <div className="flex gap-2">
              <code className="flex-1 min-w-0 truncate rounded bg-[color:var(--bg-page)] px-2 py-1 text-xs">{created}</code>
              <button type="button" className="text-xs text-[color:var(--accent)]" onClick={() => void navigator.clipboard?.writeText(created)}>
                Copy
              </button>
              <button type="button" className="text-xs text-[color:var(--text-muted)]" onClick={() => setCreated('')}>
                Done
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <input className={`${input} flex-1 min-w-[180px]`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name, e.g. CI deploy" />
          <select className={input} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
            <option value={0}>No expiry</option>
          </select>
          <label className="inline-flex items-center gap-2 px-1 text-sm text-[color:var(--text-primary)]" title="The token can read but never create, change or delete anything">
            <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
            Read-only
          </label>
          <button type="button" className="btn-primary px-4 py-2 rounded-lg text-sm disabled:opacity-50" disabled={busy || !name.trim()} onClick={create}>
            Create token
          </button>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}

        {rows.length > 0 && (
          <ul className="divide-y divide-[color:var(--border-subtle)] rounded-lg border border-[color:var(--border-subtle)]">
            {rows.map((t) => (
              <li key={t._id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-[color:var(--text-primary)] truncate">
                    {t.name}
                    {t.readOnly && <span className="ml-2 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-500">read-only</span>}
                    {t.oauthClientId && <span className="ml-2 rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-500">AI assistant</span>}
                  </p>
                  <p className="text-[11px] text-[color:var(--text-muted)]">
                    {t.prefix}… · created {fmt(t.createdAt)} · expires {t.expiresAt ? fmt(t.expiresAt) : 'never'} · last used {fmt(t.lastUsedAt)}
                  </p>
                </div>
                <button type="button" className="text-xs text-red-500 hover:underline" onClick={() => revoke(t._id)}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <McpConnectCard newToken={created || undefined} />
    </>
  );
}
