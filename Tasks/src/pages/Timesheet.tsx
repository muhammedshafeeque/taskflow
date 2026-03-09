import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { EditIcon } from '../components/icons/NavigationIcons';
import {
  timesheetApi,
  workLogsApi,
  type TimesheetResult,
  type TimesheetDetailItem,
} from '../lib/api';
import { formatMinutes, parseDuration } from '../components/issue/WorkLogInput';

function formatMinutesCell(minutes: number | undefined): string {
  if (!minutes || minutes <= 0) return '';
  const totalMinutes = minutes;
  const m = totalMinutes % 60;
  let h = Math.floor(totalMinutes / 60);
  const d = Math.floor(h / 8);
  h = h % 8;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.join(' ');
}

function TimesheetDetailsModal({
  open,
  onClose,
  userId,
  userName,
  date,
  currentUserId,
  token,
  onUpdated,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  userName: string;
  date: string;
  currentUserId?: string;
  token: string | null;
  onUpdated: () => void;
}) {
  const [items, setItems] = useState<TimesheetDetailItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMinutes, setEditMinutes] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !token) return;
    setLoading(true);
    setItems([]);
    timesheetApi
      .getDetails(userId, date, token)
      .then((res) => {
        if (res.success && res.data) setItems(res.data);
      })
      .finally(() => setLoading(false));
  }, [open, userId, date, token]);

  const canEdit = currentUserId === userId;

  function startEdit(item: TimesheetDetailItem) {
    setEditingId(item._id);
    setEditMinutes(formatMinutes(item.minutesSpent));
    setEditDescription(item.description ?? '');
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit() {
    if (!editingId || !token) return;
    const item = items.find((i) => i._id === editingId);
    if (!item) return;
    const minutes = parseDuration(editMinutes);
    if (!minutes) return;
    setSaving(true);
    const res = await workLogsApi.update(
      item.issueId,
      editingId,
      { minutesSpent: minutes, description: editDescription.trim() || undefined },
      token
    );
    setSaving(false);
    if (res.success && res.data) {
      setItems((prev) =>
        prev.map((i) =>
          i._id === editingId
            ? {
                ...i,
                minutesSpent: minutes,
                description: editDescription.trim() || undefined,
              }
            : i
        )
      );
      setEditingId(null);
      onUpdated();
    }
  }

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">
              Time logged — {userName}
            </h2>
            <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5">
              {new Date(date).toLocaleDateString(undefined, {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)]"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <p className="text-xs text-[color:var(--text-muted)]">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-xs text-[color:var(--text-muted)]">No time logged for this day.</p>
          ) : (
            <ul className="space-y-3">
              {items.map((item) => (
                <li
                  key={item._id}
                  className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] p-3"
                >
                  {editingId === item._id ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={editMinutes}
                        onChange={(e) => setEditMinutes(e.target.value)}
                        placeholder="e.g. 2h 30m"
                        className="w-full px-2 py-1.5 rounded text-xs bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)]"
                      />
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        placeholder="Remark (optional)"
                        rows={2}
                        className="w-full px-2 py-1.5 rounded text-xs bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] resize-none"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={saveEdit}
                          disabled={saving}
                          className="btn-primary px-2 py-1 rounded text-xs disabled:opacity-50"
                        >
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="px-2 py-1 rounded text-xs border border-[color:var(--border-subtle)] text-[color:var(--text-muted)]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          to={`/projects/${item.projectId}/issues/${encodeURIComponent(item.issueKey)}`}
                          className="font-mono text-xs font-medium text-[color:var(--accent)] hover:underline"
                        >
                          {item.issueKey}
                        </Link>
                        <span className="text-xs font-medium text-[color:var(--text-primary)] shrink-0">
                          {formatMinutes(item.minutesSpent)}
                        </span>
                      </div>
                      <p className="text-xs text-[color:var(--text-primary)] mt-1 truncate" title={item.issueTitle}>
                        {item.issueTitle}
                      </p>
                      {item.projectName && (
                        <p className="text-[10px] text-[color:var(--text-muted)] mt-0.5">{item.projectName}</p>
                      )}
                      {item.description && (
                        <p className="text-[11px] text-[color:var(--text-muted)] mt-1.5 italic border-l-2 border-[color:var(--border-subtle)] pl-2">
                          {item.description}
                        </p>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => startEdit(item)}
                          title="Edit"
                          className="mt-2 inline-flex items-center gap-1 text-[10px] text-[color:var(--accent)] hover:underline"
                        >
                          <EditIcon className="w-3 h-3" />
                          Edit
                        </button>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function Timesheet() {
  const { projectId } = useParams<{ projectId?: string }>();
  const { token, user } = useAuth();
  const [data, setData] = useState<TimesheetResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{
    userId: string;
    userName: string;
    date: string;
  } | null>(null);
  const [startDate, setStartDate] = useState(() => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    return start.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [exporting, setExporting] = useState(false);

  const refreshData = () => {
    if (!token) return;
    const fetch = projectId
      ? timesheetApi.getProject(projectId, startDate, endDate, token)
      : timesheetApi.getGlobal(startDate, endDate, token);
    fetch.then((res) => {
      if (res.success && res.data) setData(res.data);
    });
  };

  async function handleExportExcel() {
    if (!token) return;
    setExporting(true);
    const res = await timesheetApi.downloadExcel(startDate, endDate, token);
    setExporting(false);
    if (!res.success) setError(res.message ?? 'Export failed');
  }

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    const fetch = projectId
      ? timesheetApi.getProject(projectId, startDate, endDate, token)
      : timesheetApi.getGlobal(startDate, endDate, token);
    fetch
      .then((res) => {
        if (res.success && res.data) setData(res.data);
        else setError(res.message || 'Failed to load timesheet');
      })
      .catch(() => setError('Failed to load timesheet'))
      .finally(() => setLoading(false));
  }, [token, projectId, startDate, endDate]);

  const dateColumns = useMemo(() => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const dates: string[] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }, [startDate, endDate]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">Timesheet</h1>
          <p className="text-xs text-[color:var(--text-muted)] mt-1">
            {projectId
              ? 'Time logged by team members per day in this project.'
              : 'See time logged by team members per day across all your projects.'}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] font-medium text-[color:var(--text-primary)] mb-1">
              From
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[color:var(--text-primary)] mb-1">
              To
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40"
            />
          </div>
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={exporting}
            className="btn-primary px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 disabled:opacity-50"
          >
            {exporting ? (
              'Exporting…'
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Download Excel
              </>
            )}
          </button>
        </div>
      </div>

      {loading && <p className="text-[color:var(--text-muted)] text-xs">Loading timesheet…</p>}
      {error && !loading && (
        <p className="text-red-400 text-sm">Error loading timesheet: {error}</p>
      )}

      {!loading && !error && data && (
        <div className="overflow-auto rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]">
          <table className="min-w-full text-xs border-collapse">
            <thead>
              <tr className="bg-[color:var(--bg-elevated)]">
                <th className="sticky left-0 z-10 bg-[color:var(--bg-elevated)] px-4 py-2 text-left font-medium text-[color:var(--text-muted)] border-b border-[color:var(--border-subtle)]">
                  User
                </th>
                {dateColumns.map((d) => (
                  <th
                    key={d}
                    className="px-3 py-2 text-[11px] font-medium text-[color:var(--text-muted)] border-b border-[color:var(--border-subtle)] whitespace-nowrap"
                  >
                    {new Date(d).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </th>
                ))}
                <th className="px-4 py-2 text-[11px] font-medium text-[color:var(--text-muted)] border-b border-[color:var(--border-subtle)] whitespace-nowrap">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {data.byUser.map((row) => (
                <tr key={row.userId} className="even:bg-[color:var(--bg-elevated)]">
                  <td className="sticky left-0 z-10 bg-[color:var(--bg-elevated)] px-4 py-2 text-[color:var(--text-primary)] border-b border-[color:var(--border-subtle)] whitespace-nowrap">
                    {row.userName}
                  </td>
                  {dateColumns.map((d) => {
                    const mins = row.byDate[d];
                    const hasTime = mins && mins > 0;
                    return (
                      <td
                        key={d}
                        className={`px-3 py-2 text-[11px] border-b border-[color:var(--border-subtle)] text-center align-middle ${
                          hasTime
                            ? 'text-[color:var(--text-primary)] cursor-pointer hover:bg-[color:var(--bg-elevated)] hover:underline'
                            : 'text-[color:var(--text-muted)]'
                        }`}
                        onClick={() =>
                          hasTime && setModal({ userId: row.userId, userName: row.userName, date: d })
                        }
                        role={hasTime ? 'button' : undefined}
                        tabIndex={hasTime ? 0 : undefined}
                        onKeyDown={(e) =>
                          hasTime &&
                          (e.key === 'Enter' || e.key === ' ') &&
                          setModal({ userId: row.userId, userName: row.userName, date: d })
                        }
                      >
                        {formatMinutesCell(mins)}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2 text-[11px] text-[color:var(--text-primary)] border-b border-[color:var(--border-subtle)] text-right font-medium">
                    {formatMinutesCell(row.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-[color:var(--bg-elevated)]">
                <td className="sticky left-0 z-10 bg-[color:var(--bg-elevated)] px-4 py-2 text-[11px] font-medium text-[color:var(--text-muted)] border-t border-[color:var(--border-subtle)]">
                  Total
                </td>
                {dateColumns.map((d) => (
                  <td
                    key={d}
                    className="px-3 py-2 text-[11px] text-[color:var(--text-primary)] border-t border-[color:var(--border-subtle)] text-center font-medium"
                  >
                    {formatMinutesCell(data.byDate[d])}
                  </td>
                ))}
                <td className="px-4 py-2 text-[11px] text-[color:var(--text-primary)] border-t border-[color:var(--border-subtle)] text-right font-semibold">
                  {formatMinutesCell(
                    Object.values(data.byDate ?? {}).reduce((sum, m) => sum + m, 0)
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {modal && (
        <TimesheetDetailsModal
          open={!!modal}
          onClose={() => setModal(null)}
          userId={modal.userId}
          userName={modal.userName}
          date={modal.date}
          currentUserId={user?.id}
          token={token ?? null}
          onUpdated={refreshData}
        />
      )}
    </div>
  );
}
