import { useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  notificationsApi,
  type NotificationMethod,
  type NotificationPreferenceRow,
  type NotificationEventDescriptor,
  type NotificationMethodAvailability,
} from '../lib/api';

const METHOD_COLUMNS: Array<{ key: NotificationMethod; label: string; short: string }> = [
  { key: 'in_app', label: 'In-app', short: 'App' },
  { key: 'push', label: 'Push', short: 'Push' },
  { key: 'email', label: 'Email', short: 'Email' },
  { key: 'sms', label: 'SMS', short: 'SMS' },
  { key: 'whatsapp', label: 'WhatsApp', short: 'WA' },
  { key: 'discord', label: 'Discord', short: 'DC' },
  { key: 'teams', label: 'Teams', short: 'Teams' },
  { key: 'telegram', label: 'Telegram', short: 'TG' },
  { key: 'slack', label: 'Slack', short: 'Slack' },
];

type EventGroupId =
  | 'tasks'
  | 'project'
  | 'sprint_release'
  | 'milestone'
  | 'approvals'
  | 'watchers'
  | 'qa'
  | 'time'
  | 'crm'
  | 'documents'
  | 'workspace'
  | 'system';

const EVENT_GROUPS: Array<{ id: EventGroupId; label: string; match: (key: string) => boolean }> = [
  { id: 'tasks', label: 'Tasks', match: (k) => k.startsWith('task_') },
  { id: 'project', label: 'Project', match: (k) => k.startsWith('project_') },
  {
    id: 'sprint_release',
    label: 'Sprint & release',
    match: (k) => k.startsWith('sprint_') || k.startsWith('release_'),
  },
  { id: 'milestone', label: 'Milestones', match: (k) => k.startsWith('milestone_') },
  { id: 'approvals', label: 'Approvals', match: (k) => k.startsWith('approval_') },
  { id: 'watchers', label: 'Watchers', match: (k) => k.startsWith('watch_') },
  { id: 'qa', label: 'QA', match: (k) => k.startsWith('qa_') },
  { id: 'time', label: 'Time', match: (k) => k.startsWith('timesheet_') },
  { id: 'crm', label: 'CRM', match: (k) => k.startsWith('crm_') },
  { id: 'documents', label: 'Documents', match: (k) => k.startsWith('document_') },
  { id: 'workspace', label: 'Workspace', match: (k) => k.startsWith('workspace_') },
  { id: 'system', label: 'System', match: () => true },
];

function groupForEvent(key: string): EventGroupId {
  for (const g of EVENT_GROUPS) {
    if (g.id === 'system') continue;
    if (g.match(key)) return g.id;
  }
  return 'system';
}

