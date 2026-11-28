import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { approvalsApi } from '../../lib/api';
import type {
  ApprovalDelegation,
  ApprovalPolicy,
  ApprovalPolicyStep,
  ApprovalRecordType,
  ApprovalRequest,
  ApproverKind,
  ProcurementApprover,
} from '../../lib/api';
import { Field, GhostButton, Modal, PrimaryButton, Select, SectionPage, StatusPill, TextArea, TextInput, money, nameOf } from '../../components/moduleKit';
import { ModuleLoader } from '../../components/loaders/ModuleLoader';
import { PersonMultiSelect, PersonSelect, toPeople } from '../../components/people';

const TYPE_LABEL: Record<ApprovalRecordType, string> = {
  invoice: 'Invoice',
  quote: 'Quotation',
  purchase_order: 'Purchase order',
  expense: 'Expense claim',
  leave: 'Leave',
  payroll: 'Payroll run',
  offer: 'Job offer',
  hiring_request: 'Hiring request',
};
const RECORD_TYPES = Object.keys(TYPE_LABEL) as ApprovalRecordType[];

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'slate' | 'violet'> = {
  pending: 'amber',
  waiting: 'slate',
  approved: 'green',
  rejected: 'red',
  cancelled: 'slate',
  skipped: 'slate',
};

const KIND_LABEL: Record<ApproverKind, string> = {
  manager: 'Reporting manager',
  role: 'Everyone with a role',
  users: 'Named people',
  permission: 'Everyone with a permission',
  discount_limit: 'Someone whose discount limit covers it',
};

type Tab = 'queue' | 'mine' | 'decided' | 'all' | 'delegations' | 'chains';

const fmtDate = (d?: string) => (d ? new Date(d).toLocaleDateString() : '—');
const fmtDateTime = (d?: string) => (d ? new Date(d).toLocaleString() : '—');
const amountOf = (r: Pick<ApprovalRequest, 'recordType' | 'amount' | 'currency'>) =>
  r.recordType === 'leave' ? `${r.amount} day(s)` : r.currency ? money(r.amount, r.currency) : String(r.amount);
const ordinal = (n: number) => (n === 1 ? 'Manager' : n === 2 ? "Manager's manager" : `Manager ${n} levels up`);

function tableWrap(children: React.ReactNode) {
  return (
    <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[color:var(--border-subtle)] p-10 text-center text-sm text-[color:var(--text-muted)]">{children}</div>
  );
}

