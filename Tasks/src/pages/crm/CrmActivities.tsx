import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { crmApi, usersApi, type CrmAccount, type CrmActivity, type CrmDeal, type CrmLead, type User } from '../../lib/api';
import { PersonSelect, toPeople } from '../../components/people';

const TYPES = ['task', 'call', 'meeting', 'email', 'note', 'demo', 'follow_up'];

export default function CrmActivities() {
  const { token, user } = useAuth();
  const canCreate = canAny(user, 'taskflow.crm.activity.create');
  const canUpdate = canAny(user, 'taskflow.crm.activity.update');
  const canDelete = canAny(user, 'taskflow.crm.activity.delete');
  const [items, setItems] = useState<CrmActivity[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [accounts, setAccounts] = useState<CrmAccount[]>([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({
    type: 'follow_up',
    subject: '',
    body: '',
    dueAt: '',
    relatedType: 'lead',
    relatedId: '',
    assigneeId: '',
  });

  const load = () => {
    if (!token) return;
    crmApi.listActivities(token).then((res) => {
      if (res.success && res.data) setItems(res.data);
    });
  };

  useEffect(() => {
    load();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    usersApi.list(1, 100, token).then((res) => {
      if (res.success && res.data) setUsers(res.data.data ?? []);
    });
    crmApi.listLeads(token, { limit: 100 }).then((res) => {
      if (res.success && res.data) setLeads(res.data.data ?? []);
    });
    crmApi.listDeals(token).then((res) => {
      if (res.success && res.data) setDeals(res.data as CrmDeal[]);
    });
    crmApi.listAccounts(token).then((res) => {
      if (res.success && res.data) setAccounts((res.data as { data: CrmAccount[] }).data ?? []);
    });
  }, [token]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !form.subject.trim() || !form.relatedId) return;
    await crmApi.createActivity(
      {
        type: form.type,
        subject: form.subject.trim(),
        body: form.body.trim() || undefined,
        dueAt: form.dueAt || undefined,
        relatedType: form.relatedType,
        relatedId: form.relatedId,
        assigneeId: form.assigneeId || undefined,
      },
      token
    );
    setModal(false);
    setForm({ type: 'follow_up', subject: '', body: '', dueAt: '', relatedType: 'lead', relatedId: '', assigneeId: '' });
    load();
  }

  async function complete(id: string) {
    if (!token || !canUpdate) return;
    await crmApi.completeActivity(id, token);
    load();
  }

  async function remove(id: string) {
    if (!token || !canDelete) return;
    if (!confirm('Delete activity?')) return;
    await crmApi.deleteActivity(id, token);
    load();
  }

  const relatedOptions =
    form.relatedType === 'deal'
      ? deals.map((d) => ({ id: d._id, label: d.title }))
      : form.relatedType === 'account'
        ? accounts.map((a) => ({ id: a._id, label: a.name }))
        : leads.map((l) => ({ id: l._id, label: l.title }));

  const open = items.filter((a) => !a.completedAt);
  const done = items.filter((a) => a.completedAt);

  return (
    <div className="p-8 w-full px-4 sm:px-6 lg:px-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Activities</h1>
          <p className="text-[13px] text-[color:var(--text-muted)]">
            Calls, tasks, meetings, and follow-ups.{' '}
            <Link to="/crm/follow-ups" className="text-[color:var(--accent)] hover:underline">
              Open follow-up queue
            </Link>
          </p>
        </div>
        {canCreate && (
          <button type="button" className="btn-primary px-4 py-2 rounded-lg text-sm" onClick={() => setModal(true)}>
            Add activity
          </button>
        )}
      </div>

      <section>
        <h2 className="font-medium mb-3">Open</h2>
        <div className="space-y-2">
          {open.map((a) => (
            <div key={a._id} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 flex flex-wrap justify-between gap-3">
              <div>
                <p className="font-medium text-sm">
                  <span className="text-[color:var(--text-muted)] capitalize">{a.type}</span> — {a.subject}
                </p>
                <p className="text-xs text-[color:var(--text-muted)]">
                  {a.relatedType}
                  {a.relatedTitle ? ` · ${a.relatedTitle}` : ''}
                  {a.dueAt ? ` · due ${new Date(a.dueAt).toLocaleString()}` : ''}
                </p>
                {a.body && <p className="text-xs text-[color:var(--text-muted)] mt-1">{a.body}</p>}
              </div>
              <div className="flex gap-2 text-sm">
                {canUpdate && (
                  <button type="button" className="text-[color:var(--accent)] hover:underline" onClick={() => void complete(a._id)}>
                    Complete
                  </button>
                )}
                {canDelete && (
                  <button type="button" className="text-red-400 hover:underline" onClick={() => void remove(a._id)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
          {open.length === 0 && <p className="text-sm text-[color:var(--text-muted)]">No open activities.</p>}
        </div>
      </section>

      <section>
        <h2 className="font-medium mb-3">Completed</h2>
        <div className="space-y-2">
          {done.slice(0, 20).map((a) => (
            <div key={a._id} className="rounded-xl border border-[color:var(--border-subtle)]/60 p-3 text-sm text-[color:var(--text-muted)]">
              <span className="capitalize">{a.type}</span> — {a.subject}
            </div>
          ))}
          {done.length === 0 && <p className="text-sm text-[color:var(--text-muted)]">None yet.</p>}
        </div>
      </section>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setModal(false)}>
          <form onSubmit={create} className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl max-w-md w-full p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">New activity</h2>
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Type</span>
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm">
                {TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs space-y-1">
                <span className="text-[color:var(--text-muted)]">Related to</span>
                <select
                  value={form.relatedType}
                  onChange={(e) => setForm((f) => ({ ...f, relatedType: e.target.value, relatedId: '' }))}
                  className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                >
                  <option value="lead">Lead</option>
                  <option value="deal">Deal</option>
                  <option value="account">Account</option>
                </select>
              </label>
              <label className="block text-xs space-y-1">
                <span className="text-[color:var(--text-muted)]">Record</span>
                <select
                  required
                  value={form.relatedId}
                  onChange={(e) => setForm((f) => ({ ...f, relatedId: e.target.value }))}
                  className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                >
                  <option value="">Select…</option>
                  {relatedOptions.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Assignee</span>
              <PersonSelect
                value={form.assigneeId}
                onChange={(v) => setForm((f) => ({ ...f, assigneeId: v }))}
                people={toPeople(users)}
                specialOptions={[{ value: '', label: 'Unassigned' }]}
                clearValue=""
                aria-label="Assignee"
              />
            </label>
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Subject</span>
              <input required value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
            </label>
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Due</span>
              <input type="datetime-local" value={form.dueAt} onChange={(e) => setForm((f) => ({ ...f, dueAt: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
            </label>
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Notes</span>
              <textarea rows={2} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
            </label>
            <div className="flex gap-2 pt-2">
              <button type="submit" className="btn-primary px-4 py-2 rounded-lg text-sm">Save</button>
              <button type="button" onClick={() => setModal(false)} className="px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