function ColumnSelectAll({
  checked,
  indeterminate,
  disabled,
  title,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  title: string;
  onChange: (value: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      title={title}
      aria-label={title}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 accent-[color:var(--accent)] disabled:opacity-40"
    />
  );
}

function matricesEqual(a: NotificationPreferenceRow[], b: NotificationPreferenceRow[]): boolean {
  if (a.length !== b.length) return false;
  const mapB = new Map(b.map((r) => [r.eventKey, r]));
  for (const row of a) {
    const other = mapB.get(row.eventKey);
    if (!other) return false;
    for (const m of METHOD_COLUMNS) {
      if (Boolean(row.methods[m.key]) !== Boolean(other.methods[m.key])) return false;
    }
  }
  return true;
}

export default function NotificationPreferences() {
  const { token } = useAuth();
  const [notificationEvents, setNotificationEvents] = useState<NotificationEventDescriptor[]>([]);
  const [notificationMatrix, setNotificationMatrix] = useState<NotificationPreferenceRow[]>([]);
  const [notificationDraft, setNotificationDraft] = useState<NotificationPreferenceRow[]>([]);
  const [availableMethods, setAvailableMethods] = useState<NotificationMethodAvailability>({
    in_app: { enabled: true },
    push: { enabled: false },
    email: { enabled: false },
    sms: { enabled: false },
    whatsapp: { enabled: false },
    discord: { enabled: false },
    teams: { enabled: false },
    telegram: { enabled: false },
    slack: { enabled: false },
  });
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<EventGroupId | 'all'>('all');
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const [notificationSuccess, setNotificationSuccess] = useState(false);

  useEffect(() => {
    if (!token) return;
    setNotificationLoading(true);
    notificationsApi.getPreferences(token).then((res) => {
      setNotificationLoading(false);
      if (res.success && res.data) {
        setAvailableMethods(res.data.availableMethods);
        setNotificationEvents(res.data.events);
        setNotificationMatrix(res.data.matrix);
        setNotificationDraft(res.data.matrix);
      } else {
        setNotificationError((res as { message?: string }).message ?? 'Failed to load notification preferences');
      }
    });
  }, [token]);

  useEffect(() => {
    if (!notificationSuccess) return;
    const t = window.setTimeout(() => setNotificationSuccess(false), 2800);
    return () => window.clearTimeout(t);
  }, [notificationSuccess]);

  const dirty = useMemo(
    () => !matricesEqual(notificationDraft, notificationMatrix),
    [notificationDraft, notificationMatrix]
  );

  const enabledChannelCount = useMemo(
    () => METHOD_COLUMNS.filter((m) => availableMethods[m.key]?.enabled).length,
    [availableMethods]
  );

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notificationEvents.filter((e) => {
      if (groupFilter !== 'all' && groupForEvent(e.key) !== groupFilter) return false;
      if (!q) return true;
      return (
        e.label.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.key.toLowerCase().includes(q)
      );
    });
  }, [notificationEvents, search, groupFilter]);

  const groupedFiltered = useMemo(() => {
    const byGroup = new Map<EventGroupId, NotificationEventDescriptor[]>();
    for (const g of EVENT_GROUPS) byGroup.set(g.id, []);
    for (const event of filteredEvents) {
      const id = groupForEvent(event.key);
      byGroup.get(id)!.push(event);
    }
    return EVENT_GROUPS.map((g) => ({
      id: g.id,
      label: g.label,
      events: byGroup.get(g.id) ?? [],
    })).filter((g) => g.events.length > 0);
  }, [filteredEvents]);

  const draftByKey = useMemo(() => {
    const map = new Map<string, NotificationPreferenceRow>();
    for (const row of notificationDraft) map.set(row.eventKey, row);
    return map;
  }, [notificationDraft]);

  const groupCounts = useMemo(() => {
    const counts = new Map<EventGroupId | 'all', number>();
    counts.set('all', notificationEvents.length);
    for (const g of EVENT_GROUPS) counts.set(g.id, 0);
    for (const e of notificationEvents) {
      const id = groupForEvent(e.key);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [notificationEvents]);

  function columnSelectState(method: NotificationMethod): {
    checked: boolean;
    indeterminate: boolean;
  } {
    const available = availableMethods[method]?.enabled ?? false;
    if (!available || filteredEvents.length === 0) return { checked: false, indeterminate: false };
    let on = 0;
    for (const event of filteredEvents) {
      const row = draftByKey.get(event.key);
      if (row?.methods[method]) on += 1;
    }
    if (on === 0) return { checked: false, indeterminate: false };
    if (on === filteredEvents.length) return { checked: true, indeterminate: false };
    return { checked: false, indeterminate: true };
  }

  function toggleColumn(method: NotificationMethod, value: boolean) {
    if (!(availableMethods[method]?.enabled ?? false)) return;
    const keys = new Set(filteredEvents.map((e) => e.key));
    setNotificationDraft((prev) =>
      prev.map((row) =>
        keys.has(row.eventKey) ? { ...row, methods: { ...row.methods, [method]: value } } : row
      )
    );
  }

  function updateNotificationCell(eventKey: string, method: NotificationMethod, value: boolean) {
    setNotificationDraft((prev) =>
      prev.map((row) => (row.eventKey === eventKey ? { ...row, methods: { ...row.methods, [method]: value } } : row))
    );
  }

  function resetNotificationDraft() {
    setNotificationDraft(notificationMatrix);
    setNotificationError('');
    setNotificationSuccess(false);
  }

  async function saveNotificationPreferences() {
    if (!token) return;
    setNotificationSaving(true);
    setNotificationError('');
    setNotificationSuccess(false);
    const res = await notificationsApi.updatePreferences(
      notificationDraft.map((row) => ({ eventKey: row.eventKey, methods: row.methods })),
      token
    );
    setNotificationSaving(false);
    if (!res.success || !res.data) {
      setNotificationError((res as { message?: string }).message ?? 'Failed to save notification preferences');
      return;
    }
    setAvailableMethods(res.data.availableMethods);
    setNotificationEvents(res.data.events);
    setNotificationMatrix(res.data.matrix);
    setNotificationDraft(res.data.matrix);
    setNotificationSuccess(true);
  }

  return (
    <div className="w-full max-w-[96rem] mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 pb-28 space-y-5">
      {/* Centered success toast */}
      {notificationSuccess && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 pointer-events-none">
          <div
            role="status"
            className="pointer-events-auto rounded-2xl border border-emerald-500/30 bg-[color:var(--bg-elevated)] px-8 py-6 shadow-2xl text-center max-w-sm w-full animate-fade-in"
          >
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400 text-xl font-semibold">
              ✓
            </div>
            <p className="text-base font-semibold text-[color:var(--text-primary)]">Preferences saved</p>
            <p className="mt-1 text-sm text-[color:var(--text-muted)]">
              Your notification channels were updated successfully.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--text-primary)]">
            Notification preferences
          </h1>
          <p className="mt-1 text-[13px] text-[color:var(--text-muted)] max-w-2xl">
            Choose how you want to be notified for each event. Channels are enabled on the server (SMTP, ByteMail,
            Graph, SendGrid, push, Slack, etc.).
          </p>
        </div>
        <Link
          to="/profile"
          className="text-sm text-[color:var(--accent)] hover:underline shrink-0 h-9 inline-flex items-center"
        >
          ← Back to profile
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-2.5 py-1 text-[11px] text-[color:var(--text-muted)]">
          {notificationEvents.length} events
        </span>
        <span className="rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-2.5 py-1 text-[11px] text-[color:var(--text-muted)]">
          {enabledChannelCount} channels available
        </span>
        {dirty && (
          <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-300">
            Unsaved changes
          </span>
        )}
      </div>

      <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/35 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {METHOD_COLUMNS.map((m) => {
              const on = availableMethods[m.key]?.enabled;
              return (
                <span
                  key={m.key}
                  title={on ? `${m.label} available` : availableMethods[m.key]?.reason ?? `${m.label} unavailable`}
                  className={
                    on
                      ? 'inline-flex items-center rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400'
                      : 'inline-flex items-center rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-2 py-0.5 text-[11px] text-[color:var(--text-muted)] opacity-70'
                  }
                >
                  {m.label}
                </span>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notifications…"
              className="h-9 w-full max-w-md rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 text-sm text-[color:var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/30"
            />
            <span className="text-[12px] text-[color:var(--text-muted)]">
              Showing {filteredEvents.length} of {notificationEvents.length}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setGroupFilter('all')}
              className={
                groupFilter === 'all'
                  ? 'h-7 px-2.5 rounded-md text-[11px] font-medium btn-primary'
                  : 'h-7 px-2.5 rounded-md text-[11px] border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)]'
              }
            >
              All ({groupCounts.get('all') ?? 0})
            </button>
            {EVENT_GROUPS.filter((g) => (groupCounts.get(g.id) ?? 0) > 0).map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGroupFilter(g.id)}
                className={
                  groupFilter === g.id
                    ? 'h-7 px-2.5 rounded-md text-[11px] font-medium btn-primary'
                    : 'h-7 px-2.5 rounded-md text-[11px] border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)]'
                }
              >
                {g.label} ({groupCounts.get(g.id) ?? 0})
              </button>
            ))}
          </div>
        </div>

        {notificationError && (
          <div className="mx-4 sm:mx-5 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {notificationError}
          </div>
        )}

        {notificationLoading ? (
          <p className="p-8 text-sm text-[color:var(--text-muted)]">Loading notification preferences…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1280px] text-sm">
              <thead className="sticky top-0 z-10 bg-[color:var(--bg-page)]">
                <tr className="border-b border-[color:var(--border-subtle)]">
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                    Notification
                  </th>
                  {METHOD_COLUMNS.map((method) => {
                    const available = availableMethods[method.key]?.enabled ?? false;
                    const { checked, indeterminate } = columnSelectState(method.key);
                    const reason = availableMethods[method.key]?.reason;
                    return (
                      <th
                        key={method.key}
                        className="text-center px-2 py-3 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)] whitespace-nowrap"
                      >
                        <div className="flex flex-col items-center gap-1.5">
                          <span title={method.label}>{method.short}</span>
                          <ColumnSelectAll
                            checked={checked}
                            indeterminate={indeterminate}
                            disabled={!available || filteredEvents.length === 0}
                            title={
                              !available
                                ? reason ?? 'Method unavailable'
                                : `Select all ${method.label} for visible events`
                            }
                            onChange={(value) => toggleColumn(method.key, value)}
                          />
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {groupedFiltered.map((group) => (
                  <Fragment key={group.id}>
                    <tr className="bg-[color:var(--bg-page)]/70">
                      <td
                        colSpan={1 + METHOD_COLUMNS.length}
                        className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]"
                      >
                        {group.label}
                        <span className="ml-2 font-normal normal-case tracking-normal opacity-70">
                          {group.events.length}
                        </span>
                      </td>
                    </tr>
                    {group.events.map((event) => {
                      const row = draftByKey.get(event.key);
                      if (!row) return null;
                      return (
                        <tr
                          key={event.key}
                          className="border-t border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-page)]/40"
                        >
                          <td className="px-4 py-2.5 align-middle min-w-[220px]">
                            <div className="text-[color:var(--text-primary)] font-medium leading-snug">
                              {event.label}
                            </div>
                            <div className="text-[11px] text-[color:var(--text-muted)] mt-0.5 leading-snug">
                              {event.description}
                            </div>
                          </td>
                          {METHOD_COLUMNS.map((method) => {
                            const available = availableMethods[method.key]?.enabled ?? false;
                            return (
                              <td key={method.key} className="px-2 py-2.5 text-center align-middle">
                                <input
                                  type="checkbox"
                                  checked={Boolean(row.methods[method.key])}
                                  disabled={!available}
                                  title={
                                    !available
                                      ? availableMethods[method.key]?.reason ?? 'Method unavailable'
                                      : `${method.label}: ${event.label}`
                                  }
                                  onChange={(e) =>
                                    updateNotificationCell(event.key, method.key, e.target.checked)
                                  }
                                  className="h-4 w-4 accent-[color:var(--accent)] disabled:opacity-40"
                                />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
                {filteredEvents.length === 0 && (
                  <tr>
                    <td
                      colSpan={1 + METHOD_COLUMNS.length}
                      className="px-4 py-12 text-center text-[13px] text-[color:var(--text-muted)]"
                    >
                      No notifications match your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sticky save bar */}
      <div className="fixed bottom-0 inset-x-0 z-40 border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/95 backdrop-blur-md">
        <div className="mx-auto max-w-[96rem] px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12px] text-[color:var(--text-muted)]">
            {dirty ? 'You have unsaved changes.' : 'All changes saved.'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={resetNotificationDraft}
              disabled={!dirty || notificationSaving}
              className="h-9 px-3 rounded-lg border border-[color:var(--border-subtle)] text-sm disabled:opacity-40"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => void saveNotificationPreferences()}
              disabled={notificationSaving || !dirty}
              className="btn-primary h-9 px-4 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {notificationSaving ? 'Saving…' : 'Save preferences'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
