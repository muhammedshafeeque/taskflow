import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiCheck, FiClock, FiPlus, FiRotateCcw, FiSearch } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { crmApi, usersApi, type CrmAccount, type CrmActivity, type CrmDeal, type CrmLead, type User } from '../../lib/api';
import { PersonSelect, toPeople } from '../../components/people';
import ConfirmModal from '../../components/ConfirmModal';
import {
  Chip,
  CrmShell,
  EmptyState,
  Field,
  LoadingBlock,
  Modal,
  Notice,
  RowMenu,
  Segmented,
  Stat,
  btnPrimary,
  btnSecondary,
  daysUntil,
  errorOf,
  fmtDate,
  inputCls,
  prettyLabel,
  refId,
  refName,
  toDateTimeInput,
} from './crmKit';

const TYPES = ['task', 'call', 'meeting', 'email', 'note', 'demo', 'follow_up'];
type Scope = 'open' | 'overdue' | 'today' | 'done' | 'all';

type Form = { type: string; subject: string; body: string; dueAt: string; relatedType: string; relatedId: string; assigneeId: string };
const EMPTY: Form = { type: 'follow_up', subject: '', body: '', dueAt: '', relatedType: 'lead', relatedId: '', assigneeId: '' };

function relatedHref(a: CrmActivity) {
  if (!a.relatedId) return null;
  if (a.relatedType === 'lead') return `/crm/leads/${a.relatedId}`;
  if (a.relatedType === 'deal') return `/crm/deals/${a.relatedId}`;
  if (a.relatedType === 'account') return `/crm/accounts/${a.relatedId}`;
  return null;
}

