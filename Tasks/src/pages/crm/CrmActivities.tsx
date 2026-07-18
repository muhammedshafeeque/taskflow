import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { crmApi, type CrmActivity } from '../../lib/api';

const TYPES = ['task', 'call', 'meeting', 'email', 'note', 'demo', 'follow_up'];

export default function CrmActivities() {
  const { token, user } = useAuth();
  const canCreate = canAny(user, 'taskflow.crm.activity.create');
  const canUpdate = canAny(user, 'taskflow.crm.activity.update');
  const canDelete = canAny(user, 'taskflow.crm.activity.delete');
  const [items, setItems] = useState<CrmActivity[]>([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({
    type: 'task',
    subject: '',
    body: '',
    dueAt: '',
  });

  const load = () => {
    if (!token) return;
    crmApi.listActivities(token).then((res) => {
      if (res.success && res.data) setItems(res.data as CrmActivity[]);
    });
  };

  useEffect(() => {
    load();
  }, [token]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !form.subject.trim()) return;
    await crmApi.createActivity(
      {
        type: form.type,
        subject: form.subject.trim(),
        body: form.body.trim() || undefined,
        dueAt: form.dueAt || undefined,
      },
      token
    );
    setModal(false);
    setForm({ type: 'task', subject: '', body: '', dueAt: '' });
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

  const open = items.filter((a) => !a.completedAt);
  const done = items.filter((a) => a.completedAt);

  return (
    <div className="p-8 w-full px-4 sm:px-6 lg:px-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Activities</h1>
          <p className="text-[13px] text-[color:var(--text-muted)]">Calls, tasks, meetings, and follow-ups.</p>
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
                {a.dueAt && <p className="text-xs text-[color:var(--text-muted)]">Due {new Date(a.dueAt).toLocaleString()}</p>}
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
