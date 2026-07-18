import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { crmApi, type CrmPipeline, type CrmWebhook } from '../../lib/api';

const WEBHOOK_EVENTS = ['lead.converted', 'deal.won', 'quote.sent'];

export default function CrmSettings() {
  const { token, user } = useAuth();
  const canManage = canAny(user, 'taskflow.crm.settings.manage');
  const [pipelines, setPipelines] = useState<CrmPipeline[]>([]);
  const [webhooks, setWebhooks] = useState<CrmWebhook[]>([]);
  const [pipeName, setPipeName] = useState('');
  const [hookForm, setHookForm] = useState({ name: '', url: '', events: ['deal.won'] as string[] });
  const [secretOnce, setSecretOnce] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    if (!token) return;
    const [p, w] = await Promise.all([crmApi.listPipelines(token), canManage ? crmApi.listWebhooks(token) : Promise.resolve({ success: true, data: [] })]);
    if (p.success && p.data) setPipelines(p.data as CrmPipeline[]);
    if (w.success && w.data) setWebhooks(w.data as CrmWebhook[]);
  };

  useEffect(() => {
    void load();
  }, [token, canManage]);

  if (!canManage) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold mb-2">CRM settings</h1>
        <p className="text-sm text-[color:var(--text-muted)]">You need settings manage permission to configure pipelines and webhooks.</p>
      </div>
    );
  }

  async function createPipeline(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !pipeName.trim()) return;
    setError('');
    const res = await crmApi.createPipeline(
      {
        name: pipeName.trim(),
        stages: [
          { name: 'Qualified', order: 0, probability: 20 },
          { name: 'Proposal', order: 1, probability: 50 },
          { name: 'Negotiation', order: 2, probability: 75 },
          { name: 'Won', order: 3, probability: 100, isWon: true },
          { name: 'Lost', order: 4, probability: 0, isLost: true },
        ],
      },
      token
    );
    if (!res.success) {
      setError((res as { message?: string }).message ?? 'Failed');
      return;
    }
    setPipeName('');
    load();
  }

  async function createWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !hookForm.name.trim() || !hookForm.url.trim()) return;
    const res = await crmApi.createWebhook(
      { name: hookForm.name.trim(), url: hookForm.url.trim(), events: hookForm.events },
      token
    );
    if (res.success && res.data) {
      const wh = res.data as CrmWebhook;
      if (wh.secret) setSecretOnce(wh.secret);
      setHookForm({ name: '', url: '', events: ['deal.won'] });
      load();
    }
  }

  async function removeWebhook(id: string) {
    if (!token) return;
    if (!confirm('Delete webhook?')) return;
    await crmApi.deleteWebhook(id, token);
    load();
  }

  return (
    <div className="p-8 w-full px-4 sm:px-6 lg:px-8 space-y-8">
      <div>
        <h1 className="text-xl font-semibold">CRM settings</h1>
        <p className="text-[13px] text-[color:var(--text-muted)]">Pipelines and outbound webhooks.</p>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {secretOnce && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          Webhook secret (copy now): <code className="font-mono text-xs break-all">{secretOnce}</code>
          <button type="button" className="ml-3 text-xs underline" onClick={() => setSecretOnce('')}>
            Dismiss
          </button>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="font-medium">Pipelines</h2>
        <div className="space-y-2">
          {pipelines.map((p) => (
            <div key={p._id} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4">
              <p className="font-medium text-sm">
                {p.name} {p.isDefault && <span className="text-[10px] text-[color:var(--accent)]">default</span>}
              </p>
              <p className="text-xs text-[color:var(--text-muted)] mt-1">
                {[...p.stages].sort((a, b) => a.order - b.order).map((s) => s.name).join(' → ')}
              </p>
            </div>
          ))}
        </div>
        <form onSubmit={createPipeline} className="flex flex-wrap gap-2">
          <input
            value={pipeName}
            onChange={(e) => setPipeName(e.target.value)}
            placeholder="New pipeline name"
            className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm"
          />
          <button type="submit" className="btn-primary px-4 py-2 rounded-lg text-sm">
            Create pipeline
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Webhooks</h2>
        <div className="space-y-2">
          {webhooks.map((w) => (
            <div key={w._id} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 flex justify-between gap-3">
              <div>
                <p className="font-medium text-sm">{w.name}</p>
                <p className="text-xs text-[color:var(--text-muted)] break-all">{w.url}</p>
                <p className="text-[10px] text-[color:var(--text-muted)] mt-1">{(w.events ?? []).join(', ')}</p>
              </div>
              <button type="button" className="text-xs text-red-400 hover:underline shrink-0" onClick={() => void removeWebhook(w._id)}>
                Delete
              </button>
            </div>
          ))}
          {webhooks.length === 0 && <p className="text-sm text-[color:var(--text-muted)]">No webhooks.</p>}
        </div>
        <form onSubmit={createWebhook} className="rounded-xl border border-[color:var(--border-subtle)] p-4 space-y-3 max-w-lg">
          <input
            required
            value={hookForm.name}
            onChange={(e) => setHookForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Name"
            className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
          />
          <input
            required
            type="url"
            value={hookForm.url}
            onChange={(e) => setHookForm((f) => ({ ...f, url: e.target.value }))}
            placeholder="https://…"
            className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap gap-3 text-xs">
            {WEBHOOK_EVENTS.map((ev) => (
              <label key={ev} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={hookForm.events.includes(ev)}
                  onChange={(e) =>
                    setHookForm((f) => ({
                      ...f,
                      events: e.target.checked ? [...f.events, ev] : f.events.filter((x) => x !== ev),
                    }))
                  }
                />
                {ev}
              </label>
            ))}
          </div>
          <button type="submit" className="btn-primary px-4 py-2 rounded-lg text-sm">
            Add webhook
          </button>
        </form>
      </section>
    </div>
  );
}
