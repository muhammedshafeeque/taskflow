import { useEffect, useState } from 'react';
import { FiTrash2, FiPlus, FiPlay } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import {
  reportsApi,
  projectsApi,
  usersApi,
  type Report,
  type ReportType,
  type ReportExecuteResult,
  type ReportFilters,
  type User,
  REPORT_FILTER_UNASSIGNED,
} from '../lib/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: 'issues_by_status', label: 'Issues by status' },
  { value: 'issues_by_type', label: 'Issues by type' },
  { value: 'issues_by_priority', label: 'Issues by priority' },
  { value: 'issues_by_assignee', label: 'Issues by assignee' },
  { value: 'workload', label: 'Workload' },
  { value: 'defects', label: 'Defects' },
];

const CHART_TYPES = [
  { value: 'bar', label: 'Bar' },
  { value: 'pie', label: 'Pie' },
  { value: 'table', label: 'Table' },
];

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

const FILTER_STATUSES = ['Backlog', 'Todo', 'In Progress', 'Done'];
const FILTER_TYPES = ['Task', 'Bug', 'Story', 'Epic'];
const FILTER_PRIORITIES = ['Lowest', 'Low', 'Medium', 'High', 'Highest'];

function buildReportFiltersFromForm(
  filterDateFrom: string,
  filterDateTo: string,
  filterDateField: 'createdAt' | 'updatedAt',
  filterStatuses: string[],
  filterPriorities: string[],
  filterTypes: string[],
  filterAssigneeIds: string[]
): ReportFilters | undefined {
  const f: ReportFilters = {};
  const df = filterDateFrom.trim();
  const dt = filterDateTo.trim();
  if (df) f.dateFrom = df;
  if (dt) f.dateTo = dt;
  if (df || dt) f.dateField = filterDateField;
  if (filterStatuses.length) f.statuses = filterStatuses;
  if (filterPriorities.length) f.priorities = filterPriorities;
  if (filterTypes.length) f.types = filterTypes;
  if (filterAssigneeIds.length) f.assigneeIds = filterAssigneeIds;
  if (
    !f.dateFrom &&
    !f.dateTo &&
    !f.statuses?.length &&
    !f.priorities?.length &&
    !f.types?.length &&
    !f.assigneeIds?.length
  ) {
    return undefined;
  }
  return f;
}

function formatReportSummary(r: Report): string {
  const parts: string[] = [];
  if (r.project?.name) parts.push(r.project.name);
  const f = r.config?.filters;
  if (!f) return parts.join(' · ');
  if (f.dateFrom || f.dateTo) {
    parts.push(`${f.dateFrom ?? '…'} → ${f.dateTo ?? '…'}`);
  }
  if (f.statuses?.length) parts.push(`${f.statuses.length} status${f.statuses.length !== 1 ? 'es' : ''}`);
  if (f.priorities?.length) parts.push(`${f.priorities.length} priorities`);
  if (f.types?.length) parts.push(`${f.types.length} types`);
  if (f.assigneeIds?.length) parts.push(`${f.assigneeIds.length} assignee filter${f.assigneeIds.length !== 1 ? 's' : ''}`);
  return parts.join(' · ');
}

