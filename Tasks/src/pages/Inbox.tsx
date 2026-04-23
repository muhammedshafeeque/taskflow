import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { FiArrowLeft, FiInbox, FiRefreshCw, FiSearch } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationsContext';
import { inboxApi, invitationsApi, type InboxMessage } from '../lib/api';
import { formatDateDDMMYYYY, formatDateTimeDDMMYYYY, parseToLocalDate } from '../lib/dateFormat';

const VISIBLE_INBOX_TYPES = new Set([
  'project_invitation',
  'project_invitation_request',
  'project_invitation_accepted',
  'project_invite',
  'release_notes',
  'announcement',
  'permission_granted',
]);

function isVisibleInboxItem(type: string): boolean {
  return VISIBLE_INBOX_TYPES.has(type) || type.includes('invitation');
}

function getInboxTypeLabel(type: string): string {
  if (type === 'project_invitation_accepted' || type === 'invitation_accepted') return 'Invitation accepted';
  if (type.includes('invitation')) return 'Invitation';
  if (type === 'release_notes') return 'Release notes';
  if (type === 'announcement') return 'Announcement';
  if (type === 'permission_granted') return 'Permission update';
  return 'Inbox';
}

/** Gmail-style short date in the thread list. */
function formatGmailListDate(input: string | undefined): string {
  if (!input) return '';
  const d = parseToLocalDate(input);
  if (!d) return '';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfMsg.getTime()) / 864e5);
  if (dayDiff === 0) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  if (dayDiff === 1) return 'Yesterday';
  if (dayDiff < 7) {
    return d.toLocaleDateString(undefined, { weekday: 'short' });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  return formatDateDDMMYYYY(d);
}

