import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { api, serviceApi, type ServiceTicket, type User } from '../../lib/api';
import { StatusPill } from '../../components/moduleKit';
import { TicketReplySuggest } from '../../components/ai/AiPanels';
import { ModuleLoader } from '../../components/loaders/ModuleLoader';
import { PersonSelect, toPeople } from '../../components/people';

const PRIORITY_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'slate'> = {
  urgent: 'red', high: 'amber', medium: 'blue', low: 'slate',
};
const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'slate' | 'violet'> = {
  open: 'blue', pending: 'amber', in_progress: 'violet', resolved: 'green', closed: 'slate',
};

const QUEUES = ['portal', 'general', 'billing', 'dev', 'email'] as const;

function assigneeName(a: ServiceTicket['assigneeId']): string | undefined {
  return a && typeof a === 'object' ? a.name : undefined;
}

function assigneeIdOf(a: ServiceTicket['assigneeId']): string {
  if (!a) return '';
  return typeof a === 'object' ? a._id : a;
}

function issueLabel(ticket: ServiceTicket): string | undefined {
  const li = ticket.linkedIssueId;
  if (!li) return undefined;
  if (typeof li === 'object') return li.key || li.title || li._id;
  return li;
}

export default function ServiceDesk() {
  const { token } = useAuth();
  const [tickets, setTickets] = useState<ServiceTicket[]>([]);
  const [subject, setSubject] = useState('');
  const [queue, setQueue] = useState('general');
  const [priority, setPriority] = useState('medium');
  const [statusFilter, setStatusFilter] = useState('');
  const [queueFilter, setQueueFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const q = searchParams.get('ticket');
    if (q) setSelectedId(q);
  }, [searchParams]);

  const load = () => {
    if (!token) return;
    const params: { status?: string; queue?: string } = {};
    if (statusFilter) params.status = statusFilter;
    if (queueFilter) params.queue = queueFilter;
    serviceApi.listTickets(token, Object.keys(params).length ? params : undefined).then((res) => {
      if (res.success && res.data) setTickets(res.data as ServiceTicket[]);
    });
  };

  useEffect(() => { load(); }, [token, statusFilter, queueFilter]);

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
      <h1 className="text-xl font-semibold mb-1">Service desk</h1>
      <p className="text-sm text-[color:var(--text-muted)] mb-4">
        All ticket operations live here, including tickets created from customer portal approval.
      </p>
      <div className="flex flex-wrap gap-2 mb-6">
        <input
          className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm flex-1 min-w-[200px]"
          placeholder="New walk-in ticket subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
        />
        <select className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm" value={queue} onChange={(e) => setQueue(e.target.value)}>
          {QUEUES.map((q) => (
            <option key={q} value={q}>{q.charAt(0).toUpperCase() + q.slice(1)}</option>
          ))}
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

      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {['', 'open', 'in_progress', 'pending', 'resolved', 'closed'].map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`px-2.5 py-1 rounded-full border capitalize transition ${statusFilter === s ? 'border-[color:var(--accent)] text-[color:var(--accent)]' : 'border-[color:var(--border-subtle)] text-[color:var(--text-muted)]'}`}
          >
            {s ? s.replace('_', ' ') : 'All status'}
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {['', ...QUEUES].map((q) => (
          <button
            key={q || 'allq'}
            type="button"
            onClick={() => setQueueFilter(q)}
            className={`px-2.5 py-1 rounded-full border capitalize transition ${queueFilter === q ? 'border-[color:var(--accent)] text-[color:var(--accent)]' : 'border-[color:var(--border-subtle)] text-[color:var(--text-muted)]'}`}
          >
            {q || 'All queues'}
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
                {t.workClassification === 'billable_change' && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400">Billable change</span>
                )}
                {t.workClassification === 'fix' && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">Fix</span>
                )}
                {t.customerRequestId && <span className="text-[11px] text-[color:var(--text-muted)]">Portal</span>}
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
                <button type="button" onClick={() => updateStatus(t._id, 'closed')} className="text-xs text-amber-400" title="Closing sends the satisfaction survey if CSAT is enabled in Service settings">Close</button>
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
          others={tickets.filter((x) => x._id !== selectedId && x.status !== 'closed')}
        />
      )}
    </div>
  );
}