export default function ReportsPage() {
  const { token, user } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [projects, setProjects] = useState<{ _id: string; name: string; key: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<ReportType>('issues_by_status');
  const [newProject, setNewProject] = useState<string>('');
  const [newChartType, setNewChartType] = useState<'bar' | 'pie' | 'table'>('bar');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterDateField, setFilterDateField] = useState<'createdAt' | 'updatedAt'>('updatedAt');
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [filterPriorities, setFilterPriorities] = useState<string[]>([]);
  const [filterTypes, setFilterTypes] = useState<string[]>([]);
  const [filterAssigneeIds, setFilterAssigneeIds] = useState<string[]>([]);
  const [filterUsers, setFilterUsers] = useState<User[]>([]);
  const [createError, setCreateError] = useState('');
  const [saving, setSaving] = useState(false);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [result, setResult] = useState<ReportExecuteResult | null>(null);
  const [executeError, setExecuteError] = useState('');
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);

  useEffect(() => {
    if (!showCreate || !token) return;
    usersApi.list(1, 200, token).then((res) => {
      if (res.success && res.data?.data) setFilterUsers(res.data.data);
    });
  }, [token, showCreate]);

  useEffect(() => {
    if (!showCreate) return;
    setNewName('');
    setNewType('issues_by_status');
    setNewProject('');
    setNewChartType('bar');
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterDateField('updatedAt');
    setFilterStatuses([]);
    setFilterPriorities([]);
    setFilterTypes([]);
    setFilterAssigneeIds([]);
    setCreateError('');
  }, [showCreate]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      reportsApi.list(token),
      projectsApi.list(1, 100, token),
    ]).then(([reportsRes, projectsRes]) => {
      setLoading(false);
      if (reportsRes.success && reportsRes.data) setReports(Array.isArray(reportsRes.data) ? reportsRes.data : []);
      if (projectsRes.success && projectsRes.data?.data) {
        setProjects(projectsRes.data.data.map((p) => ({ _id: p._id, name: p.name, key: p.key })));
      }
    });
  }, [token]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !newName.trim()) return;
    setSaving(true);
    setCreateError('');
    const filters = buildReportFiltersFromForm(
      filterDateFrom,
      filterDateTo,
      filterDateField,
      filterStatuses,
      filterPriorities,
      filterTypes,
      filterAssigneeIds
    );
    const res = await reportsApi.create(
      {
        name: newName.trim(),
        type: newType,
        project: newProject || undefined,
        config: {
          chartType: newChartType,
          ...(filters ? { filters } : {}),
        },
      },
      token
    );
    setSaving(false);
    if (res.success && res.data) {
      setReports((prev) => [res.data!, ...prev]);
      setShowCreate(false);
    } else {
      setCreateError((res as { message?: string }).message ?? 'Could not create report');
    }
  }

  async function handleDelete(r: Report) {
    if (!token || !confirm(`Delete report "${r.name}"?`)) return;
    const res = await reportsApi.delete(r._id, token);
    if (res.success) {
      setReports((prev) => prev.filter((x) => x._id !== r._id));
      if (selectedReportId === r._id) {
        setSelectedReportId(null);
        setResult(null);
        setExecuteError('');
      }
    }
  }

  async function handleExecute(r: Report) {
    if (!token) return;
    setExecutingId(r._id);
    setSelectedReportId(r._id);
    setExecuteError('');
    const res = await reportsApi.execute(r._id, token);
    setExecutingId(null);
    if (res.success && res.data) {
      setResult(res.data);
    } else {
      setResult(null);
      setExecuteError((res as { message?: string }).message ?? 'Could not run report');
    }
  }

  if (user?.permissions && !user.permissions.includes('reports:view')) {
    return (
      <div className="p-8">
        <p className="text-[color:var(--text-muted)]">Access denied.</p>
      </div>
    );
  }

  const selectedReport = reports.find((r) => r._id === selectedReportId);
  const chartType = selectedReport?.config?.chartType ?? 'bar';
  const chartData = result?.labels && result?.values
    ? result.labels.map((label, i) => ({ name: label, value: result.values![i] ?? 0 }))
    : [];

  return (
    <div className="flex-1 min-h-0 flex flex-col p-6">
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <h1 className="text-lg font-semibold text-[color:var(--text-primary)]">Custom Reports</h1>
        {user?.permissions?.includes('reports:create') && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] text-sm font-medium hover:bg-[color:var(--bg-elevated)]"
          >
            <FiPlus className="w-4 h-4" /> New report
          </button>
        )}
      </div>

      {showCreate && user?.permissions?.includes('reports:create') && (
        <div className="mb-6 rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-6">
          <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mb-4">Create report</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-xs text-[color:var(--text-muted)] mb-1">Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Report name"
                className="px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm w-full max-w-md"
              />
            </div>
            <div>
              <label className="block text-xs text-[color:var(--text-muted)] mb-1">Type</label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as ReportType)}
                className="px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm w-full max-w-md"
              >
                {REPORT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[color:var(--text-muted)] mb-1">Project (optional)</label>
              <select
                value={newProject}
                onChange={(e) => setNewProject(e.target.value)}
                className="px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm w-full max-w-md"
              >
                <option value="">All projects</option>
                {projects.map((p) => (
                  <option key={p._id} value={p._id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[color:var(--text-muted)] mb-1">Chart type</label>
              <select
                value={newChartType}
                onChange={(e) => setNewChartType(e.target.value as 'bar' | 'pie' | 'table')}
                className="px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm w-full max-w-md"
              >
                {CHART_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="border-t border-[color:var(--border-subtle)] pt-4 mt-2">
              <h3 className="text-xs font-semibold text-[color:var(--text-primary)] mb-3">Filters (optional)</h3>
              <p className="text-[11px] text-[color:var(--text-muted)] mb-4">
                Narrow results by date, status, priority, type, or assignee. Hold Cmd (Mac) or Ctrl (Windows) to select multiple values.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
                <div>
                  <label className="block text-xs text-[color:var(--text-muted)] mb-1">Date from</label>
                  <input
                    type="date"
                    value={filterDateFrom}
                    onChange={(e) => setFilterDateFrom(e.target.value)}
                    className="px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[color:var(--text-muted)] mb-1">Date to</label>
                  <input
                    type="date"
                    value={filterDateTo}
                    onChange={(e) => setFilterDateTo(e.target.value)}
                    className="px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm w-full"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs text-[color:var(--text-muted)] mb-1">Apply date range to</label>
                  <select
                    value={filterDateField}
                    onChange={(e) => setFilterDateField(e.target.value as 'createdAt' | 'updatedAt')}
                    className="px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm w-full max-w-md"
                  >
                    <option value="updatedAt">Updated at</option>
                    <option value="createdAt">Created at</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[color:var(--text-muted)] mb-1">Statuses</label>
                  <select
                    multiple
                    size={5}
                    value={filterStatuses}
                    onChange={(e) => setFilterStatuses(Array.from(e.target.selectedOptions, (o) => o.value))}
                    className="px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm w-full min-h-[120px]"
                  >
                    {FILTER_STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[color:var(--text-muted)] mb-1">Priorities</label>
                  <select
                    multiple
                    size={5}
                    value={filterPriorities}
                    onChange={(e) => setFilterPriorities(Array.from(e.target.selectedOptions, (o) => o.value))}
                    className="px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm w-full min-h-[120px]"
                  >
                    {FILTER_PRIORITIES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[color:var(--text-muted)] mb-1">Issue types</label>
                  <select
                    multiple
                    size={5}
                    value={filterTypes}
                    onChange={(e) => setFilterTypes(Array.from(e.target.selectedOptions, (o) => o.value))}
                    className="px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm w-full min-h-[120px]"
                  >
                    {FILTER_TYPES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[color:var(--text-muted)] mb-1">Assignees</label>
                  <select
                    multiple
                    size={6}
                    value={filterAssigneeIds}
                    onChange={(e) => setFilterAssigneeIds(Array.from(e.target.selectedOptions, (o) => o.value))}
                    className="px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm w-full min-h-[140px]"
                  >
                    <option value={REPORT_FILTER_UNASSIGNED}>Unassigned</option>
                    {filterUsers.map((u) => (
                      <option key={u._id} value={u._id}>{u.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {createError && (
              <p className="text-sm text-red-400" role="alert">{createError}</p>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving || !newName.trim()}
                className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--accent)] text-white text-xs font-medium disabled:opacity-50"
              >
                {saving ? 'Creating…' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs font-medium"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="flex gap-6 flex-1 min-h-0">
        <div className="w-72 shrink-0 rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] overflow-hidden">
          <div className="p-4 border-b border-[color:var(--border-subtle)]">
            <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">Saved reports</h2>
          </div>
          <div className="p-2 overflow-y-auto max-h-[calc(100vh-280px)]">
            {loading ? (
              <div className="text-[color:var(--text-muted)] animate-pulse text-xs py-4">Loading…</div>
            ) : reports.length === 0 ? (
              <div className="text-[color:var(--text-muted)] text-xs py-4">No reports yet.</div>
            ) : (
              <ul className="space-y-1">
                {reports.map((r) => (
                  <li
                    key={r._id}
                    className={`flex items-center justify-between px-3 py-2 rounded-md group ${
                      selectedReportId === r._id ? 'bg-[color:var(--bg-elevated)]' : 'hover:bg-[color:var(--bg-elevated)]'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => handleExecute(r)}
                        disabled={executingId === r._id}
                        className="text-left w-full text-sm font-medium truncate block"
                      >
                        {r.name}
                      </button>
                      <span className="text-xs text-[color:var(--text-muted)]">{r.type}</span>
                      {formatReportSummary(r) && (
                        <span className="text-[10px] text-[color:var(--text-muted)]/90 block mt-0.5 line-clamp-2 leading-snug">
                          {formatReportSummary(r)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleExecute(r)}
                        disabled={executingId === r._id}
                        className="p-1 rounded text-[color:var(--accent)] hover:bg-[color:var(--accent)]/20"
                        title="Run"
                      >
                        <FiPlay className="w-4 h-4" />
                      </button>
                      {user?.permissions?.includes('reports:create') && (
                        <button
                          type="button"
                          onClick={() => handleDelete(r)}
                          className="p-1 rounded text-[color:var(--text-muted)] hover:text-red-500 opacity-0 group-hover:opacity-100"
                          title="Delete"
                        >
                          <FiTrash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0 rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] overflow-hidden">
          <div className="p-4 border-b border-[color:var(--border-subtle)]">
            <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">Report result</h2>
          </div>
          <div className="p-6 overflow-auto">
            {executeError && (
              <p className="text-sm text-red-400 mb-4" role="alert">{executeError}</p>
            )}
            {!result ? (
              <div className="text-[color:var(--text-muted)] text-sm py-8 text-center">
                {executeError ? 'Fix the error above or pick another report.' : 'Select a report and click Run to view results.'}
              </div>
            ) : result.type === 'defects' ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="rounded-lg border border-[color:var(--border-subtle)] p-4">
                    <div className="text-xs text-[color:var(--text-muted)]">Total bugs</div>
                    <div className="text-xl font-semibold">{(result.data as { totalBugs?: number })?.totalBugs ?? 0}</div>
                  </div>
                  <div className="rounded-lg border border-[color:var(--border-subtle)] p-4">
                    <div className="text-xs text-[color:var(--text-muted)]">Open</div>
                    <div className="text-xl font-semibold">{(result.data as { openBugs?: number })?.openBugs ?? 0}</div>
                  </div>
                  <div className="rounded-lg border border-[color:var(--border-subtle)] p-4">
                    <div className="text-xs text-[color:var(--text-muted)]">Closed</div>
                    <div className="text-xl font-semibold">{(result.data as { closedBugs?: number })?.closedBugs ?? 0}</div>
                  </div>
                  <div className="rounded-lg border border-[color:var(--border-subtle)] p-4">
                    <div className="text-xs text-[color:var(--text-muted)]">Defect density</div>
                    <div className="text-xl font-semibold">{(result.data as { defectDensity?: number })?.defectDensity ?? '—'}</div>
                  </div>
                </div>
                {result.byStatus && result.byStatus.labels?.length > 0 && (
                  <div className="h-64">
                    <h3 className="text-xs font-medium text-[color:var(--text-muted)] mb-2">By status</h3>
                    <ResponsiveContainer width="100%" height="90%">
                      <BarChart data={result.byStatus.labels.map((l, i) => ({ name: l, value: result.byStatus!.values![i] ?? 0 }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="value" fill="var(--accent)" name="Count" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {result.byPriority && result.byPriority.labels?.length > 0 && (
                  <div className="h-64">
                    <h3 className="text-xs font-medium text-[color:var(--text-muted)] mb-2">By priority</h3>
                    <ResponsiveContainer width="100%" height="90%">
                      <BarChart data={result.byPriority.labels.map((l, i) => ({ name: l, value: result.byPriority!.values![i] ?? 0 }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="value" fill="var(--accent)" name="Count" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            ) : chartData.length > 0 ? (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  {chartType === 'pie' ? (
                    <PieChart>
                      <Pie
                        data={chartData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        label={({ name, value }) => `${name}: ${value}`}
                      >
                        {chartData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  ) : chartType === 'table' ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[color:var(--border-subtle)]">
                            <th className="text-left py-2 px-3">Name</th>
                            <th className="text-right py-2 px-3">Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {chartData.map((row, i) => (
                            <tr key={i} className="border-b border-[color:var(--border-subtle)]/70">
                              <td className="py-2 px-3">{row.name}</td>
                              <td className="py-2 px-3 text-right">{row.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" fill="var(--accent)" name="Count" />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-[color:var(--text-muted)] text-sm py-8 text-center">No data to display.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