function messageSnippet(body: string | undefined, max = 90): string {
  if (!body) return '';
  const one = body.replace(/\s+/g, ' ').trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max).trimEnd()}…`;
}

type InboxFilter = 'all' | 'unread';

function useIsCompactLayout(): boolean {
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 1024
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const onChange = () => setCompact(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return compact;
}

export default function Inbox() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { inboxVersion, markInboxItemRead, refreshInboxUnreadCount } = useNotifications();
  const isCompact = useIsCompactLayout();

  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<InboxMessage | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('all');

  const loadInbox = useCallback(() => {
    if (!token) return;
    setLoading(true);
    inboxApi
      .list(1, 50, token)
      .then((res) => {
        if (res.success && res.data) {
          const next = ((res.data as { data: InboxMessage[] }).data ?? []).filter((item) =>
            isVisibleInboxItem(item.type)
          );
          setMessages(next);
          setSelectedMessage((prev) => {
            if (!prev) return null;
            return next.find((m) => m._id === prev._id) ?? null;
          });
        }
      })
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (!token || location.pathname !== '/inbox') return;
    loadInbox();
  }, [token, inboxVersion, location.pathname, loadInbox]);

  async function markRead(id: string) {
    await markInboxItemRead(id);
    const now = new Date().toISOString();
    setMessages((prev) => prev.map((m) => (m._id === id ? { ...m, readAt: m.readAt ?? now } : m)));
    setSelectedMessage((prev) => (prev?._id === id ? { ...prev, readAt: prev.readAt ?? now } : prev));
  }

  function openMessage(m: InboxMessage) {
    setSelectedMessage(m);
    setActionError(null);
    if (!m.readAt) markRead(m._id);
  }

  function closeMessageOnMobile() {
    if (isCompact) setSelectedMessage(null);
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
      refreshInboxUnreadCount();
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
      refreshInboxUnreadCount();
    } else {
      setActionError((res as { message?: string }).message ?? 'Could not decline invitation.');
      loadInbox();
      if (selectedMessage?.meta?.invitationId === invitationId) setSelectedMessage(null);
    }
  }

  const isInvitationPending = (m: InboxMessage) =>
    m.type === 'project_invitation' && m.meta?.invitationId && m.meta?.status !== 'accepted';

  const displayMessages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = messages;
    if (inboxFilter === 'unread') {
      list = list.filter((m) => !m.readAt);
    }
    if (q) {
      list = list.filter((m) => {
        const label = getInboxTypeLabel(m.type).toLowerCase();
        const title = (m.title ?? '').toLowerCase();
        const body = (m.body ?? '').toLowerCase();
        return label.includes(q) || title.includes(q) || body.includes(q);
      });
    }
    return [...list].sort((a, b) => {
      const ta = new Date(a.createdAt ?? 0).getTime();
      const tb = new Date(b.createdAt ?? 0).getTime();
      return tb - ta;
    });
  }, [messages, searchQuery, inboxFilter]);

  const unreadCount = useMemo(() => messages.filter((m) => !m.readAt).length, [messages]);

  const showListPanel = !isCompact || !selectedMessage;
  const showReadingPanel = !isCompact || !!selectedMessage;

  return (
    <div className="flex flex-col w-full min-h-0 p-4 sm:p-6 min-h-[calc(100dvh-6.5rem)] max-h-[calc(100dvh-3rem)]">
      {/* Toolbar — Gmail-style */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 border-b border-[color:var(--border-subtle)] pb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] text-[color:var(--accent)]">
            <FiInbox className="h-[18px] w-[18px]" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-[color:var(--text-primary)] leading-tight">Inbox</h1>
            <p className="text-[11px] text-[color:var(--text-muted)] truncate">
              {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
              <span className="text-[color:var(--border-subtle)] mx-1.5">·</span>
              {messages.length} message{messages.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        <div className="flex flex-1 flex-col sm:flex-row gap-2 sm:items-center sm:justify-end min-w-0">
          <div className="relative flex-1 sm:max-w-md min-w-0">
            <FiSearch
              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[color:var(--text-muted)] pointer-events-none"
              aria-hidden
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search mail"
              className="w-full h-9 pl-8 pr-3 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] text-xs text-[color:var(--text-primary)] placeholder:text-[color:var(--text-subtle)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40 focus:border-[color:var(--accent)]"
            />
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <div
              className="inline-flex rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-0.5"
              role="group"
              aria-label="Filter"
            >
              {(['all', 'unread'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setInboxFilter(f)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition ${
                    inboxFilter === f
                      ? 'bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)] shadow-sm'
                      : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
                  }`}
                >
                  {f === 'all' ? 'All' : 'Unread'}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={loadInbox}
              disabled={loading}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)] transition disabled:opacity-50"
              title="Refresh"
              aria-label="Refresh"
            >
              <FiRefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Split: list + reading pane */}
      <div
        className="mt-3 flex-1 min-h-0 flex border border-[color:var(--border-subtle)] rounded-lg bg-[color:var(--bg-surface)] overflow-hidden shadow-sm"
        style={{ minHeight: 'min(70vh, 640px)' }}
      >
        {/* Thread list */}
        {showListPanel && (
          <div
            className={`flex flex-col min-w-0 min-h-0 border-[color:var(--border-subtle)] ${
              isCompact ? 'w-full' : 'w-[min(100%,420px)] shrink-0 border-r'
            }`}
          >
            {loading ? (
              <div className="flex-1 flex items-center justify-center p-8">
                <p className="text-xs text-[color:var(--text-muted)]">Loading…</p>
              </div>
            ) : displayMessages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                <div className="h-12 w-12 rounded-full bg-[color:var(--bg-elevated)] flex items-center justify-center text-[color:var(--text-muted)] mb-3">
                  <FiInbox className="h-6 w-6" />
                </div>
                <p className="text-sm font-medium text-[color:var(--text-primary)]">No messages</p>
                <p className="mt-1 text-xs text-[color:var(--text-muted)] max-w-[220px]">
                  {searchQuery || inboxFilter === 'unread'
                    ? 'Try another search or show all messages.'
                    : 'Invitations and updates will appear here.'}
                </p>
              </div>
            ) : (
              <ul className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden" role="listbox" aria-label="Messages">
                {displayMessages.map((m) => {
                  const unread = !m.readAt;
                  const selected = selectedMessage?._id === m._id;
                  return (
                    <li key={m._id} role="option" aria-selected={selected}>
                      <button
                        type="button"
                        onClick={() => openMessage(m)}
                        className={`w-full text-left border-b border-[color:var(--border-subtle)] pl-0 pr-2 py-2.5 min-h-[52px] flex gap-0 transition
                          ${
                            selected
                              ? 'bg-[color:var(--accent-subtle)]'
                              : 'hover:bg-[color:var(--bg-elevated)]/70'
                          }
                          ${unread && !selected ? 'bg-[color:var(--bg-elevated)]/35' : ''}
                        `}
                      >
                        <div
                          className="w-0.5 shrink-0 self-stretch rounded-r-full"
                          aria-hidden
                          style={{
                            backgroundColor: unread
                              ? 'var(--accent)'
                              : selected
                                ? 'var(--border-subtle)'
                                : 'transparent',
                          }}
                        />
                        <div className="min-w-0 flex-1 pl-2 flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
                          <div className="flex items-baseline justify-between gap-2 min-w-0 sm:contents">
                            <span
                              className={`text-[13px] shrink-0 sm:w-28 ${
                                unread ? 'font-semibold text-[color:var(--text-primary)]' : 'text-[color:var(--text-muted)]'
                              }`}
                            >
                              {getInboxTypeLabel(m.type)}
                            </span>
                            <time
                              className="text-[11px] text-[color:var(--text-muted)] tabular-nums shrink-0 sm:order-3 sm:ml-auto sm:pl-2"
                              dateTime={m.createdAt}
                            >
                              {formatGmailListDate(m.createdAt)}
                            </time>
                          </div>
                          <div className="min-w-0 sm:flex-1 sm:min-w-0 pt-0.5 sm:pt-0">
                            <span
                              className={`text-[13px] ${
                                unread ? 'text-[color:var(--text-primary)] font-semibold' : 'text-[color:var(--text-primary)]'
                              } break-words`}
                            >
                              {m.title}
                            </span>
                            {m.body && (
                              <span className="text-[13px] text-[color:var(--text-muted)] font-normal">
                                <span className="text-[color:var(--text-subtle)]"> — </span>
                                {messageSnippet(m.body)}
                              </span>
                            )}
                            {isInvitationPending(m) && (
                              <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wide text-[color:var(--accent)]">
                                Action
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Reading pane */}
        {showReadingPanel && (
          <div
            className={`flex flex-col min-w-0 min-h-0 bg-[color:var(--bg-page)]/40 ${
              isCompact ? 'w-full flex-1' : 'flex-1'
            }`}
          >
            {selectedMessage ? (
              <>
                {isCompact && (
                  <div className="shrink-0 flex items-center gap-1 border-b border-[color:var(--border-subtle)] px-2 py-1.5 bg-[color:var(--bg-surface)]">
                    <button
                      type="button"
                      onClick={closeMessageOnMobile}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)] -ml-0.5"
                      aria-label="Back to list"
                    >
                      <FiArrowLeft className="h-4 w-4" />
                    </button>
                    <span className="text-xs text-[color:var(--text-muted)]">Inbox</span>
                  </div>
                )}
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <div className="p-4 sm:p-5 max-w-3xl">
                    {actionError && (
                      <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                        {actionError}
                      </div>
                    )}

                    <div className="border-b border-[color:var(--border-subtle)] pb-4 mb-4">
                      <h2 className="text-lg sm:text-xl font-normal text-[color:var(--text-primary)] leading-snug pr-2">
                        {selectedMessage.title}
                      </h2>
                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--text-muted)]">
                        <span>
                          <span className="text-[color:var(--text-subtle)]">From </span>
                          <span className="text-[color:var(--text-primary)]">{getInboxTypeLabel(selectedMessage.type)}</span>
                        </span>
                        <span className="text-[color:var(--border-subtle)]" aria-hidden>
                          |
                        </span>
                        <time dateTime={selectedMessage.createdAt}>
                          {selectedMessage.createdAt ? formatDateTimeDDMMYYYY(selectedMessage.createdAt) : '—'}
                        </time>
                        {!selectedMessage.readAt && (
                          <>
                            <span className="text-[color:var(--border-subtle)]" aria-hidden>
                              |
                            </span>
                            <span className="text-[color:var(--accent)] font-medium">Unread</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="text-[color:var(--text-primary)] text-sm whitespace-pre-wrap leading-[1.65]">
                      {selectedMessage.body || '—'}
                    </div>

                    {selectedMessage.type === 'release_notes' && (selectedMessage.meta as { projectId?: string })?.projectId && (
                      <div className="mt-6 pt-4 border-t border-[color:var(--border-subtle)]">
                        <Link
                          to={`/projects/${(selectedMessage.meta as { projectId: string }).projectId}/versions`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-elevated)] transition"
                        >
                          View release notes
                        </Link>
                      </div>
                    )}

                    {selectedMessage.type === 'project_invitation' && selectedMessage.meta?.invitationId && (
                      <div className="mt-6 pt-4 border-t border-[color:var(--border-subtle)]">
                        {selectedMessage.meta?.status === 'accepted' ? (
                          <p className="text-[color:var(--accent)] text-sm">You accepted this invitation.</p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => acceptInvitation(selectedMessage.meta!.invitationId!)}
                              disabled={actionId === selectedMessage.meta?.invitationId}
                              className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] text-xs text-[color:var(--text-primary)] font-medium hover:brightness-110 disabled:opacity-50 transition"
                            >
                              {actionId === selectedMessage.meta?.invitationId ? 'Accepting…' : 'Accept'}
                            </button>
                            <button
                              type="button"
                              onClick={() => declineInvitation(selectedMessage.meta!.invitationId!)}
                              disabled={actionId === selectedMessage.meta?.invitationId}
                              className="px-3 py-1.5 rounded-md text-xs text-[color:var(--text-muted)] font-medium hover:text-[color:var(--text-primary)] disabled:opacity-50 transition"
                            >
                              {actionId === selectedMessage.meta?.invitationId ? 'Declining…' : 'Decline'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {!selectedMessage.readAt && selectedMessage.type !== 'project_invitation' && (
                      <div className="mt-6">
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
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center min-h-[200px]">
                <div className="h-14 w-14 rounded-2xl bg-[color:var(--bg-elevated)]/80 border border-[color:var(--border-subtle)] flex items-center justify-center text-[color:var(--text-muted)] mb-3">
                  <FiInbox className="h-7 w-7" />
                </div>
                <p className="text-sm text-[color:var(--text-primary)]">Select a message to read</p>
                <p className="mt-1 text-xs text-[color:var(--text-muted)] max-w-xs">
                  Pick an item from the list. Unread messages appear in bold.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
