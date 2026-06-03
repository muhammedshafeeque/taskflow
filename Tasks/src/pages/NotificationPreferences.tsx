import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  notificationsApi,
  type NotificationMethod,
  type NotificationPreferenceRow,
  type NotificationEventDescriptor,
  type NotificationMethodAvailability,
} from '../lib/api';

const METHOD_COLUMNS: Array<{ key: NotificationMethod; label: string }> = [
  { key: 'in_app', label: 'In-app' },
  { key: 'push', label: 'Push' },
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'discord', label: 'Discord' },
  { key: 'teams', label: 'Teams' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'slack', label: 'Slack' },
];

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
    <div className="w-full max-w-[96rem] mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[color:var(--text-primary)]">Notification preferences</h1>
        <Link to="/profile" className="text-sm text-[color:var(--accent)] hover:underline">
          Back to profile
        </Link>
      </div>
      <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6">
        <p className="text-sm text-[color:var(--text-muted)] mb-4">
          Choose how you want to be notified for each event. Unchecked methods will not send notifications or emails
          for that event. In-app also controls release notes and similar inbox items where applicable. Channels only
          appear when enabled on the server (SMTP, push, Slack, etc.).
        </p>
        {notificationError && (
          <div className="mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{notificationError}</div>
        )}
        {notificationSuccess && (
          <div className="mb-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm">
            Notification preferences updated.
          </div>
        )}
        {notificationLoading ? (
          <p className="text-sm text-[color:var(--text-muted)]">Loading notification preferences…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1280px] text-sm border border-[color:var(--border-subtle)] rounded-lg overflow-hidden">
              <thead className="bg-[color:var(--bg-page)]">
                <tr>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-[color:var(--text-muted)]">Notification Name</th>
                  {METHOD_COLUMNS.map((method) => (
                    <th key={method.key} className="text-center px-3 py-2 text-xs font-semibold text-[color:var(--text-muted)] whitespace-nowrap">
                      {method.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {notificationEvents.map((event) => {
                  const row = notificationDraft.find((r) => r.eventKey === event.key);
                  if (!row) return null;
                  return (
                    <tr key={event.key} className="border-t border-[color:var(--border-subtle)]">
                      <td className="px-3 py-2 align-top">
                        <div className="text-[color:var(--text-primary)] font-medium">{event.label}</div>
                        <div className="text-[11px] text-[color:var(--text-muted)]">{event.description}</div>
                      </td>
                      {METHOD_COLUMNS.map((method) => {
                        const available = availableMethods[method.key]?.enabled ?? false;
                        return (
                          <td key={method.key} className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={Boolean(row.methods[method.key])}
                              disabled={!available}
                              title={!available ? availableMethods[method.key]?.reason ?? 'Method unavailable' : ''}
                              onChange={(e) => updateNotificationCell(event.key, method.key, e.target.checked)}
                              className="h-4 w-4 accent-[color:var(--accent)] disabled:opacity-40"
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={resetNotificationDraft}
                className="px-3 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={saveNotificationPreferences}
                disabled={notificationSaving}
                className="px-3 py-2 rounded-lg bg-[color:var(--accent)] text-white text-sm font-medium disabled:opacity-50"
              >
                {notificationSaving ? 'Saving…' : 'Save preferences'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