function TicketDetail({ id, onClose, onChanged, others }: { id: string; onClose: () => void; onChanged: () => void; others: ServiceTicket[] }) {
  const { token } = useAuth();
  const [ticket, setTicket] = useState<ServiceTicket | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [comment, setComment] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedReplies, setSavedReplies] = useState<{ _id: string; title: string; body: string }[]>([]);
  const [mergeInto, setMergeInto] = useState('');

  useEffect(() => {
    if (!token) return;
    api.get<{ _id: string; title: string; body: string }[]>('/service/saved-replies', token).then((r) => setSavedReplies(Array.isArray(r.data) ? r.data : []));
  }, [token]);

  const merge = async () => {
    if (!token || !mergeInto || !confirm('Merge this ticket into the selected one? This ticket will be closed.')) return;
    const r = await api.post(`/service/tickets/${id}/merge`, { intoId: mergeInto }, token);
    if (!r.success) return alert(r.message);
    onChanged();
    onClose();
  };

  const reload = () => {
    if (!token) return;
    serviceApi.getTicket(id, token).then((r) => { if (r.success && r.data) setTicket(r.data as ServiceTicket); });
  };
  useEffect(reload, [id, token]);

  useEffect(() => {
    if (!token) return;
    // Workspace members (no user-admin permission needed to assign tickets).
    api.get<User[]>('/core/people', token).then((res) => {
      if (res.success && Array.isArray(res.data)) setUsers(res.data);
    });
  }, [token]);

  const addComment = async () => {
    if (!token || !comment.trim()) return;
    setBusy(true);
    const r = await serviceApi.addComment(id, { body: comment.trim(), internal }, token);
    setBusy(false);
    if (r.success && r.data) { setTicket(r.data as ServiceTicket); setComment(''); onChanged(); }
  };

  const patch = async (data: Partial<ServiceTicket>) => {
    if (!token) return;
    await serviceApi.updateTicket(id, data, token);
    reload();
    onChanged();
  };

  const issue = issueLabel(ticket ?? { _id: '', subject: '', status: '', priority: '', queue: '' });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="w-full max-w-lg h-full overflow-y-auto bg-[color:var(--bg-surface)] border-l border-[color:var(--border-subtle)] p-6 animate-fade-in" onClick={(e) => e.stopPropagation()}>
        {!ticket ? (
          <ModuleLoader size="block" label="Loading ticket…" />
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold">{ticket.subject}</h2>
              <button type="button" onClick={onClose} className="text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]">✕</button>
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <StatusPill label={ticket.status} tone={STATUS_TONE[ticket.status]} />
              <StatusPill label={ticket.priority} tone={PRIORITY_TONE[ticket.priority]} />
              {ticket.workClassification === 'billable_change' && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400">Billable change</span>
              )}
              {ticket.workClassification === 'fix' && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">Fix</span>
              )}
              <span className="text-[11px] text-[color:var(--text-muted)]">{ticket.queue}</span>
              {others.length > 0 && ticket.status !== 'closed' && (
                <span className="ml-auto flex items-center gap-1 text-[11px]">
                  <select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} className="rounded border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-1 py-0.5 max-w-[12rem]">
                    <option value="">Merge into…</option>
                    {others.map((o) => (
                      <option key={o._id} value={o._id}>{o.subject}</option>
                    ))}
                  </select>
                  {mergeInto && <button type="button" onClick={merge} className="text-[color:var(--accent)]">Merge</button>}
                </span>
              )}
            </div>
            {ticket.description && <p className="mt-3 text-sm text-[color:var(--text-muted)] whitespace-pre-wrap">{ticket.description}</p>}

            <div className="mt-4 grid grid-cols-2 gap-2 text-[12px]">
              {ticket.accountId && typeof ticket.accountId === 'object' && (
                <div><span className="text-[color:var(--text-muted)]">Account</span><p className="font-medium">{ticket.accountId.name}</p></div>
              )}
              {ticket.contractId && typeof ticket.contractId === 'object' && (
                <div><span className="text-[color:var(--text-muted)]">Contract</span><p className="font-medium">{ticket.contractId.title}</p></div>
              )}
              {ticket.customerRequestId && (
                <div className="col-span-2">
                  <span className="text-[color:var(--text-muted)]">Portal request</span>
                  <p className="font-mono text-[11px] break-all">{String(ticket.customerRequestId)}</p>
                  <Link to="/admin/customer-requests" className="text-[color:var(--accent)] text-xs hover:underline">Approval queue</Link>
                </div>
              )}
              {ticket.accountId && typeof ticket.accountId === 'object' && (
                <div>
                  <span className="text-[color:var(--text-muted)]">CRM account</span>
                  <p>
                    <Link to={`/crm/accounts/${ticket.accountId._id}`} className="text-[color:var(--accent)] hover:underline">
                      {ticket.accountId.name}
                    </Link>
                  </p>
                </div>
              )}
              {ticket.projectId && typeof ticket.projectId === 'object' && (
                <div>
                  <span className="text-[color:var(--text-muted)]">Project</span>
                  <p>
                    <Link to={`/projects/${ticket.projectId._id}/dashboard`} className="text-[color:var(--accent)] hover:underline">
                      {ticket.projectId.key ?? ticket.projectId.name}
                    </Link>
                  </p>
                </div>
              )}
              {issue && (
                <div className="col-span-2">
                  <span className="text-[color:var(--text-muted)]">Project issue</span>
                  <p className="font-medium">{issue}</p>
                </div>
              )}
              {ticket.resolutionDueAt && (
                <div><span className="text-[color:var(--text-muted)]">Resolution due</span><p className={`font-medium ${new Date(ticket.resolutionDueAt) < new Date() && !ticket.resolvedAt ? 'text-rose-500' : ''}`}>{new Date(ticket.resolutionDueAt).toLocaleString()}</p></div>
              )}
              {ticket.firstResponseDueAt && (
                <div><span className="text-[color:var(--text-muted)]">First response due</span><p className="font-medium">{new Date(ticket.firstResponseDueAt).toLocaleString()}</p></div>
              )}
            </div>

            <div className="mt-4 space-y-2 text-sm">
              <label className="block text-[12px] text-[color:var(--text-muted)]">Status</label>
              <select
                className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2"
                value={ticket.status}
                onChange={(e) => patch({ status: e.target.value })}
              >
                {['open', 'pending', 'in_progress', 'resolved', 'closed'].map((s) => (
                  <option key={s} value={s}>{s.replace('_', ' ')}</option>
                ))}
              </select>
              <label className="block text-[12px] text-[color:var(--text-muted)]">Priority</label>
              <select
                className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2"
                value={ticket.priority}
                onChange={(e) => patch({ priority: e.target.value })}
              >
                {['low', 'medium', 'high', 'urgent'].map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <label className="block text-[12px] text-[color:var(--text-muted)]">Queue</label>
              <select
                className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2"
                value={ticket.queue}
                onChange={(e) => patch({ queue: e.target.value })}
              >
                {QUEUES.map((q) => (
                  <option key={q} value={q}>{q}</option>
                ))}
              </select>
              <label className="block text-[12px] text-[color:var(--text-muted)]">Assignee</label>
              <PersonSelect
                value={assigneeIdOf(ticket.assigneeId)}
                onChange={(v) => patch({ assigneeId: (v || '') as ServiceTicket['assigneeId'] })}
                people={toPeople(users.filter((u) => u.enabled !== false))}
                specialOptions={[{ value: '', label: 'Unassigned' }]}
                clearValue=""
                aria-label="Assignee"
              />
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
                        {c.internal ? 'Internal · ' : 'Public · '}{new Date(c.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-[13px] mt-1 whitespace-pre-wrap">{c.body}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                {token && (
                  <div className="mb-2">
                    <TicketReplySuggest key={id} ticketId={id} token={token} onUse={(text) => { setInternal(false); setComment(text); }} />
                  </div>
                )}
                {savedReplies.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      const r = savedReplies.find((x) => x._id === e.target.value);
                      if (r) setComment((c) => (c ? `${c}\n\n${r.body}` : r.body));
                    }}
                    className="mb-2 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-2 py-1 text-xs"
                  >
                    <option value="">Insert saved reply…</option>
                    {savedReplies.map((r) => (
                      <option key={r._id} value={r._id}>{r.title}</option>
                    ))}
                  </select>
                )}
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
                  <button type="button" onClick={addComment} disabled={busy || !comment.trim()} className="btn-primary px-4 py-2 rounded-lg text-sm disabled:opacity-50">
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
