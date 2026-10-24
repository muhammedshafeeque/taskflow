import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  FiArrowLeft,
  FiCheck,
  FiCheckCircle,
  FiClock,
  FiEdit2,
  FiFileText,
  FiFolderPlus,
  FiPlus,
  FiRotateCcw,
  FiTrash2,
  FiX,
  FiXCircle,
} from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { crmApi, type CrmActivity, type CrmDeal, type CrmDealDetail, type CrmPipeline } from '../../lib/api';
import ConfirmModal from '../../components/ConfirmModal';
import DealFormModal from './DealFormModal';
import {
  Chip,
  CrmShell,
  DEAL_STATUS_TONE,
  ErrorBanner,
  Field,
  LoadingBlock,
  Modal,
  Notice,
  Stat,
  btnDanger,
  btnPrimary,
  btnSecondary,
  daysUntil,
  errorOf,
  fmtDate,
  inputCls,
  money,
  prettyLabel,
  refId,
  refName,
} from './crmKit';

const ACTIVITY_TYPES = ['call', 'meeting', 'email', 'task', 'note', 'demo', 'follow_up'];
type LineItem = NonNullable<CrmDeal['lineItems']>[number];

export default function CrmDealDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const canUpdate = canAny(user, 'taskflow.crm.deal.update');
  const canDelete = canAny(user, 'taskflow.crm.deal.delete');
  const canQuote = canAny(user, 'taskflow.crm.quote.create');
  const canLog = canAny(user, 'taskflow.crm.activity.create');

  const [detail, setDetail] = useState<CrmDealDetail | null>(null);
  const [pipelines, setPipelines] = useState<CrmPipeline[]>([]);
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [closing, setClosing] = useState<'won' | 'lost' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);

  const [tick, setTick] = useState(0);
  const load = () => setTick((t) => t + 1);

  useEffect(() => {
    if (!token || !id) return;
    let stale = false;
    void Promise.all([
      crmApi.getDeal(id, token),
      crmApi.listPipelines(token),
      crmApi.listActivities(token, { relatedType: 'deal', relatedId: id }),
    ]).then(([d, p, a]) => {
      if (stale) return;
      if (!d.success || !d.data) {
        setLoadError(errorOf(d, 'Deal not found.'));
        return;
      }
      setLoadError(null);
      setDetail(d.data);
      if (p.success && p.data) setPipelines(p.data);
      if (a.success && a.data) setActivities(a.data);
    });
    return () => {
      stale = true;
    };
  }, [token, id, tick]);

  if (loadError) {
    return (
      <CrmShell title="Deal" actions={<BackLink />}>
        <ErrorBanner message={loadError} onRetry={load} />
      </CrmShell>
    );
  }
  if (!detail) return <LoadingBlock label="Loading deal…" />;

  const { deal, pipeline, quotes, contracts } = detail;
  const stages = [...(pipeline?.stages ?? [])].sort((a, b) => a.order - b.order);
  const closeIn = daysUntil(deal.expectedCloseDate);
  const ageDays = deal.createdAt ? Math.max(0, -(daysUntil(deal.createdAt) ?? 0)) : null;
  const hasProject = !!refId(deal.projectId);

  async function patch(body: Partial<CrmDeal>) {
    if (!token) return false;
    const res = await crmApi.updateDeal(deal._id, body, token);
    if (!res.success) {
      setNotice(errorOf(res, 'Could not update the deal.'));
      return false;
    }
    load();
    return true;
  }

  async function moveTo(stageId: string) {
    if (!token || !canUpdate || stageId === String(deal.stageId)) return;
    const res = await crmApi.moveDealStage(deal._id, stageId, token);
    if (!res.success) setNotice(errorOf(res, 'Could not move the deal.'));
    load();
  }

  async function reopen() {
    const firstOpen = stages.find((s) => !s.isWon && !s.isLost);
    await patch({ status: 'open', ...(firstOpen ? { stageId: firstOpen._id, probability: firstOpen.probability } : {}) });
  }

  async function remove() {
    if (!token) return;
    const res = await crmApi.deleteDeal(deal._id, token);
    setConfirmDelete(false);
    if (!res.success) return setNotice(errorOf(res, 'Could not delete the deal.'));
    navigate('/crm/deals');
  }

  return (
    <CrmShell
      title={deal.title}
      description={
        <span className="inline-flex flex-wrap items-center gap-2">
          <Chip tone={DEAL_STATUS_TONE[deal.status] ?? 'neutral'}>{prettyLabel(deal.status)}</Chip>
          <span>{refName(deal.customerOrgId) || refName(deal.accountId) || 'No customer'}</span>
          <span>·</span>
          <span>{refName(deal.ownerId) || 'Unassigned'}</span>
        </span>
      }
      actions={
        <>
          <BackLink />
          {canUpdate && deal.status === 'open' && (
            <>
              <button type="button" className={`${btnSecondary} !text-emerald-400`} onClick={() => setClosing('won')}>
                <FiCheckCircle /> Won
              </button>
              <button type="button" className={`${btnSecondary} !text-red-400`} onClick={() => setClosing('lost')}>
                <FiXCircle /> Lost
              </button>
            </>
          )}
          {canUpdate && deal.status !== 'open' && (
            <button type="button" className={btnSecondary} onClick={() => void reopen()}>
              <FiRotateCcw /> Reopen
            </button>
          )}
          {canUpdate && (
            <button type="button" className={btnPrimary} onClick={() => setEditOpen(true)}>
              <FiEdit2 /> Edit
            </button>
          )}
          {canDelete && (
            <button type="button" className={btnDanger} onClick={() => setConfirmDelete(true)} aria-label="Delete deal">
              <FiTrash2 />
            </button>
          )}
        </>
      }
    >
      <Notice message={notice} onClose={() => setNotice(null)} />

      {/* Stage stepper */}
      {stages.length > 0 && (
        <div className="flex overflow-x-auto rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-1 gap-1">
          {stages.map((s, i) => {
            const currentIdx = stages.findIndex((x) => x._id === String(deal.stageId));
            const active = s._id === String(deal.stageId);
            const passed = i < currentIdx && !stages[currentIdx]?.isLost;
            const tone = active
              ? s.isLost
                ? 'bg-red-500/15 text-red-400 ring-1 ring-red-500/40'
                : s.isWon
                  ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40'
                  : 'bg-[color:var(--accent-subtle)] text-[color:var(--accent)] ring-1 ring-[color:var(--accent)]/40'
              : passed
                ? 'text-[color:var(--text-primary)]'
                : 'text-[color:var(--text-muted)]';
            return (
              <button
                key={s._id}
                type="button"
                disabled={!canUpdate}
                onClick={() => void moveTo(s._id)}
                title={canUpdate ? `Move to ${s.name}` : s.name}
                className={`flex-1 min-w-[110px] rounded-lg px-3 py-2 text-xs font-medium text-center transition hover:bg-[color:var(--bg-elevated)] disabled:cursor-default ${tone}`}
              >
                <span className="inline-flex items-center gap-1">
                  {passed && <FiCheck className="text-emerald-500" />}
                  {s.name}
                </span>
                <span className="block text-[10px] opacity-70 tabular-nums">{s.probability}%</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <Stat label="Value" value={money(deal.value, deal.currency)} hint={deal.currency} />
        <Stat label="Weighted" value={money((deal.value * (deal.probability ?? 0)) / 100, deal.currency)} hint={`${deal.probability}% probability`} />
        <Stat
          label="Expected close"
          value={fmtDate(deal.expectedCloseDate, { day: 'numeric', month: 'short' })}
          tone={deal.status === 'open' && closeIn != null && closeIn < 0 ? 'bad' : undefined}
          hint={
            deal.status !== 'open'
              ? `Closed ${fmtDate(deal.updatedAt)}`
              : closeIn == null
                ? 'Not scheduled'
                : closeIn < 0
                  ? `${-closeIn} days overdue`
                  : `in ${closeIn} days`
          }
        />
        <Stat label="Age" value={ageDays != null ? `${ageDays}d` : '—'} hint={`Created ${fmtDate(deal.createdAt)}`} />
        <Stat label="Activities" value={activities.length} hint={`${activities.filter((a) => !a.completedAt).length} open`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-5">
          <ActivityPanel dealId={deal._id} activities={activities} canLog={canLog} onChange={load} onError={setNotice} />
          <LineItemsPanel deal={deal} canEdit={canUpdate} onSave={(lineItems, value) => patch({ lineItems, ...(value != null ? { value } : {}) })} />
        </div>

        <div className="space-y-5">
          <Panel title="Details">
            <dl className="text-sm divide-y divide-[color:var(--border-subtle)]">
              <Row label="Customer">{refName(deal.customerOrgId) || '—'}</Row>
              <Row label="Account">
                {refId(deal.accountId) ? (
                  <Link className="text-[color:var(--accent)] hover:underline" to={`/crm/accounts/${refId(deal.accountId)}`}>
                    {refName(deal.accountId) || 'Open account'}
                  </Link>
                ) : (
                  '—'
                )}
              </Row>
              <Row label="Contact">{refName(deal.contactId) || '—'}</Row>
              <Row label="Owner">{refName(deal.ownerId) || 'Unassigned'}</Row>
              <Row label="Pipeline">{pipeline?.name ?? '—'}</Row>
              {refId(deal.leadId) && (
                <Row label="From lead">
                  <Link className="text-[color:var(--accent)] hover:underline" to={`/crm/leads/${refId(deal.leadId)}`}>
                    {refName(deal.leadId) || 'Open lead'}
                  </Link>
                </Row>
              )}
              <Row label="Project">
                {hasProject ? (
                  <Link className="text-[color:var(--accent)] hover:underline" to={`/projects/${refId(deal.projectId)}/dashboard`}>
                    {refName(deal.projectId) || 'Open project'}
                  </Link>
                ) : canUpdate && deal.status !== 'lost' ? (
                  <button type="button" className="inline-flex items-center gap-1 text-[color:var(--accent)] hover:underline" onClick={() => setProjectOpen(true)}>
                    <FiFolderPlus /> Create project
                  </button>
                ) : (
                  '—'
                )}
              </Row>
              <Row label="Updated">{fmtDate(deal.updatedAt)}</Row>
            </dl>
          </Panel>

          {(deal.status !== 'open' || deal.winReason || deal.lossReason || deal.competitorNotes) && (
            <Panel
              title={deal.status === 'lost' ? 'Why we lost' : deal.status === 'won' ? 'Why we won' : 'Win / loss notes'}
              action={
                canUpdate && deal.status !== 'open' ? (
                  <button type="button" className="text-xs text-[color:var(--accent)] hover:underline" onClick={() => setClosing(deal.status as 'won' | 'lost')}>
                    Edit
                  </button>
                ) : undefined
              }
            >
              <p className="text-sm whitespace-pre-wrap">{(deal.status === 'lost' ? deal.lossReason : deal.winReason) || <span className="text-[color:var(--text-muted)]">No reason recorded.</span>}</p>
              {deal.competitorNotes && (
                <p className="mt-2 text-xs text-[color:var(--text-muted)] whitespace-pre-wrap">
                  <span className="font-medium">Competition: </span>
                  {deal.competitorNotes}
                </p>
              )}
            </Panel>
          )}

          <Panel
            title={`Quotes (${quotes.length})`}
            action={
              canQuote ? (
                <Link to={`/crm/quotes/new?dealId=${deal._id}`} className="inline-flex items-center gap-1 text-xs text-[color:var(--accent)] hover:underline">
                  <FiPlus /> New quote
                </Link>
              ) : undefined
            }
          >
            {quotes.length === 0 ? (
              <p className="text-sm text-[color:var(--text-muted)]">No quotes yet.</p>
            ) : (
              <ul className="space-y-1">
                {quotes.map((q) => (
                  <li key={q._id}>
                    <Link to={`/crm/quotes/${q._id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 -mx-2 hover:bg-[color:var(--bg-elevated)]">
                      <FiFileText className="text-[color:var(--text-muted)] shrink-0" />
                      <span className="flex-1 min-w-0 truncate text-sm">
                        {q.title}
                        {q.version && q.version > 1 ? <span className="text-[color:var(--text-muted)]"> v{q.version}</span> : null}
                      </span>
                      <Chip tone={q.status === 'accepted' ? 'good' : q.status === 'rejected' || q.status === 'expired' ? 'bad' : q.status === 'sent' ? 'info' : 'neutral'}>
                        {prettyLabel(q.status)}
                      </Chip>
                      <span className="text-xs tabular-nums">{money(q.total, q.currency)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {contracts.length > 0 && (
            <Panel title={`Contracts (${contracts.length})`}>
              <ul className="space-y-1">
                {contracts.map((c) => (
                  <li key={c._id}>
                    <Link to="/crm/contracts" className="flex items-center gap-2 rounded-lg px-2 py-1.5 -mx-2 hover:bg-[color:var(--bg-elevated)]">
                      <span className="flex-1 min-w-0 truncate text-sm">{c.title}</span>
                      <Chip tone={c.status === 'active' ? 'good' : 'neutral'}>{prettyLabel(c.status)}</Chip>
                      <span className="text-xs tabular-nums">{money(c.value, c.currency)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      <DealFormModal
        open={editOpen}
        deal={deal}
        pipelines={pipelines}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          load();
        }}
      />
      <CloseDealModal
        outcome={closing}
        deal={deal}
        onClose={() => setClosing(null)}
        onSave={async (body) => {
          if (await patch(body)) setClosing(null);
        }}
      />
      <CreateProjectModal
        open={projectOpen}
        deal={deal}
        onClose={() => setProjectOpen(false)}
        onDone={(err) => {
          setProjectOpen(false);
          if (err) setNotice(err);
          load();
        }}
      />
      <ConfirmModal
        open={confirmDelete}
        title="Delete this deal?"
        message="Its activities are deleted too. Linked quotes and contracts are kept but no longer point at this deal."
        confirmLabel="Delete deal"
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </CrmShell>
  );
}

function BackLink() {
  return (
    <Link to="/crm/deals" className={btnSecondary}>
      <FiArrowLeft /> Pipeline
    </Link>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] card-shadow p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-2">
      <dt className="text-[color:var(--text-muted)]">{label}</dt>
      <dd className="text-right min-w-0 truncate">{children}</dd>
    </div>
  );
}

/* ─── Activities ─────────────────────────────────────────────────────────── */

function ActivityPanel({
  dealId,
  activities,
  canLog,
  onChange,
  onError,
}: {
  dealId: string;
  activities: CrmActivity[];
  canLog: boolean;
  onChange: () => void;
  onError: (msg: string) => void;
}) {
  const { token, user } = useAuth();
  const canUpdate = canAny(user, 'taskflow.crm.activity.update');
  const canDelete = canAny(user, 'taskflow.crm.activity.delete');
  const [draft, setDraft] = useState({ type: 'call', subject: '', dueAt: '', body: '' });
  const [saving, setSaving] = useState(false);

  const sorted = useMemo(
    () =>
      [...activities].sort((a, b) => {
        if (!a.completedAt !== !b.completedAt) return a.completedAt ? 1 : -1;
        return new Date(b.dueAt ?? b.createdAt ?? 0).getTime() - new Date(a.dueAt ?? a.createdAt ?? 0).getTime();
      }),
    [activities]
  );

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !draft.subject.trim()) return;
    setSaving(true);
    const res = await crmApi.createActivity(
      {
        type: draft.type,
        subject: draft.subject.trim(),
        body: draft.body.trim() || undefined,
        dueAt: draft.dueAt || undefined,
        relatedType: 'deal',
        relatedId: dealId,
        assigneeId: user?.id,
      },
      token
    );
    setSaving(false);
    if (!res.success) return onError(errorOf(res, 'Could not log the activity.'));
    setDraft({ type: draft.type, subject: '', dueAt: '', body: '' });
    onChange();
  }

  async function act(fn: () => Promise<{ success: boolean }>) {
    const res = await fn();
    if (!res.success) onError(errorOf(res));
    onChange();
  }

  return (
    <Panel title="Activity">
      {canLog && (
        <form onSubmit={add} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] p-3 mb-4 space-y-2">
          <div className="flex flex-wrap gap-1">
            {ACTIVITY_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, type: t }))}
                className={`rounded-full px-2.5 py-0.5 text-[11px] border transition ${
                  draft.type === t
                    ? 'border-[color:var(--accent)] bg-[color:var(--accent-subtle)] text-[color:var(--accent)]'
                    : 'border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
                }`}
              >
                {prettyLabel(t)}
              </button>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={draft.subject}
              onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
              placeholder={draft.type === 'note' ? 'Write a note…' : `What's the ${prettyLabel(draft.type).toLowerCase()} about?`}
              className={`${inputCls} flex-1`}
            />
            <input
              type="datetime-local"
              value={draft.dueAt}
              onChange={(e) => setDraft((d) => ({ ...d, dueAt: e.target.value }))}
              className={`${inputCls} sm:w-52`}
              title="Due (optional)"
            />
            <button type="submit" disabled={saving || !draft.subject.trim()} className={btnPrimary}>
              <FiPlus /> Log
            </button>
          </div>
        </form>
      )}

      {sorted.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)] text-center py-6">No activity on this deal yet.</p>
      ) : (
        <ol className="relative border-l border-[color:var(--border-subtle)] ml-2 space-y-3">
          {sorted.map((a) => {
            const due = daysUntil(a.dueAt);
            const overdue = !a.completedAt && due != null && due < 0;
            return (
              <li key={a._id} className="ml-4 group">
                <span
                  className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-[color:var(--bg-surface)] ${
                    a.completedAt ? 'bg-emerald-500' : overdue ? 'bg-red-500' : 'bg-[color:var(--accent)]'
                  }`}
                />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`text-sm ${a.completedAt ? 'line-through text-[color:var(--text-muted)]' : ''}`}>
                      <span className="text-[10px] uppercase tracking-wide text-[color:var(--text-muted)] mr-1.5">{prettyLabel(a.type)}</span>
                      {a.subject}
                    </p>
                    <p className="text-[11px] text-[color:var(--text-muted)] flex flex-wrap gap-x-2">
                      {a.dueAt && (
                        <span className={overdue ? 'text-red-400' : ''}>
                          <FiClock className="inline -mt-0.5 mr-0.5" />
                          {new Date(a.dueAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>
                      )}
                      {refName(a.assigneeId) && <span>{refName(a.assigneeId)}</span>}
                      {a.completedAt && <span>Done {fmtDate(a.completedAt)}</span>}
                      {!a.dueAt && !a.completedAt && a.createdAt && <span>Logged {fmtDate(a.createdAt)}</span>}
                    </p>
                    {a.body && <p className="text-xs text-[color:var(--text-muted)] mt-1 whitespace-pre-wrap">{a.body}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1 opacity-60 group-hover:opacity-100 transition">
                    {canUpdate && (
                      <button
                        type="button"
                        title={a.completedAt ? 'Reopen' : 'Mark done'}
                        className="p-1 rounded hover:bg-[color:var(--bg-elevated)]"
                        onClick={() =>
                          void act(() =>
                            a.completedAt ? crmApi.updateActivity(a._id, { completed: false }, token!) : crmApi.completeActivity(a._id, token!)
                          )
                        }
                      >
                        {a.completedAt ? <FiRotateCcw /> : <FiCheck />}
                      </button>
                    )}
                    {canDelete && (
                      <button type="button" title="Delete" className="p-1 rounded text-red-400 hover:bg-[color:var(--bg-elevated)]" onClick={() => void act(() => crmApi.deleteActivity(a._id, token!))}>
                        <FiX />
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

/* ─── Line items ─────────────────────────────────────────────────────────── */

function LineItemsPanel({ deal, canEdit, onSave }: { deal: CrmDeal; canEdit: boolean; onSave: (items: LineItem[], value?: number) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<LineItem[]>([]);
  const [syncValue, setSyncValue] = useState(true);
  const items = deal.lineItems ?? [];
  const total = (list: LineItem[]) => list.reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.unitPrice) || 0), 0);

  const start = () => {
    setRows(items.length ? items.map((r) => ({ ...r })) : [{ description: '', quantity: 1, unitPrice: 0, billingType: 'fixed' }]);
    setEditing(true);
  };
  const update = (i: number, patch: Partial<LineItem>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    const clean = rows.filter((r) => r.description.trim()).map((r) => ({ ...r, description: r.description.trim(), quantity: Number(r.quantity) || 0, unitPrice: Number(r.unitPrice) || 0 }));
    if (await onSave(clean, syncValue ? total(clean) : undefined)) setEditing(false);
  }

  return (
    <Panel
      title="Line items"
      action={
        canEdit && !editing ? (
          <button type="button" className="text-xs text-[color:var(--accent)] hover:underline" onClick={start}>
            {items.length ? 'Edit' : 'Add items'}
          </button>
        ) : undefined
      }
    >
      {!editing ? (
        items.length === 0 ? (
          <p className="text-sm text-[color:var(--text-muted)]">No line items. Break the deal value down into products or services.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)] text-left">
                <th className="py-1.5 font-medium">Item</th>
                <th className="py-1.5 font-medium text-right">Qty</th>
                <th className="py-1.5 font-medium text-right">Unit</th>
                <th className="py-1.5 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--border-subtle)]">
              {items.map((r, i) => (
                <tr key={i}>
                  <td className="py-2">
                    {r.description}
                    {r.billingType && r.billingType !== 'fixed' && <span className="ml-1.5 text-[10px] text-[color:var(--text-muted)]">{prettyLabel(r.billingType)}</span>}
                  </td>
                  <td className="py-2 text-right tabular-nums">{r.quantity}</td>
                  <td className="py-2 text-right tabular-nums">{money(r.unitPrice, deal.currency)}</td>
                  <td className="py-2 text-right tabular-nums">{money(r.quantity * r.unitPrice, deal.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="pt-2 text-right text-[color:var(--text-muted)]">
                  Total
                </td>
                <td className="pt-2 text-right font-semibold tabular-nums">{money(total(items), deal.currency)}</td>
              </tr>
            </tfoot>
          </table>
        )
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input className={`${inputCls} col-span-12 sm:col-span-5`} placeholder="Description" value={r.description} onChange={(e) => update(i, { description: e.target.value })} />
              <select className={`${inputCls} col-span-4 sm:col-span-2`} value={r.billingType ?? 'fixed'} onChange={(e) => update(i, { billingType: e.target.value as LineItem['billingType'] })}>
                <option value="fixed">Fixed</option>
                <option value="hourly">Hourly</option>
                <option value="milestone">Milestone</option>
              </select>
              <input className={`${inputCls} col-span-3 sm:col-span-1`} type="number" min={0} step="any" value={r.quantity} onChange={(e) => update(i, { quantity: Number(e.target.value) })} aria-label="Quantity" />
              <input className={`${inputCls} col-span-4 sm:col-span-3`} type="number" min={0} step="any" value={r.unitPrice} onChange={(e) => update(i, { unitPrice: Number(e.target.value) })} aria-label="Unit price" />
              <button type="button" className="col-span-1 p-2 text-red-400 hover:bg-[color:var(--bg-elevated)] rounded" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="Remove line">
                <FiX />
              </button>
            </div>
          ))}
          <button type="button" className="text-xs text-[color:var(--accent)] hover:underline inline-flex items-center gap-1" onClick={() => setRows((rs) => [...rs, { description: '', quantity: 1, unitPrice: 0, billingType: 'fixed' }])}>
            <FiPlus /> Add line
          </button>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[color:var(--border-subtle)]">
            <label className="inline-flex items-center gap-2 text-xs text-[color:var(--text-muted)]">
              <input type="checkbox" checked={syncValue} onChange={(e) => setSyncValue(e.target.checked)} />
              Set deal value to the total ({money(total(rows), deal.currency)})
            </label>
            <div className="flex gap-2">
              <button type="button" className={btnSecondary} onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} onClick={() => void save()}>
                Save items
              </button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ─── Dialogs ────────────────────────────────────────────────────────────── */

function CloseDealModal({
  outcome,
  deal,
  onClose,
  onSave,
}: {
  outcome: 'won' | 'lost' | null;
  deal: CrmDeal;
  onClose: () => void;
  onSave: (body: Partial<CrmDeal>) => Promise<void>;
}) {
  if (!outcome) return null;
  return <CloseDealForm key={outcome} outcome={outcome} deal={deal} onClose={onClose} onSave={onSave} />;
}

function CloseDealForm({
  outcome,
  deal,
  onClose,
  onSave,
}: {
  outcome: 'won' | 'lost';
  deal: CrmDeal;
  onClose: () => void;
  onSave: (body: Partial<CrmDeal>) => Promise<void>;
}) {
  const [reason, setReason] = useState((outcome === 'won' ? deal.winReason : deal.lossReason) ?? '');
  const [competitor, setCompetitor] = useState(deal.competitorNotes ?? '');
  const [saving, setSaving] = useState(false);
  const won = outcome === 'won';
  return (
    <Modal open title={won ? 'Mark deal as won' : 'Mark deal as lost'} subtitle={deal.title} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          await onSave({
            ...(deal.status !== outcome ? { status: outcome } : {}),
            [won ? 'winReason' : 'lossReason']: reason.trim(),
            competitorNotes: competitor.trim(),
          });
          setSaving(false);
        }}
      >
        <Field label={won ? 'What won it?' : 'Why was it lost?'} hint="Shows up in the dashboard's loss-reason breakdown — keep it short and consistent.">
          <input autoFocus className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={won ? 'e.g. Best technical fit' : 'e.g. Price, Timing, Went with competitor'} />
        </Field>
        <Field label="Competition notes">
          <textarea rows={3} className={inputCls} value={competitor} onChange={(e) => setCompetitor(e.target.value)} placeholder="Who else was in the running, and anything worth remembering." />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={won ? btnPrimary : btnDanger}>
            {won ? <FiCheckCircle /> : <FiXCircle />} {deal.status === outcome ? 'Save notes' : won ? 'Mark won' : 'Mark lost'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CreateProjectModal(props: { open: boolean; deal: CrmDeal; onClose: () => void; onDone: (error?: string) => void }) {
  return props.open ? <CreateProjectForm {...props} /> : null;
}

const suggestKey = (title: string) =>
  title
    .replace(/[^A-Za-z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 6)
    .toUpperCase();

function CreateProjectForm({ deal, onClose, onDone }: { deal: CrmDeal; onClose: () => void; onDone: (error?: string) => void }) {
  const { token } = useAuth();
  const [name, setName] = useState(deal.title);
  const [key, setKey] = useState(suggestKey(deal.title));
  const [saving, setSaving] = useState(false);

  return (
    <Modal open title="Create project from deal" subtitle="The deal is marked won and linked to the new project." onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!token || !name.trim() || !key.trim()) return;
          setSaving(true);
          const res = await crmApi.createProjectFromDeal(deal._id, { name: name.trim(), key: key.trim().toUpperCase() }, token);
          setSaving(false);
          onDone(res.success ? undefined : errorOf(res, 'Could not create the project.'));
        }}
      >
        <Field label="Project name">
          <input required className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Key" hint="Short code used in issue keys, e.g. ACME-12.">
          <input required className={`${inputCls} uppercase font-mono`} maxLength={10} value={key} onChange={(e) => setKey(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={btnPrimary}>
            <FiFolderPlus /> Create project
          </button>
        </div>
      </form>
    </Modal>
  );
}