export default function Approvals() {
  const { token, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const canChains = canAny(user, 'taskflow.approvals.policy.manage');
  const canAll = canAny(user, 'taskflow.approvals.request.list_all');
  const canManageDelegations = canAny(user, 'taskflow.approvals.delegation.manage');

  const tabs = useMemo(
    () =>
      [
        { id: 'queue', label: 'To approve' },
        { id: 'mine', label: 'My requests' },
        { id: 'decided', label: 'Decided by me' },
        ...(canAll ? [{ id: 'all', label: 'All requests' }] : []),
        { id: 'delegations', label: 'Delegations' },
        ...(canChains ? [{ id: 'chains', label: 'Approval chains' }] : []),
      ] as Array<{ id: Tab; label: string }>,
    [canAll, canChains]
  );
  const raw = params.get('tab') as Tab | null;
  const tab: Tab = tabs.some((t) => t.id === raw) ? (raw as Tab) : 'queue';
  const setTab = (t: Tab) => setParams(t === 'queue' ? {} : { tab: t }, { replace: true });

  // ?request=<id> opens one request directly (links from record pages and notifications).
  const [openId, setOpenIdState] = useState<string | null>(() => params.get('request'));
  const setOpenId = (id: string | null) => {
    setOpenIdState(id);
    if (!id && params.has('request')) {
      const next = new URLSearchParams(params);
      next.delete('request');
      setParams(next, { replace: true });
    }
  };
  const [queueCount, setQueueCount] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    if (!token) return;
    approvalsApi.queue(token).then((r) => r.success && r.data && setQueueCount(r.data.length));
  }, [token, refreshKey]);

  return (
    <SectionPage
      title="Approvals"
      subtitle="One place for every approval: expenses, purchase orders, leave, invoices, quotations, payroll and job offers. Nobody approves their own request, and every decision is logged."
    >
      <div className="flex flex-wrap gap-1 border-b border-[color:var(--border-subtle)]">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === t.id
                ? 'border-[color:var(--accent)] text-[color:var(--text-primary)]'
                : 'border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
            }`}
          >
            {t.label}
            {t.id === 'queue' && queueCount ? (
              <span className="ml-1.5 rounded-full bg-[color:var(--accent)] px-1.5 py-0.5 text-[10px] font-semibold text-white">{queueCount}</span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === 'queue' && <QueueTab key={refreshKey} onOpen={setOpenId} />}
      {(tab === 'mine' || tab === 'decided' || tab === 'all') && <RequestsTab key={`${tab}-${refreshKey}`} scope={tab} onOpen={setOpenId} />}
      {tab === 'delegations' && <DelegationsTab canManage={canManageDelegations} />}
      {tab === 'chains' && canChains && <ChainsTab />}

      {openId && (
        <RequestDrawer
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            refresh();
          }}
        />
      )}
    </SectionPage>
  );
}

// ── Queue ────────────────────────────────────────────────────────────────────

function QueueTab({ onOpen }: { onOpen: (id: string) => void }) {
  const { token } = useAuth();
  const [rows, setRows] = useState<ApprovalRequest[] | null>(null);
  const [type, setType] = useState('');
  useEffect(() => {
    if (!token) return;
    approvalsApi.queue(token).then((r) => setRows(r.success && r.data ? r.data : []));
  }, [token]);
  if (!rows) return <ModuleLoader size="block" />;
  const shown = type ? rows.filter((r) => r.recordType === type) : rows;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Select value={type} onChange={(e) => setType(e.target.value)} className="!w-auto">
          <option value="">All types</option>
          {RECORD_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </Select>
        <span className="text-xs text-[color:var(--text-muted)]">{shown.length} waiting for you</span>
      </div>
      {shown.length === 0 ? (
        <Empty>Nothing is waiting for your approval.</Empty>
      ) : (
        tableWrap(
          <>
            <thead className="text-left text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
              <tr className="border-b border-[color:var(--border-subtle)]">
                <th className="px-4 py-2.5">Request</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Asked by</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
                <th className="px-4 py-2.5">Step</th>
                <th className="px-4 py-2.5">Waiting since</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r._id} className="border-b border-[color:var(--border-subtle)] last:border-0 hover:bg-[color:var(--bg-page)]">
                  <td className="px-4 py-2.5 font-medium">
                    {r.title}
                    {r.onBehalfOf && <p className="text-[11px] font-normal text-[color:var(--text-muted)]">As a delegate</p>}
                  </td>
                  <td className="px-4 py-2.5">{TYPE_LABEL[r.recordType]}</td>
                  <td className="px-4 py-2.5">{nameOf(r.requestedBy as never)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{amountOf(r)}</td>
                  <td className="px-4 py-2.5">
                    {r.steps[r.currentStep]?.name ?? '—'}
                    <span className="text-[11px] text-[color:var(--text-muted)]"> · {r.currentStep + 1} of {r.steps.length}</span>
                  </td>
                  <td className="px-4 py-2.5 text-[color:var(--text-muted)]">{fmtDate(r.createdAt)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <PrimaryButton onClick={() => onOpen(r._id)}>Review</PrimaryButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </>
        )
      )}
    </div>
  );
}

// ── Request lists ────────────────────────────────────────────────────────────

function RequestsTab({ scope, onOpen }: { scope: 'mine' | 'decided' | 'all'; onOpen: (id: string) => void }) {
  const { token } = useAuth();
  const [rows, setRows] = useState<ApprovalRequest[] | null>(null);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!token) return;
    approvalsApi.requests({ scope, status, recordType: type }, token).then((r) => {
      if (!r.success) setErr(r.message || 'Could not load requests');
      setRows(r.success && r.data ? r.data : []);
    });
  }, [token, scope, status, type]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={type} onChange={(e) => setType(e.target.value)} className="!w-auto">
          <option value="">All types</option>
          {RECORD_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!w-auto">
          <option value="">Any status</option>
          {['pending', 'approved', 'rejected', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </div>
      {err && <p className="text-sm text-rose-500">{err}</p>}
      {!rows ? (
        <ModuleLoader size="block" />
      ) : rows.length === 0 ? (
        <Empty>{scope === 'mine' ? 'You have not asked for any approvals yet.' : scope === 'decided' ? 'You have not decided any requests yet.' : 'No requests match.'}</Empty>
      ) : (
        tableWrap(
          <>
            <thead className="text-left text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
              <tr className="border-b border-[color:var(--border-subtle)]">
                <th className="px-4 py-2.5">Request</th>
                <th className="px-4 py-2.5">Type</th>
                {scope !== 'mine' && <th className="px-4 py-2.5">Asked by</th>}
                <th className="px-4 py-2.5 text-right">Amount</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Progress</th>
                <th className="px-4 py-2.5">Asked</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r._id}
                  onClick={() => onOpen(r._id)}
                  className="cursor-pointer border-b border-[color:var(--border-subtle)] last:border-0 hover:bg-[color:var(--bg-page)]"
                >
                  <td className="px-4 py-2.5 font-medium">{r.title}</td>
                  <td className="px-4 py-2.5">{TYPE_LABEL[r.recordType]}</td>
                  {scope !== 'mine' && <td className="px-4 py-2.5">{nameOf(r.requestedBy as never)}</td>}
                  <td className="px-4 py-2.5 text-right tabular-nums">{amountOf(r)}</td>
                  <td className="px-4 py-2.5"><StatusPill label={r.status} tone={STATUS_TONE[r.status]} /></td>
                  <td className="px-4 py-2.5"><StepDots steps={r.steps} /></td>
                  <td className="px-4 py-2.5 text-[color:var(--text-muted)]">{fmtDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </>
        )
      )}
    </div>
  );
}

function StepDots({ steps }: { steps: ApprovalRequest['steps'] }) {
  const color: Record<string, string> = {
    approved: 'bg-emerald-500',
    rejected: 'bg-rose-500',
    pending: 'bg-amber-400 ring-2 ring-amber-200',
    skipped: 'bg-slate-300',
    waiting: 'bg-transparent border border-slate-400',
  };
  return (
    <span className="inline-flex items-center gap-1" title={steps.map((s) => `${s.name}: ${s.status}`).join('\n')}>
      {steps.map((s, i) => <span key={i} className={`h-2.5 w-2.5 rounded-full ${color[s.status]}`} />)}
    </span>
  );
}

// ── One request ──────────────────────────────────────────────────────────────

const HISTORY_LABEL: Record<string, string> = {
  submitted: 'Asked for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  skipped: 'Step skipped',
  cancelled: 'Cancelled',
  restarted: 'Started again',
  completed: 'Fully approved',
};

function RequestDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { token, user } = useAuth();
  const [req, setReq] = useState<ApprovalRequest | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    if (!token) return;
    approvalsApi.request(id, token).then((r) => {
      if (r.success && r.data) setReq(r.data);
      else setErr(r.message || 'Could not load the request');
    });
  }, [id, token]);
  useEffect(load, [load]);

  const decide = async (decision: 'approve' | 'reject') => {
    if (!token) return;
    if (decision === 'reject' && !note.trim()) return setErr('Add a note saying why you are rejecting it.');
    setBusy(true);
    setErr('');
    const r = await approvalsApi.decide(id, decision, note.trim(), token);
    setBusy(false);
    onChanged();
    if (!r.success) {
      setErr(r.message || 'Could not save the decision');
      load();
      return;
    }
    setNote('');
    load();
  };

  const withdraw = async () => {
    if (!token) return;
    setBusy(true);
    const r = await approvalsApi.cancel(id, note.trim() || 'Withdrawn', token);
    setBusy(false);
    if (!r.success) return setErr(r.message || 'Could not withdraw');
    onChanged();
    load();
  };

  const requesterId = req ? (typeof req.requestedBy === 'string' ? req.requestedBy : req.requestedBy._id) : '';
  const isRequester = Boolean(user?.id && requesterId === user.id);

  return (
    <Modal
      title={req ? req.title : 'Approval request'}
      onClose={onClose}
      wide
      footer={
        req?.status === 'pending' ? (
          <>
            {isRequester && <GhostButton disabled={busy} onClick={withdraw}>Withdraw</GhostButton>}
            {req.canDecide && (
              <>
                <GhostButton disabled={busy} onClick={() => decide('reject')}>Reject</GhostButton>
                <PrimaryButton disabled={busy} onClick={() => decide('approve')}>{req.onBehalfOf ? 'Approve as delegate' : 'Approve'}</PrimaryButton>
              </>
            )}
          </>
        ) : undefined
      }
    >
      {!req ? (
        err ? <p className="text-sm text-rose-500">{err}</p> : <ModuleLoader size="block" />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Info label="Type" value={TYPE_LABEL[req.recordType]} />
            <Info label="Amount" value={amountOf(req)} />
            <Info label="Asked by" value={nameOf(req.requestedBy as never)} />
            <Info label="Status" value={<StatusPill label={req.status} tone={STATUS_TONE[req.status]} />} />
          </div>
          {req.link && (
            <Link to={req.link} className="inline-block text-xs text-[color:var(--accent)] hover:underline" onClick={onClose}>
              Open the {TYPE_LABEL[req.recordType].toLowerCase()} →
            </Link>
          )}

          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-muted)]">Approval chain</p>
            <ol className="space-y-2">
              {req.steps.map((s, i) => (
                <li key={i} className="flex gap-3 rounded-xl border border-[color:var(--border-subtle)] px-3 py-2">
                  <span className="mt-0.5 w-5 shrink-0 text-xs font-semibold text-[color:var(--text-muted)]">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm">{s.name}</span>
                      <StatusPill label={s.status} tone={STATUS_TONE[s.status]} />
                    </div>
                    {s.decidedBy ? (
                      <p className="text-xs text-[color:var(--text-muted)]">
                        {s.status === 'rejected' ? 'Rejected' : 'Approved'} by {nameOf(s.decidedBy as never)}
                        {s.onBehalfOf ? ` on behalf of ${nameOf(s.onBehalfOf as never)}` : ''} · {fmtDateTime(s.decidedAt)}
                      </p>
                    ) : s.approverIds.length ? (
                      <p className="text-xs text-[color:var(--text-muted)]">Approvers: {s.approverIds.map((a) => nameOf(a as never)).join(', ')}</p>
                    ) : s.status === 'waiting' ? (
                      <p className="text-xs text-[color:var(--text-muted)]">Approvers are worked out when this step starts</p>
                    ) : null}
                    {s.note && <p className="mt-1 text-xs italic">“{s.note}”</p>}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {req.status === 'pending' && req.canDecide && (
            <Field label="Note (required to reject)">
              <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional for approval" />
            </Field>
          )}
          {req.status === 'pending' && req.onBehalfOf && req.canDecide && (
            <p className="text-xs text-[color:var(--text-muted)]">You are deciding as a delegate; the log records who you acted for.</p>
          )}
          {err && <p className="text-sm text-rose-500">{err}</p>}

          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-muted)]">Log</p>
            <ul className="space-y-1.5 text-xs">
              {[...req.history].reverse().map((h, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-36 shrink-0 text-[color:var(--text-muted)]">{fmtDateTime(h.at)}</span>
                  <span>
                    <span className="font-medium">{HISTORY_LABEL[h.action] ?? h.action}</span>
                    {h.step != null && req.steps[h.step] ? ` · ${req.steps[h.step].name}` : ''}
                    {h.actorId ? ` · ${nameOf(h.actorId as never)}` : ''}
                    {h.onBehalfOf ? ` for ${nameOf(h.onBehalfOf as never)}` : ''}
                    {h.note ? ` — ${h.note}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">{label}</p>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}

