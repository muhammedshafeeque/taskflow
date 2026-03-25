import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationsContext';
import { inboxApi, invitationsApi, type InboxMessage } from '../lib/api';

export default function Inbox() {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { inboxVersion } = useNotifications();
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<InboxMessage | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function loadInbox() {
    if (!token) return;
    setLoading(true);
    inboxApi
      .list(1, 50, token)
      .then((res) => {
        if (res.success && res.data) setMessages(((res.data as { data: InboxMessage[] }).data) ?? []);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!token || location.pathname !== '/inbox') return;
    loadInbox();
  }, [token, inboxVersion, location.pathname]);

  async function markRead(id: string) {
    if (!token) return;
    const res = await inboxApi.markRead(id, token);
    if (res.success && res.data)
      setMessages((prev) =>
        prev.map((m) => (m._id === id ? { ...m, readAt: (res.data as InboxMessage).readAt ?? new Date().toISOString() } : m))
      );
  }

  function openMessage(m: InboxMessage) {
    setSelectedMessage(m);
    setActionError(null);
    if (!m.readAt) markRead(m._id);
  }

  async function acceptInvitation(invitationId: string) {
    if (!token) return;
    setActionError(null);
    setActionId(invitationId);
    const res = await invitationsApi.accept(invitationId, token);
    setActionId(null);
    if (res.success && res.data && (res.data as { projectId?: string }).projectId) {
      const projectId = (res.data as { projectId: string }).projectId;
      setMessages((prev) =>
        prev.map((m) =>
          m.type === 'project_invitation' && m.meta?.invitationId === invitationId
            ? { ...m, meta: { ...m.meta, invitationId: m.meta.invitationId, status: 'accepted' } }
            : m
        )
      );
      setSelectedMessage((prev) =>
        prev?.meta?.invitationId === invitationId
          ? { ...prev, meta: { ...prev.meta, invitationId: prev.meta?.invitationId, status: 'accepted' as const } }
          : prev
      );
      setSelectedMessage(null);
      navigate(`/projects/${projectId}/dashboard`);
    } else {
      setActionError((res as { message?: string }).message ?? 'Could not accept invitation.');
      loadInbox();
      setSelectedMessage(null);
    }
  }

  async function declineInvitation(invitationId: string) {
    if (!token) return;
    setActionError(null);
    setActionId(invitationId);
    const res = await invitationsApi.decline(invitationId, token);
    setActionId(null);
    if (res.success) {
      setMessages((prev) => prev.filter((m) => !(m.type === 'project_invitation' && m.meta?.invitationId === invitationId)));
      if (selectedMessage?.meta?.invitationId === invitationId) setSelectedMessage(null);
    } else {
      setActionError((res as { message?: string }).message ?? 'Could not decline invitation.');
      loadInbox();
      if (selectedMessage?.meta?.invitationId === invitationId) setSelectedMessage(null);
    }
  }

  const isInvitationPending = (m: InboxMessage) =>
    m.type === 'project_invitation' && m.meta?.invitationId && m.meta?.status !== 'accepted';

  const mustChange = user?.mustChangePassword ?? false;

  return (
    <div className="p-4 sm:p-6 w-full">
      <h1 className="text-base font-semibold text-[color:var(--text-primary)] mb-4">Inbox</h1>
      {mustChange && (
        <div className="mb-4 p-3 rounded-lg bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] text-xs leading-relaxed">
          <strong className="text-[color:var(--text-primary)]">Welcome to TaskFlow.</strong>{' '}
          Please change your password from your profile or use Forgot password after signing out.
        </div>
      )}
      {loading ? (
        <p className="text-[color:var(--text-muted)] text-xs">Loading…</p>
      ) : messages.length === 0 ? (
        <p className="text-[color:var(--text-muted)] text-xs">No messages.</p>
      ) : (
        <div className="flex flex-col lg:flex-row gap-6 w-full">
          <ul className="w-full lg:w-[42%] min-w-0 space-y-2">
            {messages.map((m) => (
              <li
                key={m._id}
                role="button"
                tabIndex={0}
                onClick={() => openMessage(m)}
                onKeyDown={(e) => e.key === 'Enter' && openMessage(m)}
                className={`p-3 rounded-lg border cursor-pointer transition text-xs ${
                  selectedMessage?._id === m._id
                    ? 'bg-[color:var(--bg-elevated)] border-[color:var(--border-subtle)] ring-1 ring-[color:var(--border-subtle)]'
                    : m.readAt
                      ? 'bg-[color:var(--bg-surface)] border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-elevated)]'
                      : 'bg-[color:var(--bg-elevated)] border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-elevated)]'
                }`}
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-[color:var(--text-primary)] truncate text-sm">{m.title}</h3>
                    {m.body && (
                      <p className="mt-0.5 text-[color:var(--text-muted)] text-xs line-clamp-1">
                        {m.body}
                      </p>
                    )}
                    <p className="mt-1 text-[color:var(--text-muted)] text-[11px]">
                      {m.createdAt ? new Date(m.createdAt).toLocaleString() : ''}
                    </p>
                  </div>
                  {isInvitationPending(m) && (
                    <span className="shrink-0 text-[11px] text-[color:var(--text-muted)] font-medium">
                      Pending
                    </span>
                  )}
                  {m.type === 'project_invitation' && m.meta?.invitationId && m.meta?.status === 'accepted' && (
                    <span className="shrink-0 text-[11px] text-[color:var(--accent)] font-medium">
                      Accepted
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {selectedMessage && (
            <div className="w-full lg:flex-1 min-w-0 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden flex flex-col lg:sticky lg:top-6 max-h-[calc(100vh-12rem)]">
              <div className="p-3 border-b border-[color:var(--border-subtle)] flex items-center justify-between shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedMessage(null)}
                  className="text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] text-xs font-medium"
                >
                  ← Back
                </button>
              </div>
              <div className="p-4 overflow-y-auto flex-1 min-h-0">
                {actionError && (
                  <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                    {actionError}
                  </div>
                )}
                <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">
                  {selectedMessage.title}
                </h2>
                <p className="mt-1 text-[color:var(--text-muted)] text-xs">
                  {selectedMessage.createdAt ? new Date(selectedMessage.createdAt).toLocaleString() : ''}
                </p>
                <div className="mt-3 text-[color:var(--text-primary)] text-xs whitespace-pre-wrap leading-relaxed">
                  {selectedMessage.body || '—'}
                </div>
                {selectedMessage.type === 'release_notes' && (selectedMessage.meta as { projectId?: string })?.projectId && (
                  <div className="mt-4 pt-4 border-t border-[color:var(--border-subtle)]">
                    <Link
                      to={`/projects/${(selectedMessage.meta as { projectId: string }).projectId}/versions`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)] transition"
                    >
                      View release notes →
                    </Link>
                  </div>
                )}
                {selectedMessage.type === 'project_invitation' && selectedMessage.meta?.invitationId && (
                  <div className="mt-4 pt-4 border-t border-[color:var(--border-subtle)]">
                    {selectedMessage.meta?.status === 'accepted' ? (
                      <p className="text-[color:var(--accent)] text-xs font-medium">
                        You accepted this invitation.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2 mt-2">
                        <button
                          type="button"
                          onClick={() => acceptInvitation(selectedMessage.meta!.invitationId!)}
                          disabled={actionId === selectedMessage.meta?.invitationId}
                          className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)] disabled:opacity-50 transition"
                        >
                          {actionId === selectedMessage.meta?.invitationId ? 'Accepting…' : 'Accept'}
                        </button>
                        <button
                          type="button"
                          onClick={() => declineInvitation(selectedMessage.meta!.invitationId!)}
                          disabled={actionId === selectedMessage.meta?.invitationId}
                          className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] text-xs text-[color:var(--text-muted)] font-medium hover:text-[color:var(--text-primary)] disabled:opacity-50 transition"
                        >
                          {actionId === selectedMessage.meta?.invitationId ? 'Declining…' : 'Decline'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {!selectedMessage.readAt && selectedMessage.type !== 'project_invitation' && (
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => markRead(selectedMessage._id)}
                      className="text-[color:var(--accent)] hover:underline text-xs font-medium"
                    >
                      Mark as read
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