function isToday(v?: string) {
  if (!v) return false;
  const d = new Date(v);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

export default function CrmActivities() {
  const { token, user } = useAuth();
  const canCreate = canAny(user, 'taskflow.crm.activity.create');
  const canUpdate = canAny(user, 'taskflow.crm.activity.update');
  const canDelete = canAny(user, 'taskflow.crm.activity.delete');
  const [items, setItems] = useState<CrmActivity[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [accounts, setAccounts] = useState<CrmAccount[]>([]);
  const [modal, setModal] = useState<{ editing: CrmActivity | null } | null>(null);
  const [deleting, setDeleting] = useState<CrmActivity | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>('open');
  const [type, setType] = useState('');
  const [assignee, setAssignee] = useState('');
  const [search, setSearch] = useState('');
  const [tick, setTick] = useState(0);
  const load = () => setTick((t) => t + 1);

  useEffect(() => {
    if (!token) return;
    let stale = false;
    crmApi.listActivities(token).then((res) => {
      if (stale) return;
      if (res.success && res.data) setItems(res.data);
      else setNotice(errorOf(res, 'Could not load activities.'));
    });
    return () => {
      stale = true;
    };
  }, [token, tick]);

  useEffect(() => {
    if (!token) return;
    usersApi.list(1, 100, token).then((res) => {
      if (res.success && res.data) setUsers(res.data.data ?? []);
    });
    crmApi.listLeads(token, { limit: 100 }).then((res) => {
      if (res.success && res.data) setLeads(res.data.data ?? []);
    });
    crmApi.listDeals(token).then((res) => {
      if (res.success && res.data) setDeals(res.data);
    });
    crmApi.listAccounts(token).then((res) => {
      if (res.success && res.data) setAccounts(res.data.data ?? []);
    });
  }, [token]);

  const all = useMemo(() => items ?? [], [items]);
  const counts = useMemo(() => {
    const open = all.filter((a) => !a.completedAt);
    return {
      open: open.length,
      overdue: open.filter((a) => (daysUntil(a.dueAt) ?? 0) < 0).length,
      today: open.filter((a) => isToday(a.dueAt)).length,
      done: all.length - open.length,
      all: all.length,
    };
  }, [all]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((a) => {
        const open = !a.completedAt;
        if (scope === 'open' && !open) return false;
        if (scope === 'done' && open) return false;
        if (scope === 'overdue' && !(open && (daysUntil(a.dueAt) ?? 0) < 0)) return false;
        if (scope === 'today' && !(open && isToday(a.dueAt))) return false;
        if (type && a.type !== type) return false;
        if (assignee === 'none' ? refId(a.assigneeId) : assignee && refId(a.assigneeId) !== assignee) return false;
        if (q && !`${a.subject} ${a.body ?? ''} ${a.relatedTitle ?? ''}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) =>
        scope === 'done'
          ? new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime()
          : new Date(a.dueAt ?? '9999').getTime() - new Date(b.dueAt ?? '9999').getTime()
      );
  }, [all, scope, type, assignee, search]);

  async function run(fn: () => Promise<{ success: boolean }>, fallback: string) {
    const res = await fn();
    if (!res.success) setNotice(errorOf(res, fallback));
    load();
  }

  return (
    <CrmShell
      title="Activities"
      description={
        <>
          Calls, tasks, meetings and follow-ups across leads, deals and accounts.{' '}
          <Link to="/crm/follow-ups" className="text-[color:var(--accent)] hover:underline">
            Open follow-up queue →
          </Link>
        </>
      }
      actions={
        canCreate && (
          <button type="button" className={btnPrimary} onClick={() => setModal({ editing: null })}>
            <FiPlus /> New activity
          </button>
        )
      }
    >
      <Notice message={notice} onClose={() => setNotice(null)} />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label="Open" value={counts.open} />
        <Stat label="Overdue" value={counts.overdue} tone={counts.overdue ? 'bad' : undefined} />
        <Stat label="Due today" value={counts.today} tone={counts.today ? 'warn' : undefined} />
        <Stat label="Completed" value={counts.done} tone="good" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented<Scope>
          value={scope}
          onChange={setScope}
          options={(['open', 'overdue', 'today', 'done', 'all'] as const).map((s) => ({
            value: s,
            label: s === 'done' ? 'Completed' : s === 'today' ? 'Today' : prettyLabel(s),
            count: counts[s],
          }))}
        />
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className={`${inputCls} pl-9`} />
        </div>
        <select value={type} onChange={(e) => setType(e.target.value)} className={`${inputCls} !w-auto`}>
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {prettyLabel(t)}
            </option>
          ))}
        </select>
        <div className="w-52">
          <PersonSelect
            value={assignee}
            onChange={setAssignee}
            people={toPeople(users)}
            specialOptions={[
              { value: '', label: 'Anyone' },
              { value: 'none', label: 'Unassigned' },
            ]}
            clearValue=""
            placeholder="Assignee"
          />
        </div>
      </div>

      {!items ? (
        <LoadingBlock label="Loading activities…" />
      ) : shown.length === 0 ? (
        <EmptyState title={scope === 'overdue' ? 'Nothing overdue' : 'No activities here'}>
          {scope === 'overdue' ? 'Every open activity is on schedule.' : 'Change the filters or log a new activity.'}
        </EmptyState>
      ) : (
        <ul className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] divide-y divide-[color:var(--border-subtle)]">
          {shown.map((a) => {
            const due = daysUntil(a.dueAt);
            const overdue = !a.completedAt && due != null && due < 0;
            const href = relatedHref(a);
            return (
              <li key={a._id} className="flex items-start gap-3 px-4 py-3 hover:bg-[color:var(--bg-elevated)]/50">
                {canUpdate ? (
                  <button
                    type="button"
                    title={a.completedAt ? 'Reopen' : 'Mark done'}
                    onClick={() =>
                      void run(
                        () => (a.completedAt ? crmApi.updateActivity(a._id, { completed: false }, token!) : crmApi.completeActivity(a._id, token!)),
                        'Could not update the activity.'
                      )
                    }
                    className={`mt-0.5 shrink-0 w-5 h-5 rounded-full border grid place-items-center transition ${
                      a.completedAt ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-[color:var(--border-subtle)] hover:border-emerald-500 text-transparent hover:text-emerald-500'
                    }`}
                  >
                    <FiCheck className="text-[11px]" />
                  </button>
                ) : (
                  <span className="mt-0.5 w-5" />
                )}
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${a.completedAt ? 'line-through text-[color:var(--text-muted)]' : 'font-medium'}`}>
                    <Chip tone="neutral">{prettyLabel(a.type)}</Chip> <span className="ml-1">{a.subject}</span>
                  </p>
                  <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5 flex flex-wrap gap-x-3">
                    <span>
                      {prettyLabel(a.relatedType)}
                      {a.relatedTitle && (
                        <>
                          {' · '}
                          {href ? (
                            <Link to={href} className="hover:underline text-[color:var(--text-primary)]">
                              {a.relatedTitle}
                            </Link>
                          ) : (
                            a.relatedTitle
                          )}
                        </>
                      )}
                    </span>
                    {a.dueAt && (
                      <span className={overdue ? 'text-red-400' : isToday(a.dueAt) && !a.completedAt ? 'text-amber-400' : ''}>
                        <FiClock className="inline -mt-0.5 mr-0.5" />
                        {new Date(a.dueAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                        {overdue && ` · ${-due!}d late`}
                      </span>
                    )}
                    <span>{refName(a.assigneeId) || 'Unassigned'}</span>
                    {a.completedAt && <span>Done {fmtDate(a.completedAt)}</span>}
                  </p>
                  {a.body && <p className="text-xs text-[color:var(--text-muted)] mt-1 whitespace-pre-wrap line-clamp-3">{a.body}</p>}
                </div>
                <RowMenu
                  onEdit={canUpdate ? () => setModal({ editing: a }) : undefined}
                  onDelete={canDelete ? () => setDeleting(a) : undefined}
                  extra={
                    canUpdate && a.completedAt
                      ? [{ label: 'Reopen', icon: <FiRotateCcw />, onClick: () => void run(() => crmApi.updateActivity(a._id, { completed: false }, token!), 'Could not reopen.') }]
                      : []
                  }
                />
              </li>
            );
          })}
        </ul>
      )}

      {modal && (
        <ActivityModal
          editing={modal.editing}
          users={users}
          leads={leads}
          deals={deals}
          accounts={accounts}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            load();
          }}
        />
      )}
      <ConfirmModal
        open={!!deleting}
        title="Delete activity?"
        message={`“${deleting?.subject ?? ''}” will be removed permanently.`}
        confirmLabel="Delete"
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          if (target) void run(() => crmApi.deleteActivity(target._id, token!), 'Could not delete the activity.');
        }}
        onCancel={() => setDeleting(null)}
      />
    </CrmShell>
  );
}