// ── Delegations ──────────────────────────────────────────────────────────────

function DelegationsTab({ canManage }: { canManage: boolean }) {
  const { token, user } = useAuth();
  const [rows, setRows] = useState<ApprovalDelegation[] | null>(null);
  const [people, setPeople] = useState<ProcurementApprover[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [now, setNow] = useState(0);
  const [form, setForm] = useState<{ fromUserId: string; toUserId: string; startsAt: string; endsAt: string; recordTypes: ApprovalRecordType[]; note: string } | null>(null);
  const [err, setErr] = useState('');
  const me = user?.id ?? '';

  const load = useCallback(() => {
    if (!token) return;
    approvalsApi.delegations(showAll, token).then((r) => {
      setNow(Date.now());
      setRows(r.success && r.data ? r.data : []);
    });
  }, [token, showAll]);
  useEffect(load, [load]);
  useEffect(() => {
    if (token) approvalsApi.people(token).then((r) => r.success && r.data && setPeople(r.data));
  }, [token]);

  const today = new Date().toISOString().slice(0, 10);
  const save = async () => {
    if (!token || !form) return;
    if (!form.toUserId) return setErr('Choose who will approve for you.');
    if (!form.endsAt) return setErr('Choose the last day.');
    const r = await approvalsApi.createDelegation(
      {
        ...(canManage && form.fromUserId ? { fromUserId: form.fromUserId } : {}),
        toUserId: form.toUserId,
        startsAt: new Date(`${form.startsAt}T00:00:00`).toISOString(),
        endsAt: new Date(`${form.endsAt}T23:59:59`).toISOString(),
        recordTypes: form.recordTypes,
        note: form.note || undefined,
      },
      token
    );
    if (!r.success) return setErr(r.message || 'Could not save the delegation');
    setForm(null);
    setErr('');
    load();
  };

  const end = async (id: string) => {
    if (!token) return;
    const r = await approvalsApi.endDelegation(id, token);
    if (!r.success) setErr(r.message || 'Could not end the delegation');
    load();
  };

  const stateOf = (d: ApprovalDelegation) =>
    new Date(d.endsAt).getTime() <= now ? 'ended' : new Date(d.startsAt).getTime() > now ? 'scheduled' : 'active';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[color:var(--text-muted)]">
          Going on leave? Pick someone to approve for you. They decide “on behalf of” you, and can never approve a request for the person who asked.
        </p>
        <div className="flex items-center gap-2">
          {canManage && (
            <label className="flex items-center gap-1.5 text-xs text-[color:var(--text-muted)]">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Everyone's
            </label>
          )}
          <PrimaryButton onClick={() => { setErr(''); setForm({ fromUserId: '', toUserId: '', startsAt: today, endsAt: '', recordTypes: [], note: '' }); }}>
            + Delegate
          </PrimaryButton>
        </div>
      </div>
      {err && !form && <p className="text-sm text-rose-500">{err}</p>}
      {!rows ? (
        <ModuleLoader size="block" />
      ) : rows.length === 0 ? (
        <Empty>No delegations. Add one before you go on leave.</Empty>
      ) : (
        tableWrap(
          <>
            <thead className="text-left text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
              <tr className="border-b border-[color:var(--border-subtle)]">
                <th className="px-4 py-2.5">Approver</th>
                <th className="px-4 py-2.5">Delegate</th>
                <th className="px-4 py-2.5">From</th>
                <th className="px-4 py-2.5">Until</th>
                <th className="px-4 py-2.5">Covers</th>
                <th className="px-4 py-2.5">State</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const st = stateOf(d);
                const fromId = typeof d.fromUserId === 'string' ? d.fromUserId : d.fromUserId._id;
                const mayEnd = st !== 'ended' && (fromId === me || d.createdBy === me || canManage);
                return (
                  <tr key={d._id} className="border-b border-[color:var(--border-subtle)] last:border-0">
                    <td className="px-4 py-2.5">{fromId === me ? 'You' : nameOf(d.fromUserId as never)}</td>
                    <td className="px-4 py-2.5">{nameOf(d.toUserId as never)}</td>
                    <td className="px-4 py-2.5">{fmtDate(d.startsAt)}</td>
                    <td className="px-4 py-2.5">{fmtDate(d.endsAt)}</td>
                    <td className="px-4 py-2.5">{d.recordTypes.length ? d.recordTypes.map((t) => TYPE_LABEL[t]).join(', ') : 'Everything'}</td>
                    <td className="px-4 py-2.5"><StatusPill label={st} tone={st === 'active' ? 'green' : st === 'scheduled' ? 'blue' : 'slate'} /></td>
                    <td className="px-4 py-2.5 text-right">
                      {mayEnd && <GhostButton onClick={() => end(d._id)}>{st === 'scheduled' ? 'Remove' : 'End now'}</GhostButton>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </>
        )
      )}

      {form && (
        <Modal
          title="Delegate approvals"
          onClose={() => setForm(null)}
          footer={<><GhostButton onClick={() => setForm(null)}>Cancel</GhostButton><PrimaryButton onClick={save}>Save</PrimaryButton></>}
        >
          {canManage && (
            <Field label="Approver (leave empty for yourself)">
              <PersonSelect value={form.fromUserId} onChange={(v) => setForm({ ...form, fromUserId: v })} people={toPeople(people)} clearValue="" placeholder="Yourself" aria-label="Approver" />
            </Field>
          )}
          <Field label="Delegate">
            <PersonSelect
              value={form.toUserId}
              onChange={(v) => setForm({ ...form, toUserId: v })}
              people={toPeople(people.filter((p) => p._id !== (form.fromUserId || me)))}
              placeholder="Search people…"
              aria-label="Delegate"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From"><TextInput type="date" value={form.startsAt} min={today} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></Field>
            <Field label="Until (inclusive)"><TextInput type="date" value={form.endsAt} min={form.startsAt || today} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></Field>
          </div>
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-muted)]">Covers (none ticked = everything)</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {RECORD_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={form.recordTypes.includes(t)}
                    onChange={(e) =>
                      setForm({ ...form, recordTypes: e.target.checked ? [...form.recordTypes, t] : form.recordTypes.filter((x) => x !== t) })
                    }
                  />
                  {TYPE_LABEL[t]}
                </label>
              ))}
            </div>
          </div>
          <Field label="Note"><TextInput value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. Annual leave" /></Field>
          {err && <p className="text-sm text-rose-500">{err}</p>}
        </Modal>
      )}
    </div>
  );
}

