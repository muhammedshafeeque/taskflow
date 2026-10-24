import { useEffect, useState } from 'react';
import { FiArrowDown, FiArrowUp, FiPlus, FiStar, FiTrash2, FiX } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { crmApi, type CrmPipeline, type CrmWebhook } from '../../lib/api';
import ConfirmModal from '../../components/ConfirmModal';
import { Chip, CrmShell, EmptyState, Field, Notice, btnDanger, btnPrimary, btnSecondary, errorOf, inputCls } from './crmKit';

type Stage = CrmPipeline['stages'][number];
type DraftStage = Omit<Stage, '_id' | 'order'> & { _id?: string };

/** Keep in sync with WORKSPACE_WEBHOOK_EVENTS in server/src/modules/webhooks/workspaceEvents.ts. */
const WEBHOOK_EVENTS = [
  'lead.converted',
  'deal.won',
  'quote.sent',
  'issue.created',
  'issue.updated',
  'issue.status_changed',
  'ticket.created',
  'ticket.updated',
  'ticket.resolved',
  'ticket.commented',
  'invoice.sent',
  'invoice.paid',
  'invoice.overdue',
  'invoice.void',
  'invoice.payment_recorded',
];

export default function CrmSettings() {
  const { token, user } = useAuth();
  const canManage = canAny(user, 'taskflow.crm.settings.manage');
  const [pipelines, setPipelines] = useState<CrmPipeline[]>([]);
  const [webhooks, setWebhooks] = useState<CrmWebhook[]>([]);
  const [pipeName, setPipeName] = useState('');
  const [hookForm, setHookForm] = useState({ name: '', url: '', events: ['deal.won'] as string[] });
  const [secretOnce, setSecretOnce] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => Promise<void> } | null>(null);
  const [tick, setTick] = useState(0);
  const load = () => setTick((t) => t + 1);

  useEffect(() => {
    if (!token || !canManage) return;
    let stale = false;
    void Promise.all([crmApi.listPipelines(token), crmApi.listWebhooks(token)]).then(([p, w]) => {
      if (stale) return;
      if (p.success && p.data) setPipelines(p.data);
      if (w.success && w.data) setWebhooks(w.data as CrmWebhook[]);
    });
    return () => {
      stale = true;
    };
  }, [token, canManage, tick]);

  if (!canManage) {
    return (
      <CrmShell title="CRM settings">
        <EmptyState title="No access">You need the CRM settings permission to configure pipelines and webhooks.</EmptyState>
      </CrmShell>
    );
  }

  async function createPipeline(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !pipeName.trim()) return;
    setError(null);
    const res = await crmApi.createPipeline(
      {
        name: pipeName.trim(),
        isDefault: pipelines.length === 0,
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
    if (!res.success) return setError(errorOf(res, 'Could not create the pipeline.'));
    setPipeName('');
    load();
  }

  async function createWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !hookForm.name.trim() || !hookForm.url.trim()) return;
    if (!hookForm.events.length) return setError('Pick at least one event.');
    const res = await crmApi.createWebhook({ name: hookForm.name.trim(), url: hookForm.url.trim(), events: hookForm.events }, token);
    if (!res.success || !res.data) return setError(errorOf(res, 'Could not add the webhook.'));
    const wh = res.data as CrmWebhook;
    if (wh.secret) setSecretOnce(wh.secret);
    setHookForm({ name: '', url: '', events: ['deal.won'] });
    load();
  }

  return (
    <CrmShell title="CRM settings" description="Sales pipelines, their stages and probabilities, and outbound webhooks.">
      <Notice message={error} onClose={() => setError(null)} />
      {secretOnce && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          Webhook signing secret — copy it now, it is not shown again: <code className="font-mono text-xs break-all">{secretOnce}</code>
          <button type="button" className="ml-3 text-xs underline" onClick={() => setSecretOnce('')}>
            Dismiss
          </button>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">Pipelines</h2>
            <p className="text-xs text-[color:var(--text-muted)]">Stage probability sets a deal's weighted value. Mark one stage as won and one as lost.</p>
          </div>
          <form onSubmit={createPipeline} className="flex gap-2">
            <input value={pipeName} onChange={(e) => setPipeName(e.target.value)} placeholder="New pipeline name" className={`${inputCls} !w-56`} />
            <button type="submit" className={btnPrimary} disabled={!pipeName.trim()}>
              <FiPlus /> Add
            </button>
          </form>
        </div>
        {pipelines.map((p) => (
          <PipelineEditor
            key={`${p._id}-${p.updatedAt ?? ''}`}
            pipeline={p}
            onSaved={load}
            onError={setError}
            onDelete={() =>
              setConfirm({
                title: `Delete “${p.name}”?`,
                message: 'Only pipelines without deals can be deleted.',
                run: async () => {
                  const res = await crmApi.deletePipeline(p._id, token!);
                  if (!res.success) setError(errorOf(res, 'Could not delete the pipeline.'));
                  load();
                },
              })
            }
          />
        ))}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">Webhooks</h2>
          <p className="text-xs text-[color:var(--text-muted)]">POST a signed JSON payload to your endpoint when these events happen.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            {webhooks.map((w) => (
              <div key={w._id} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 flex justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm">{w.name}</p>
                  <p className="text-xs text-[color:var(--text-muted)] break-all">{w.url}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(w.events ?? []).map((ev) => (
                      <Chip key={ev} tone="info">
                        {ev}
                      </Chip>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  className="p-1.5 h-fit rounded-md text-red-400 hover:bg-red-500/10"
                  aria-label={`Delete ${w.name}`}
                  onClick={() =>
                    setConfirm({
                      title: `Delete webhook “${w.name}”?`,
                      message: 'Events stop being delivered to this URL immediately.',
                      run: async () => {
                        await crmApi.deleteWebhook(w._id, token!);
                        load();
                      },
                    })
                  }
                >
                  <FiTrash2 />
                </button>
              </div>
            ))}
            {webhooks.length === 0 && <EmptyState title="No webhooks yet" />}
          </div>
          <form onSubmit={createWebhook} className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 space-y-3">
            <h3 className="text-sm font-semibold">Add webhook</h3>
            <Field label="Name">
              <input required value={hookForm.name} onChange={(e) => setHookForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="Endpoint URL">
              <input required type="url" value={hookForm.url} onChange={(e) => setHookForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://…" className={inputCls} />
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {WEBHOOK_EVENTS.map((ev) => {
                const on = hookForm.events.includes(ev);
                return (
                  <button
                    key={ev}
                    type="button"
                    onClick={() => setHookForm((f) => ({ ...f, events: on ? f.events.filter((x) => x !== ev) : [...f.events, ev] }))}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] border transition font-mono ${
                      on ? 'border-[color:var(--accent)] bg-[color:var(--accent-subtle)] text-[color:var(--accent)]' : 'border-[color:var(--border-subtle)] text-[color:var(--text-muted)]'
                    }`}
                  >
                    {ev}
                  </button>
                );
              })}
            </div>
            <button type="submit" className={btnPrimary}>
              <FiPlus /> Add webhook
            </button>
          </form>
        </div>
      </section>

      <ConfirmModal
        open={!!confirm}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        confirmLabel="Delete"
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          void c?.run();
        }}
        onCancel={() => setConfirm(null)}
      />
    </CrmShell>
  );
}

function PipelineEditor({ pipeline, onSaved, onError, onDelete }: { pipeline: CrmPipeline; onSaved: () => void; onError: (m: string) => void; onDelete: () => void }) {
  const { token } = useAuth();
  const initial = () => [...pipeline.stages].sort((a, b) => a.order - b.order).map(({ _id, name, probability, isWon, isLost }) => ({ _id, name, probability, isWon: !!isWon, isLost: !!isLost }));
  const [name, setName] = useState(pipeline.name);
  const [stages, setStages] = useState<DraftStage[]>(initial);
  const [saving, setSaving] = useState(false);
  const dirty = name !== pipeline.name || JSON.stringify(stages) !== JSON.stringify(initial());

  const update = (i: number, patch: Partial<DraftStage>) => setStages((st) => st.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, dir: -1 | 1) =>
    setStages((st) => {
      const next = [...st];
      const j = i + dir;
      if (j < 0 || j >= next.length) return st;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  // Only one stage can be the won (or lost) outcome.
  const setOutcome = (i: number, kind: 'won' | 'lost' | 'open') =>
    setStages((st) =>
      st.map((s, j) => {
        if (j === i) return { ...s, isWon: kind === 'won', isLost: kind === 'lost', probability: kind === 'won' ? 100 : kind === 'lost' ? 0 : s.probability };
        return { ...s, isWon: kind === 'won' ? false : s.isWon, isLost: kind === 'lost' ? false : s.isLost };
      })
    );

  async function save(extra: Record<string, unknown> = {}) {
    if (!token) return;
    setSaving(true);
    const res = await crmApi.updatePipeline(pipeline._id, { name: name.trim(), stages: stages.map((s, i) => ({ ...s, order: i })), ...extra }, token);
    setSaving(false);
    if (!res.success) return onError(errorOf(res, 'Could not save the pipeline.'));
    onSaved();
  }

  return (
    <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] card-shadow p-4 sm:p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} !w-auto flex-1 min-w-[180px] font-semibold`} aria-label="Pipeline name" />
        {pipeline.isDefault ? (
          <Chip tone="accent">
            <FiStar /> Default
          </Chip>
        ) : (
          <button type="button" className={btnSecondary} onClick={() => void save({ isDefault: true })}>
            <FiStar /> Make default
          </button>
        )}
        {!pipeline.isDefault && (
          <button type="button" className={btnDanger} onClick={onDelete} aria-label="Delete pipeline">
            <FiTrash2 />
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="hidden sm:grid grid-cols-[2rem_1fr_6rem_9rem_4.5rem] gap-2 px-1 text-[10px] uppercase tracking-wider text-[color:var(--text-muted)]">
          <span>#</span>
          <span>Stage</span>
          <span>Probability</span>
          <span>Outcome</span>
          <span />
        </div>
        {stages.map((s, i) => (
          <div key={s._id ?? `new-${i}`} className="grid grid-cols-[2rem_1fr_6rem] sm:grid-cols-[2rem_1fr_6rem_9rem_4.5rem] gap-2 items-center">
            <span className="text-xs text-[color:var(--text-muted)] tabular-nums text-center">{i + 1}</span>
            <input value={s.name} onChange={(e) => update(i, { name: e.target.value })} className={inputCls} placeholder="Stage name" />
            <div className="relative">
              <input
                type="number"
                min={0}
                max={100}
                value={s.probability}
                disabled={s.isWon || s.isLost}
                onChange={(e) => update(i, { probability: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                className={`${inputCls} pr-6`}
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[color:var(--text-muted)]">%</span>
            </div>
            <select value={s.isWon ? 'won' : s.isLost ? 'lost' : 'open'} onChange={(e) => setOutcome(i, e.target.value as 'won' | 'lost' | 'open')} className={`${inputCls} col-span-2 sm:col-span-1`}>
              <option value="open">In progress</option>
              <option value="won">Won stage</option>
              <option value="lost">Lost stage</option>
            </select>
            <div className="flex items-center gap-0.5 justify-end">
              <button type="button" className="p-1 rounded hover:bg-[color:var(--bg-elevated)] disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                <FiArrowUp />
              </button>
              <button type="button" className="p-1 rounded hover:bg-[color:var(--bg-elevated)] disabled:opacity-30" disabled={i === stages.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                <FiArrowDown />
              </button>
              <button type="button" className="p-1 rounded text-red-400 hover:bg-red-500/10 disabled:opacity-30" disabled={stages.length <= 1} onClick={() => setStages((st) => st.filter((_, j) => j !== i))} aria-label="Remove stage">
                <FiX />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button type="button" className="text-xs text-[color:var(--accent)] hover:underline inline-flex items-center gap-1" onClick={() => setStages((st) => {
          const firstClosed = st.findIndex((x) => x.isWon || x.isLost);
          const next = [...st];
          next.splice(firstClosed < 0 ? st.length : firstClosed, 0, { name: '', probability: 50, isWon: false, isLost: false });
          return next;
        })}>
          <FiPlus /> Add stage
        </button>
        {dirty && (
          <div className="flex gap-2">
            <button type="button" className={btnSecondary} onClick={() => { setName(pipeline.name); setStages(initial()); }}>
              Discard
            </button>
            <button type="button" className={btnPrimary} disabled={saving || !name.trim()} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save pipeline'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
