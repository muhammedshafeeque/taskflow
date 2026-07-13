import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { formatMinutes } from '../components/issue/WorkLogInput';
import {
  dashboardApi,
  projectsApi,
  type PerformanceReportData,
  type PerformanceReportTeammate,
  type Project,
} from '../lib/api';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import { toIsoDateString, todayIsoDate } from '../lib/dateFormat';

function defaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 6);
  return {
    from: toIsoDateString(from),
    to: todayIsoDate(),
  };
}

function truncateTitle(title: string, max = 56): string {
  if (title.length <= max) return title;
  return `${title.slice(0, max - 1)}…`;
}

export default function PerformanceReport() {
  const { token, user } = useAuth();
  const workspaceKey = user?.activeOrganizationId ?? '';
  const rangeInit = useMemo(() => defaultDateRange(), []);
  const [from, setFrom] = useState(rangeInit.from);
  const [to, setTo] = useState(rangeInit.to);
  const [teammates, setTeammates] = useState<PerformanceReportTeammate[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => (user?.id ? [user.id] : []));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);
  const [report, setReport] = useState<PerformanceReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const [exporting, setExporting] = useState(false);
  const projectPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user?.id && selectedIds.length === 0) {
      setSelectedIds([user.id]);
    }
  }, [user?.id, selectedIds.length]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
      if (projectPickerRef.current && !projectPickerRef.current.contains(e.target as Node)) {
        setProjectPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    if (!token) return;
    dashboardApi.getPerformanceReportUsers(token).then((res) => {
      if (res.success && res.data?.users) setTeammates(res.data.users);
    });
    projectsApi.list(1, 100, token).then((res) => {
      if (res.success && res.data) {
        const d = res.data as { data?: Project[] };
        setProjects(d.data ?? []);
      }
    });
  }, [token, workspaceKey]);

  const reportParams = useMemo(
    () => ({
      userIds: selectedIds,
      from,
      to,
      ...(selectedProjectIds.length > 0 ? { projectIds: selectedProjectIds } : {}),
    }),
    [selectedIds, from, to, selectedProjectIds]
  );

  useEffect(() => {
    if (!token || selectedIds.length === 0) {
      setReport(null);
      return;
    }
    setLoading(true);
    setError('');
    dashboardApi
      .getPerformanceReport(token, reportParams)
      .then((res) => {
        setLoading(false);
        if (res.success && res.data) setReport(res.data);
        else {
          setReport(null);
          setError(res.message ?? 'Failed to load report');
        }
      })
      .catch(() => {
        setLoading(false);
        setReport(null);
        setError('Failed to load report');
      });
  }, [token, reportParams, workspaceKey]);

  async function handleExportExcel() {
    if (!token || selectedIds.length === 0 || !report?.rows.length) return;
    setExporting(true);
    const res = await dashboardApi.downloadPerformanceReportExcel(token, reportParams);
    setExporting(false);
    if (!res.success) setError(res.message ?? 'Export failed');
  }

  function toggleUser(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function removeUser(id: string) {
    setSelectedIds((prev) => prev.filter((x) => x !== id));
  }

  const filteredTeammates = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return teammates;
    return teammates.filter((t) => t.name.toLowerCase().includes(q));
  }, [teammates, pickerQuery]);

  const selectedUsers = useMemo(
    () => selectedIds.map((id) => teammates.find((t) => t._id === id)).filter(Boolean) as PerformanceReportTeammate[],
    [selectedIds, teammates]
  );

  const filteredProjects = useMemo(() => {
    const q = projectQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.key && p.key.toLowerCase().includes(q))
    );
  }, [projects, projectQuery]);

  const selectedProjects = useMemo(
    () =>
      selectedProjectIds
        .map((id) => projects.find((p) => p._id === id))
        .filter(Boolean) as Project[],
    [selectedProjectIds, projects]
  );

  function toggleProject(id: string) {
    setSelectedProjectIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function removeProject(id: string) {
    setSelectedProjectIds((prev) => prev.filter((x) => x !== id));
  }

  const chartData = useMemo(
    () =>
      (report?.chartByMember ?? []).map((m) => ({
        name: m.userName.length > 18 ? `${m.userName.slice(0, 16)}…` : m.userName,
        minutes: m.totalMinutes,
      })),
    [report?.chartByMember]
  );

  return (
    <div className="w-full p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[color:var(--text-primary)]">Performance report</h1>
        <p className="text-sm text-[color:var(--text-muted)] mt-1">
          One row per teammate and issue with activity in the date range.{' '}
          <span className="font-medium text-[color:var(--text-primary)]">Updates</span> counts issue history (including
          imported Azure DevOps changes credited to the assignee) plus work-log entries in the date range; run{' '}
          <span className="font-medium text-[color:var(--text-primary)]">Azure DevOps sync</span> to import DevOps
          history first.
          <span className="font-medium text-[color:var(--text-primary)]">Time logged</span> sums only logs dated in the
          range. Leave projects empty to include all your projects.
        </p>
      </div>

      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs text-[color:var(--text-muted)] mb-1">From</label>
          <DateInputDDMMYYYY
            value={from}
            onChange={setFrom}
            className="px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm w-[11rem]"
          />
        </div>
        <div>
          <label className="block text-xs text-[color:var(--text-muted)] mb-1">To</label>
          <DateInputDDMMYYYY
            value={to}
            onChange={setTo}
            className="px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm w-[11rem]"
          />
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-md" ref={projectPickerRef}>
          <label className="block text-xs text-[color:var(--text-muted)] mb-1">Projects (optional)</label>
          <input
            type="text"
            value={projectQuery}
            onChange={(e) => setProjectQuery(e.target.value)}
            onFocus={() => setProjectPickerOpen(true)}
            placeholder="Search projects…"
            className="px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm w-full"
          />
          {projectPickerOpen && projects.length > 0 && (
            <div className="absolute z-20 mt-1 max-h-56 overflow-auto rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] shadow-lg min-w-[min(100%,280px)] max-w-md">
              {filteredProjects.length === 0 ? (
                <div className="px-3 py-2 text-xs text-[color:var(--text-muted)]">No matches</div>
              ) : (
                <ul className="py-1">
                  {filteredProjects.map((p) => {
                    const on = selectedProjectIds.includes(p._id);
                    return (
                      <li key={p._id}>
                        <button
                          type="button"
                          onClick={() => toggleProject(p._id)}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-[color:var(--bg-elevated)] flex items-center gap-2 ${
                            on ? 'text-[color:var(--accent)]' : 'text-[color:var(--text-primary)]'
                          }`}
                        >
                          <span
                            className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center text-[10px] ${
                              on ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/20' : 'border-[color:var(--border-subtle)]'
                            }`}
                          >
                            {on ? '✓' : ''}
                          </span>
                          <span className="truncate">{p.name}</span>
                          <span className="text-[color:var(--text-muted)] text-xs shrink-0">({p.key})</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="relative flex-1 min-w-[240px] max-w-xl" ref={pickerRef}>
          <label className="block text-xs text-[color:var(--text-muted)] mb-1">Members</label>
          <input
            type="text"
            value={pickerQuery}
            onChange={(e) => setPickerQuery(e.target.value)}
            onFocus={() => setPickerOpen(true)}
            placeholder="Search teammates…"
            className="px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm w-full"
          />
          {pickerOpen && teammates.length > 0 && (
            <div className="absolute z-20 mt-1 max-h-56 overflow-auto rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] shadow-lg min-w-[min(100%,320px)] max-w-xl">
              {filteredTeammates.length === 0 ? (
                <div className="px-3 py-2 text-xs text-[color:var(--text-muted)]">No matches</div>
              ) : (
                <ul className="py-1">
                  {filteredTeammates.map((t) => {
                    const on = selectedIds.includes(t._id);
                    return (
                      <li key={t._id}>
                        <button
                          type="button"
                          onClick={() => toggleUser(t._id)}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-[color:var(--bg-elevated)] flex items-center gap-2 ${
                            on ? 'text-[color:var(--accent)]' : 'text-[color:var(--text-primary)]'
                          }`}
                        >
                          <span
                            className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center text-[10px] ${
                              on ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/20' : 'border-[color:var(--border-subtle)]'
                            }`}
                          >
                            {on ? '✓' : ''}
                          </span>
                          {t.name}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => void handleExportExcel()}
            disabled={exporting || loading || !report?.rows.length || selectedIds.length === 0}
            className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-sm font-medium hover:bg-[color:var(--bg-elevated)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exporting ? 'Exporting…' : 'Download Excel'}
          </button>
        </div>
      </div>

      {selectedProjects.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <span className="text-[10px] text-[color:var(--text-muted)] w-full">Filtered projects:</span>
          {selectedProjects.map((p) => (
            <span
              key={p._id}
              className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] text-xs"
            >
              {p.name}
              <button
                type="button"
                onClick={() => removeProject(p._id)}
                className="p-0.5 rounded hover:bg-[color:var(--bg-page)] text-[color:var(--text-muted)]"
                aria-label={`Remove ${p.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {selectedUsers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedUsers.map((t) => (
            <span
              key={t._id}
              className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] text-xs"
            >
              {t.name}
              <button
                type="button"
                onClick={() => removeUser(t._id)}
                className="p-0.5 rounded hover:bg-[color:var(--bg-page)] text-[color:var(--text-muted)]"
                aria-label={`Remove ${t.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
      {loading && <p className="text-sm text-[color:var(--text-muted)]">Loading…</p>}

      {!loading && report && chartData.length > 0 && (
        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4">
          <h2 className="text-sm font-medium text-[color:var(--text-primary)] mb-3">Time logged by member</h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-24} textAnchor="end" height={56} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value: number | undefined) => [formatMinutes(value ?? 0), 'Time logged']}
                  contentStyle={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                  }}
                />
                <Bar dataKey="minutes" fill="var(--accent)" name="Minutes" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {!loading && report && chartData.length === 0 && report.rows.length === 0 && !error && (
        <p className="text-sm text-[color:var(--text-muted)]">No activity in this range for the selected members.</p>
      )}

      {report && report.rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[color:var(--border-subtle)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]">
                <th className="text-left py-2 px-3 font-medium">Member</th>
                <th className="text-left py-2 px-3 font-medium">Project</th>
                <th className="text-left py-2 px-3 font-medium">Issue</th>
                <th className="text-right py-2 px-3 font-medium">Updates</th>
                <th className="text-right py-2 px-3 font-medium">Time logged</th>
                <th className="text-right py-2 px-3 font-medium">Estimated</th>
                <th className="text-left py-2 px-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={`${row.userId}-${row.issueId}`} className="border-b border-[color:var(--border-subtle)]/70">
                  <td className="py-2 px-3 whitespace-nowrap">{row.userName}</td>
                  <td className="py-2 px-3">{row.projectName}</td>
                  <td className="py-2 px-3 max-w-[280px]">
                    <Link
                      to={`/projects/${row.projectId}/issues/${encodeURIComponent(row.issueKey)}`}
                      className="text-[color:var(--accent)] hover:underline font-medium"
                    >
                      {row.issueKey}
                    </Link>
                    <span className="text-[color:var(--text-muted)]"> · {truncateTitle(row.issueTitle)}</span>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">{row.updates}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{formatMinutes(row.timeLoggedMinutes)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">
                    {row.estimatedMinutes != null ? formatMinutes(row.estimatedMinutes) : '—'}
                  </td>
                  <td className="py-2 px-3">{row.status}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-[color:var(--bg-elevated)] font-medium border-t-2 border-[color:var(--border-subtle)]">
                <td className="py-2 px-3" colSpan={3}>
                  Totals
                </td>
                <td className="py-2 px-3 text-right tabular-nums">{report.totals.updates}</td>
                <td className="py-2 px-3 text-right tabular-nums">{formatMinutes(report.totals.timeLoggedMinutes)}</td>
                <td className="py-2 px-3 text-right tabular-nums">{formatMinutes(report.totals.estimatedMinutes)}</td>
                <td className="py-2 px-3 text-[color:var(--text-muted)]">—</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