function ActivityModal({
  editing,
  users,
  leads,
  deals,
  accounts,
  onClose,
  onSaved,
}: {
  editing: CrmActivity | null;
  users: User[];
  leads: CrmLead[];
  deals: CrmDeal[];
  accounts: CrmAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { token } = useAuth();
  const [form, setForm] = useState<Form>(() =>
    editing
      ? {
          type: editing.type,
          subject: editing.subject,
          body: editing.body ?? '',
          dueAt: toDateTimeInput(editing.dueAt),
          relatedType: editing.relatedType ?? 'lead',
          relatedId: editing.relatedId ?? '',
          assigneeId: refId(editing.assigneeId),
        }
      : EMPTY
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const relatedOptions =
    form.relatedType === 'deal'
      ? deals.map((d) => ({ id: d._id, label: d.title }))
      : form.relatedType === 'account'
        ? accounts.map((a) => ({ id: a._id, label: a.name }))
        : leads.map((l) => ({ id: l._id, label: l.title }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !form.subject.trim()) return;
    if (!editing && !form.relatedId) return setError('Pick the record this activity belongs to.');
    setSaving(true);
    const dueAt = form.dueAt ? new Date(form.dueAt).toISOString() : '';
    const res = editing
      ? await crmApi.updateActivity(
          editing._id,
          { type: form.type, subject: form.subject.trim(), body: form.body.trim(), dueAt, assigneeId: form.assigneeId },
          token
        )
      : await crmApi.createActivity(
          {
            type: form.type,
            subject: form.subject.trim(),
            body: form.body.trim() || undefined,
            dueAt: dueAt || undefined,
            relatedType: form.relatedType,
            relatedId: form.relatedId,
            assigneeId: form.assigneeId || undefined,
          },
          token
        );
    setSaving(false);
    if (!res.success) return setError(errorOf(res, 'Could not save the activity.'));
    onSaved();
  }

  return (
    <Modal open title={editing ? 'Edit activity' : 'New activity'} subtitle={editing?.relatedTitle} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => set({ type: t })}
              className={`rounded-full px-2.5 py-1 text-xs border transition ${
                form.type === t
                  ? 'border-[color:var(--accent)] bg-[color:var(--accent-subtle)] text-[color:var(--accent)]'
                  : 'border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
              }`}
            >
              {prettyLabel(t)}
            </button>
          ))}
        </div>
        <Field label="Subject">
          <input autoFocus required value={form.subject} onChange={(e) => set({ subject: e.target.value })} className={inputCls} />
        </Field>
        {!editing && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Related to">
              <select value={form.relatedType} onChange={(e) => set({ relatedType: e.target.value, relatedId: '' })} className={inputCls}>
                <option value="lead">Lead</option>
                <option value="deal">Deal</option>
                <option value="account">Account</option>
              </select>
            </Field>
            <Field label="Record">
              <select required value={form.relatedId} onChange={(e) => set({ relatedId: e.target.value })} className={inputCls}>
                <option value="">Select…</option>
                {relatedOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Assignee">
            <PersonSelect
              value={form.assigneeId}
              onChange={(v) => set({ assigneeId: v })}
              people={toPeople(users)}
              specialOptions={[{ value: '', label: 'Unassigned' }]}
              clearValue=""
            />
          </Field>
          <Field label="Due">
            <input type="datetime-local" value={form.dueAt} onChange={(e) => set({ dueAt: e.target.value })} className={inputCls} />
          </Field>
        </div>
        <Field label="Notes">
          <textarea rows={3} value={form.body} onChange={(e) => set({ body: e.target.value })} className={inputCls} />
        </Field>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={btnPrimary}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create activity'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