// ── Chains (admin) ───────────────────────────────────────────────────────────

type StepForm = Omit<ApprovalPolicyStep, 'aboveAmount' | 'level'> & { aboveAmount: string; level: string };

function toForm(s: ApprovalPolicyStep): StepForm {
  return { ...s, level: String(s.level ?? 1), aboveAmount: s.aboveAmount == null ? '' : String(s.aboveAmount), userIds: s.userIds ?? [] };
}

function describeStep(s: ApprovalPolicyStep, roles: Array<{ _id: string; name: string }>, people: ProcurementApprover[]): string {
  if (s.kind === 'manager') return ordinal(s.level ?? 1);
  if (s.kind === 'role') return `Role: ${roles.find((r) => r._id === s.roleId)?.name ?? 'unknown role'}`;
  if (s.kind === 'users') return (s.userIds ?? []).map((u) => people.find((p) => p._id === u)?.name ?? 'someone').join(', ');
  if (s.kind === 'discount_limit') return 'Anyone whose quotation discount limit covers the discount';
  return `Permission: ${s.permission}`;
}

function ChainsTab() {
  const { token } = useAuth();
  const [policies, setPolicies] = useState<ApprovalPolicy[] | null>(null);
  const [roles, setRoles] = useState<Array<{ _id: string; name: string }>>([]);
  const [people, setPeople] = useState<ProcurementApprover[]>([]);
  const [editing, setEditing] = useState<{ policy: ApprovalPolicy; steps: StepForm[]; fallbackUserIds: string[]; enabled: boolean } | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    if (!token) return;
    approvalsApi.policies(token).then((r) => setPolicies(r.success && r.data ? r.data : []));
  }, [token]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!token) return;
    approvalsApi.roles(token).then((r) => r.success && r.data && setRoles(r.data));
    approvalsApi.people(token).then((r) => r.success && r.data && setPeople(r.data));
  }, [token]);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(''), 4000);
  };

  const toggle = async (p: ApprovalPolicy) => {
    if (!token) return;
    setErr('');
    const r = await approvalsApi.savePolicy(p.recordType, { enabled: !p.enabled }, token);
    if (!r.success) return setErr(r.message || 'Could not change the chain');
    flash(`${p.label}: chain ${!p.enabled ? 'on' : 'off'}.`);
    load();
  };

  const save = async () => {
    if (!token || !editing) return;
    setErr('');
    const steps: ApprovalPolicyStep[] = editing.steps.map((s) => ({
      name: s.name.trim(),
      kind: s.kind,
      ...(s.kind === 'manager' ? { level: Number(s.level) || 1 } : {}),
      ...(s.kind === 'role' ? { roleId: s.roleId } : {}),
      ...(s.kind === 'users' ? { userIds: s.userIds } : {}),
      ...(s.kind === 'permission' ? { permission: s.permission?.trim() } : {}),
      aboveAmount: s.aboveAmount.trim() === '' ? null : Number(s.aboveAmount),
    }));
    const r = await approvalsApi.savePolicy(editing.policy.recordType, { steps, fallbackUserIds: editing.fallbackUserIds, enabled: editing.enabled }, token);
    if (!r.success) return setErr(r.message || 'Could not save the chain');
    setEditing(null);
    flash(`${editing.policy.label}: chain saved.`);
    load();
  };

  const setStep = (i: number, patch: Partial<StepForm>) => {
    if (!editing) return;
    const steps = [...editing.steps];
    steps[i] = { ...steps[i], ...patch };
    setEditing({ ...editing, steps });
  };
  const move = (i: number, dir: -1 | 1) => {
    if (!editing) return;
    const steps = [...editing.steps];
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    setEditing({ ...editing, steps });
  };

  if (!policies) return <ModuleLoader size="block" />;

  return (
    <div className="space-y-3">
      <p className="text-sm text-[color:var(--text-muted)]">
        Set who approves each kind of record, in order. A step can apply only above an amount, e.g. “Team lead”, then “Department head above 1,000”, then “CEO above 10,000”.
        While a chain is off, the module keeps its own approval rules.
      </p>
      {msg && <p className="text-sm text-emerald-600">{msg}</p>}
      {err && !editing && <p className="text-sm text-rose-500">{err}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {policies.map((p) => (
          <div key={p.recordType} className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">{p.label}</h3>
                <p className="text-xs text-[color:var(--text-muted)]">
                  {p.mode === 'gate' ? 'Must be approved before it can be sent or finalized' : 'The chain decides approve or reject'}
                </p>
              </div>
              <label className="flex items-center gap-1.5 text-xs font-medium">
                <input type="checkbox" checked={p.enabled} onChange={() => toggle(p)} disabled={!p.enabled && p.steps.length === 0} />
                {p.enabled ? 'On' : 'Off'}
              </label>
            </div>
            {p.steps.length === 0 ? (
              <p className="mt-3 text-sm text-[color:var(--text-muted)]">No steps yet.</p>
            ) : (
              <ol className="mt-3 space-y-1.5 text-sm">
                {p.steps.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="w-4 text-xs font-semibold text-[color:var(--text-muted)]">{i + 1}</span>
                    <span>
                      <span className="font-medium">{s.name}</span>
                      <span className="text-[color:var(--text-muted)]"> · {describeStep(s, roles, people)}</span>
                      {s.aboveAmount != null && <span className="text-[color:var(--text-muted)]"> · {p.amountLabel.toLowerCase()} above {s.aboveAmount}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {p.fallbackUserIds.length > 0 && (
              <p className="mt-2 text-xs text-[color:var(--text-muted)]">
                Fallback: {p.fallbackUserIds.map((u) => people.find((x) => x._id === u)?.name ?? 'someone').join(', ')}
              </p>
            )}
            <div className="mt-3">
              <GhostButton
                onClick={() => {
                  setErr('');
                  setEditing({ policy: p, steps: p.steps.map(toForm), fallbackUserIds: [...p.fallbackUserIds], enabled: p.enabled });
                }}
              >
                Edit chain
              </GhostButton>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <Modal
          title={`${editing.policy.label}: approval chain`}
          onClose={() => setEditing(null)}
          wide
          footer={<><GhostButton onClick={() => setEditing(null)}>Cancel</GhostButton><PrimaryButton onClick={save}>Save chain</PrimaryButton></>}
        >
          <div className="space-y-3">
            {editing.steps.map((s, i) => (
              <div key={i} className="space-y-2 rounded-xl border border-[color:var(--border-subtle)] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[color:var(--text-muted)]">Step {i + 1}</span>
                  <div className="flex gap-1 text-sm">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="px-1.5 disabled:opacity-30" aria-label="Move up">↑</button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === editing.steps.length - 1} className="px-1.5 disabled:opacity-30" aria-label="Move down">↓</button>
                    <button type="button" onClick={() => setEditing({ ...editing, steps: editing.steps.filter((_, j) => j !== i) })} className="px-1.5 text-rose-500" aria-label="Remove step">✕</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Step name"><TextInput value={s.name} placeholder="e.g. Department head" onChange={(e) => setStep(i, { name: e.target.value })} /></Field>
                  <Field label="Approved by">
                    <Select value={s.kind} onChange={(e) => setStep(i, { kind: e.target.value as ApproverKind })}>
                      {(Object.keys(KIND_LABEL) as ApproverKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                    </Select>
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {s.kind === 'manager' && (
                    <Field label="Level">
                      <Select value={s.level} onChange={(e) => setStep(i, { level: e.target.value })}>
                        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{ordinal(n)}</option>)}
                      </Select>
                    </Field>
                  )}
                  {s.kind === 'role' && (
                    <Field label="Role">
                      <Select value={s.roleId ?? ''} onChange={(e) => setStep(i, { roleId: e.target.value })}>
                        <option value="">Choose a role…</option>
                        {roles.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
                      </Select>
                    </Field>
                  )}
                  {s.kind === 'permission' && (
                    <Field label="Permission code">
                      <TextInput value={s.permission ?? ''} placeholder="e.g. taskflow.accounts.expense.approve" onChange={(e) => setStep(i, { permission: e.target.value })} />
                    </Field>
                  )}
                  {s.kind === 'users' && (
                    <div className="col-span-2">
                      <Field label="People (any one of them can approve)">
                        <PersonMultiSelect values={s.userIds ?? []} onChange={(v) => setStep(i, { userIds: v })} people={toPeople(people)} aria-label="Approvers" />
                      </Field>
                    </div>
                  )}
                  <Field label={`Only when ${editing.policy.amountLabel.toLowerCase()} is above (empty = always)`}>
                    <TextInput type="number" min={0} value={s.aboveAmount} onChange={(e) => setStep(i, { aboveAmount: e.target.value })} />
                  </Field>
                </div>
              </div>
            ))}
            <button
              type="button"
              disabled={editing.steps.length >= 10}
              onClick={() => setEditing({ ...editing, steps: [...editing.steps, { name: '', kind: 'manager', level: '1', aboveAmount: '', userIds: [] }] })}
              className="text-sm text-[color:var(--accent)] hover:underline disabled:opacity-40"
            >
              + Add step
            </button>

            <Field label="Fallback approvers (used when nobody a step names can approve, e.g. no manager on file)">
              <PersonMultiSelect values={editing.fallbackUserIds} onChange={(v) => setEditing({ ...editing, fallbackUserIds: v })} people={toPeople(people)} aria-label="Fallback approvers" />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editing.enabled} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} />
              Use this chain for {editing.policy.label.toLowerCase()}
            </label>
            <p className="text-xs text-[color:var(--text-muted)]">
              Requests already in progress keep the chain they started with. Nobody approves their own request, and one person approves at most one step of it.
            </p>
            {err && <p className="text-sm text-rose-500">{err}</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}
