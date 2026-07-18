import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { serviceApi, type ServiceTicket } from '../../lib/api';
import { StatusPill } from '../../components/moduleKit';

const PRIORITY_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'slate'> = {
  urgent: 'red', high: 'amber', medium: 'blue', low: 'slate',
};
const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'slate' | 'violet'> = {
  open: 'blue', pending: 'amber', in_progress: 'violet', resolved: 'green', closed: 'slate',
};

function assigneeName(a: ServiceTicket['assigneeId']): string | undefined {
  return a && typeof a === 'object' ? a.name : undefined;
}

export default function ServiceDesk() {
  const { token } = useAuth();
  const [tickets, setTickets] = useState<ServiceTicket[]>([]);
  const [subject, setSubject] = useState('');
  const [queue, setQueue] = useState('general');
  const [priority, setPriority] = useState('medium');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    serviceApi.listTickets(token, statusFilter ? { status: statusFilter } : undefined).then((res) => {
      if (res.success && res.data) setTickets(res.data as ServiceTicket[]);
    });
  };

  useEffect(() => { load(); }, [token, statusFilter]);

  const create = async () => {
    if (!token || !subject.trim()) return;
    await serviceApi.createTicket({ subject: subject.trim(), queue, priority }, token);
    setSubject('');
    load();
  };

  const updateStatus = async (id: string, status: string) => {
    if (!token) return;
    await serviceApi.updateTicket(id, { status }, token);
    load();
  };

  return (
    <div className="p-8 w-full px-4 sm:px-6 lg:px-8">
      <h1 className="text-xl font-semibold mb-4">Service desk</h1>
      <div className="flex flex-wrap gap-2 mb-6">
        <input
          className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm flex-1 min-w-[200px]"
          placeholder="New ticket subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
        />
        <select className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm" value={queue} onChange={(e) => setQueue(e.target.value)}>
          <option value="general">General</option>
          <option value="billing">Billing</option>
          <option value="dev">Dev</option>
          <option value="email">Email</option>
        </select>
        <select className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
        <button type="button" onClick={create} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm">
          Create ticket
        </button>
      </div>

      <div className="mb-3 flex gap-2 text-xs">
        {['', 'open', 'in_progress', 'pending', 'resolved', 'closed'].map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setStatusFilter(s)}
            className={`px-2.5 py-1 rounded-full border capitalize transition ${statusFilter === s ? 'border-[color:var(--accent)] text-[color:var(--accent)]' : 'border-[color:var(--border-subtle)] text-[color:var(--text-muted)]'}`}
          >
            {s ? s.replace('_', ' ') : 'All'}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {tickets.map((t) => (
          <div
            key={t._id}
            onClick={() => setSelectedId(t._id)}
            className="rounded-xl border border-[color:var(--border-subtle)] p-4 flex justify-between items-center gap-4 cursor-pointer hover:border-[color:var(--accent)]/40 transition"
          >
            <div className="min-w-0">
              <p className="font-medium truncate">{t.subject}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <StatusPill label={t.status} tone={STATUS_TONE[t.status]} />
                <StatusPill label={t.priority} tone={PRIORITY_TONE[t.priority]} />
                <span className="text-[11px] text-[color:var(--text-muted)]">{t.queue}</span>
                {assigneeName(t.assigneeId) && <span className="text-[11px] text-[color:var(--text-muted)]">· {assigneeName(t.assigneeId)}</span>}
              </div>
            </div>
            <div className="flex gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
              {t.status === 'open' && (
                <button type="button" onClick={() => updateStatus(t._id, 'in_progress')} className="text-xs text-indigo-400">Start</button>
              )}
              {t.status === 'in_progress' && (
                <button type="button" onClick={() => updateStatus(t._id, 'resolved')} className="text-xs text-emerald-400">Resolve</button>
              )}
              {t.status === 'resolved' && (
                <button type="button" onClick={() => serviceApi.submitCsat(t._id, 5, undefined, token!)} className="text-xs text-amber-400">Close + CSAT</button>
              )}
            </div>
          </div>
        ))}
        {tickets.length === 0 && (
          <p className="text-sm text-[color:var(--text-muted)] py-10 text-center">No tickets.</p>
        )}
      </div>

      {selectedId && (
        <TicketDetail
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function TicketDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { token } = useAuth();
  const [ticket, setTicket] = useState<ServiceTicket | null>(null);
  const [comment, setComment] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    if (!token) return;
    serviceApi.getTicket(id, token).then((r) => { if (r.success && r.data) setTicket(r.data as ServiceTicket); });
  };
  useEffect(reload, [id, token]);

  const addComment = async () => {
    if (!token || !comment.trim()) return;
    setBusy(true);
    const r = await serviceApi.addComment(id, { body: comment.trim(), internal }, token);
    setBusy(false);
    if (r.success && r.data) { setTicket(r.data as ServiceTicket); setComment(''); onChanged(); }
  };

  const setStatus = async (status: string) => {
    if (!token) return;
    await serviceApi.updateTicket(id, { status }, token);
    reload();
    onChanged();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md h-full overflow-y-auto bg-[color:var(--bg-surface)] border-l border-[color:var(--border-subtle)] p-6 animate-fade-in" onClick={(e) => e.stopPropagation()}>
        {!ticket ? (
          <p className="text-sm text-[color:var(--text-muted)]">Loading…</p>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold">{ticket.subject}</h2>
              <button onClick={onClose} className="text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]">✕</button>
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <StatusPill label={ticket.status} tone={STATUS_TONE[ticket.status]} />
              <StatusPill label={ticket.priority} tone={PRIORITY_TONE[ticket.priority]} />
              <span className="text-[11px] text-[color:var(--text-muted)]">{ticket.queue}</span>
            </div>
            {ticket.description && <p className="mt-3 text-sm text-[color:var(--text-muted)] whitespace-pre-wrap">{ticket.description}</p>}

            <div className="mt-4 grid grid-cols-2 gap-2 text-[12px]">
              {ticket.accountId && typeof ticket.accountId === 'object' && (
                <div><span className="text-[color:var(--text-muted)]">Account</span><p className="font-medium">{ticket.accountId.name}</p></div>
              )}
              {ticket.contractId && typeof ticket.contractId === 'object' && (
                <div><span className="text-[color:var(--text-muted)]">Contract</span><p className="font-medium">{ticket.contractId.title}</p></div>
              )}
              {ticket.resolutionDueAt && (
                <div><span className="text-[color:var(--text-muted)]">Resolution due</span><p className={`font-medium ${new Date(ticket.resolutionDueAt) < new Date() && !ticket.resolvedAt ? 'text-rose-500' : ''}`}>{new Date(ticket.resolutionDueAt).toLocaleString()}</p></div>
              )}
              {ticket.firstResponseDueAt && (
                <div><span className="text-[color:var(--text-muted)]">First response due</span><p className="font-medium">{new Date(ticket.firstResponseDueAt).toLocaleString()}</p></div>
              )}
            </div>

            <div className="mt-4 flex gap-2 text-xs">
              {ticket.status === 'open' && <button onClick={() => setStatus('in_progress')} className="px-2.5 py-1 rounded-lg border border-[color:var(--border-subtle)]">Start</button>}
              {['open', 'in_progress', 'pending'].includes(ticket.status) && <button onClick={() => setStatus('resolved')} className="px-2.5 py-1 rounded-lg border border-[color:var(--border-subtle)]">Resolve</button>}
              {ticket.status === 'resolved' && <button onClick={() => setStatus('closed')} className="px-2.5 py-1 rounded-lg border border-[color:var(--border-subtle)]">Close</button>}
            </div>

            <div className="mt-6">
              <h3 className="text-sm font-semibold mb-2">Activity</h3>
              <div className="space-y-3">
                {(ticket.comments ?? []).length === 0 && (
                  <p className="text-[13px] text-[color:var(--text-muted)]">No comments yet.</p>
                )}
                {(ticket.comments ?? []).map((c, i) => (
                  <div key={i} className={`rounded-lg border p-3 ${c.internal ? 'border-amber-500/30 bg-amber-500/5' : 'border-[color:var(--border-subtle)]'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-medium">{c.authorName ?? 'User'}</span>
                      <span className="text-[10px] text-[color:var(--text-muted)]">
                        {c.internal ? 'Internal · ' : ''}{new Date(c.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-[13px] mt-1 whitespace-pre-wrap">{c.body}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <textarea
                  className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                  rows={3}
                  placeholder="Add a reply…"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <div className="flex items-center justify-between mt-2">
                  <label className="flex items-center gap-1.5 text-[12px] text-[color:var(--text-muted)]">
                    <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                    Internal note
                  </label>
                  <button onClick={addComment} disabled={busy || !comment.trim()} className="btn-primary px-4 py-2 rounded-lg text-sm disabled:opacity-50">
                    {busy ? 'Adding…' : 'Add comment'}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
