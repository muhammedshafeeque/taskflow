import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import {
  resourcesApi,
  type ResourceAllocation,
  type ResourceDemand,
  type ResourceProfileRow,
} from '../../lib/api';

function nameOf(ref: { name?: string; key?: string; email?: string } | string | null | undefined): string {
  if (!ref) return '—';
  if (typeof ref === 'string') return ref;
  if (ref.key) return `${ref.key} · ${ref.name ?? ''}`;
  return ref.name ?? ref.email ?? '—';
}

function fmtDate(v?: string | null) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString();
}

function toInputDate(v?: string | null) {
  if (!v) return '';
  return new Date(v).toISOString().slice(0, 10);
}

/* ─── Allocations ─────────────────────────────────────────────────────────── */

export function ResourcesAllocations() {
  const { token, user } = useAuth();
  const canManage = canAny(user, 'taskflow.resources.allocation.manage');
  const [rows, setRows] = useState<ResourceAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeOnly, setActiveOnly] = useState(true);
  const [modal, setModal] = useState(false);
  const [error, setError] = useState('');
  const [options, setOptions] = useState<{ users: Array<{ id: string; name: string; email: string }>; projects: Array<{ id: string; name: string; key: string }> }>({ users: [], projects: [] });
  const [form, setForm] = useState({
    userId: '',
    projectId: '',
    percent: 50,
    startDate: toInputDate(new Date().toISOString()),
    endDate: '',
    billable: true,
    softBooked: false,
    roleLabel: '',
    notes: '',
  });
  const [conflictHint, setConflictHint] = useState('');

  function load() {
    if (!token) return;
    setLoading(true);
    resourcesApi.listAllocations(token, activeOnly ? { activeOnly: 'true' } : undefined).then((res) => {
      setLoading(false);
      if (res.success && res.data) setRows(Array.isArray(res.data) ? res.data : []);
    });
  }

  useEffect(() => {
    load();
  }, [token, activeOnly]);

  useEffect(() => {
    if (!token || !canManage) return;
    resourcesApi.options(token).then((res) => {
      if (res.success && res.data) setOptions(res.data);
    });
  }, [token, canManage]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError('');
    setConflictHint('');
    const res = await resourcesApi.createAllocation(
      {
        ...form,
        endDate: form.endDate || null,
        percent: Number(form.percent),
      },
      token
    );
    if (!res.success) {
      setError((res as { message?: string }).message ?? 'Failed to create');
      return;
    }
    const conflicts = (res.data as { conflicts?: { overAllocated?: boolean; committedPercent?: number } })?.conflicts;
    if (conflicts?.overAllocated) {
      setConflictHint(`Saved — person is over-allocated (${conflicts.committedPercent}% committed excluding soft bookings).`);
    }
    setModal(false);
    load();
  }

  async function remove(id: string) {
    if (!token || !canManage) return;
    if (!confirm('Remove this allocation?')) return;
    await resourcesApi.deleteAllocation(id, token);
    load();
  }

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Allocations</h1>
          <p className="text-[13px] text-[color:var(--text-muted)]">Assign people to projects with % commitment and dates.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-[color:var(--text-muted)] flex items-center gap-2">
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
            Active only
          </label>
          {canManage && (
            <button type="button" className="btn-primary px-3 py-1.5 rounded-lg text-sm" onClick={() => setModal(true)}>
              Add allocation
            </button>
          )}
        </div>
      </div>
      {conflictHint && <p className="text-xs text-amber-400">{conflictHint}</p>}
      {loading ? (
        <p className="text-sm text-[color:var(--text-muted)]">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[color:var(--border-subtle)] p-8 text-center text-sm text-[color:var(--text-muted)]">
          No allocations yet. {canManage ? 'Add one to start planning capacity.' : ''}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[color:var(--border-subtle)] text-left text-[color:var(--text-muted)]">
                <th className="px-4 py-3 font-medium">Person</th>
                <th className="px-4 py-3 font-medium">Project</th>
                <th className="px-4 py-3 font-medium">%</th>
                <th className="px-4 py-3 font-medium">Dates</th>
                <th className="px-4 py-3 font-medium">Flags</th>
                {canManage && <th className="px-4 py-3 font-medium text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} className="border-b border-[color:var(--border-subtle)]/60">
                  <td className="px-4 py-3">
                    <div className="font-medium">{nameOf(r.userId as { name?: string; email?: string })}</div>
                    {r.roleLabel && <div className="text-[11px] text-[color:var(--text-muted)]">{r.roleLabel}</div>}
                  </td>
                  <td className="px-4 py-3">{nameOf(r.projectId as { name?: string; key?: string })}</td>
                  <td className="px-4 py-3 tabular-nums">{r.percent}%</td>
                  <td className="px-4 py-3 text-[color:var(--text-muted)]">
                    {fmtDate(r.startDate)} → {fmtDate(r.endDate)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {r.billable ? (
                        <span className="rounded px-1.5 py-0.5 text-[10px] bg-emerald-500/15 text-emerald-400">billable</span>
                      ) : (
                        <span className="rounded px-1.5 py-0.5 text-[10px] bg-[color:var(--bg-elevated)] text-[color:var(--text-muted)]">non-billable</span>
                      )}
                      {r.softBooked && (
                        <span className="rounded px-1.5 py-0.5 text-[10px] bg-amber-500/15 text-amber-400">soft</span>
                      )}
                    </div>
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <button type="button" className="text-xs text-red-400 hover:underline" onClick={() => void remove(r._id)}>
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setModal(false)}>
            <div
              className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl max-w-lg w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-semibold mb-4">Add allocation</h2>
              <form onSubmit={submit} className="space-y-3">
                {error && <p className="text-sm text-red-400">{error}</p>}
                <label className="block text-xs space-y-1">
                  <span className="text-[color:var(--text-muted)]">Person</span>
                  <select
                    required
                    value={form.userId}
                    onChange={(e) => setForm((f) => ({ ...f, userId: e.target.value }))}
                    className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                  >
                    <option value="">Select…</option>
                    {options.users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs space-y-1">
                  <span className="text-[color:var(--text-muted)]">Project</span>
                  <select
                    required
                    value={form.projectId}
                    onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}
                    className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                  >
                    <option value="">Select…</option>
                    {options.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.key} · {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs space-y-1">
                    <span className="text-[color:var(--text-muted)]">Percent</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      required
                      value={form.percent}
                      onChange={(e) => setForm((f) => ({ ...f, percent: Number(e.target.value) }))}
                      className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-xs space-y-1">
                    <span className="text-[color:var(--text-muted)]">Role label</span>
                    <input
                      value={form.roleLabel}
                      onChange={(e) => setForm((f) => ({ ...f, roleLabel: e.target.value }))}
                      className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                      placeholder="e.g. Backend"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs space-y-1">
                    <span className="text-[color:var(--text-muted)]">Start</span>
                    <input
                      type="date"
                      required
                      value={form.startDate}
                      onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                      className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-xs space-y-1">
                    <span className="text-[color:var(--text-muted)]">End (optional)</span>
                    <input
                      type="date"
                      value={form.endDate}
                      onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                      className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                    />
                  </label>
                </div>
                <div className="flex gap-4 text-xs">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={form.billable} onChange={(e) => setForm((f) => ({ ...f, billable: e.target.checked }))} />
                    Billable
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={form.softBooked} onChange={(e) => setForm((f) => ({ ...f, softBooked: e.target.checked }))} />
                    Soft booking
                  </label>
                </div>
                <label className="block text-xs space-y-1">
                  <span className="text-[color:var(--text-muted)]">Notes</span>
                  <textarea
                    rows={2}
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                  />
                </label>
                <div className="flex gap-2 pt-2">
                  <button type="submit" className="btn-primary px-4 py-2 rounded-lg text-sm">
                    Save
                  </button>
                  <button type="button" className="px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm" onClick={() => setModal(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

/* ─── Utilization ─────────────────────────────────────────────────────────── */

export function ResourcesUtilization() {
  const { token } = useAuth();
  const [data, setData] = useState<{
    summary: { teamSize: number; avgLoggedUtilization: number; overAllocated: number; underUtilized: number };
    people: Array<{
      userId: string;
      name: string;
      email: string;
      capacityHours: number;
      plannedPercent: number;
      billablePercent: number;
      plannedHours: number;
      loggedHours: number;
      utilizationPct: number;
      overAllocated: boolean;
      skills: string[];
      department?: string;
    }>;
    from: string;
    to: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    resourcesApi.utilization(token).then((res) => {
      setLoading(false);
      if (res.success && res.data) setData(res.data as typeof data);
    });
  }, [token]);

  if (loading) return <div className="p-8 text-[color:var(--text-muted)]">Loading utilization…</div>;
  if (!data) return <div className="p-8 text-red-400">Failed to load utilization.</div>;

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Utilization</h1>
        <p className="text-[13px] text-[color:var(--text-muted)]">
          Planned allocation vs logged hours ({fmtDate(data.from)} – {fmtDate(data.to)}).
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: 'Team', value: data.summary.teamSize },
          { label: 'Avg logged util.', value: `${data.summary.avgLoggedUtilization}%` },
          { label: 'Over-allocated', value: data.summary.overAllocated },
          { label: 'Under 50% planned', value: data.summary.underUtilized },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4">
            <p className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">{c.label}</p>
            <p className="text-xl font-semibold mt-1">{c.value}</p>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[color:var(--border-subtle)] text-left text-[color:var(--text-muted)]">
              <th className="px-4 py-3 font-medium">Person</th>
              <th className="px-4 py-3 font-medium">Planned %</th>
              <th className="px-4 py-3 font-medium">Billable %</th>
              <th className="px-4 py-3 font-medium">Capacity h</th>
              <th className="px-4 py-3 font-medium">Logged h</th>
              <th className="px-4 py-3 font-medium">Logged util.</th>
            </tr>
          </thead>
          <tbody>
            {data.people.map((p) => (
              <tr key={p.userId} className="border-b border-[color:var(--border-subtle)]/60">
                <td className="px-4 py-3">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-[11px] text-[color:var(--text-muted)]">{p.department || p.email}</div>
                </td>
                <td className={`px-4 py-3 tabular-nums ${p.overAllocated ? 'text-amber-400' : ''}`}>{p.plannedPercent}%</td>
                <td className="px-4 py-3 tabular-nums">{p.billablePercent}%</td>
                <td className="px-4 py-3 tabular-nums">{p.capacityHours}</td>
                <td className="px-4 py-3 tabular-nums">{p.loggedHours}</td>
                <td className="px-4 py-3 tabular-nums">{p.utilizationPct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Bench ───────────────────────────────────────────────────────────────── */

export function ResourcesBench() {
  const { token } = useAuth();
  const [data, setData] = useState<{
    available: Array<{
      userId: string;
      name: string;
      email: string;
      availablePercent: number;
      committedPercent: number;
      skills: string[];
      department?: string;
      location?: string;
      capacityHoursPerWeek: number;
      projects: Array<{ name?: string; key?: string; percent: number }>;
    }>;
    freeingSoon: Array<{
      allocationId: string;
      user: { name?: string } | string;
      project: { name?: string; key?: string } | string;
      percent: number;
      endDate?: string;
    }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [skillFilter, setSkillFilter] = useState('');

  useEffect(() => {
    if (!token) return;
    resourcesApi.bench(token).then((res) => {
      setLoading(false);
      if (res.success && res.data) setData(res.data as typeof data);
    });
  }, [token]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = skillFilter.trim().toLowerCase();
    if (!q) return data.available;
    return data.available.filter((p) => p.skills.some((s) => s.toLowerCase().includes(q)));
  }, [data, skillFilter]);

  if (loading) return <div className="p-8 text-[color:var(--text-muted)]">Loading bench…</div>;
  if (!data) return <div className="p-8 text-red-400">Failed to load bench.</div>;

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Bench</h1>
          <p className="text-[13px] text-[color:var(--text-muted)]">People with free capacity and allocations ending soon.</p>
        </div>
        <input
          type="search"
          placeholder="Filter by skill…"
          value={skillFilter}
          onChange={(e) => setSkillFilter(e.target.value)}
          className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm max-w-xs w-full"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.length === 0 ? (
          <p className="text-sm text-[color:var(--text-muted)] col-span-full">No matching bench capacity.</p>
        ) : (
          filtered.map((p) => (
            <div key={p.userId} className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4">
              <div className="flex justify-between gap-2">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-[11px] text-[color:var(--text-muted)]">{p.department || p.location || p.email}</p>
                </div>
                <p className="text-lg font-semibold text-[color:var(--accent)] tabular-nums">{p.availablePercent}%</p>
              </div>
              <p className="mt-2 text-[11px] text-[color:var(--text-muted)]">
                Committed {p.committedPercent}% · {p.capacityHoursPerWeek}h/week
              </p>
              {p.skills.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.skills.map((s) => (
                    <span key={s} className="rounded px-1.5 py-0.5 text-[10px] bg-[color:var(--bg-elevated)]">
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div>
        <h2 className="font-medium mb-3">Freeing in next 30 days</h2>
        {data.freeingSoon.length === 0 ? (
          <p className="text-sm text-[color:var(--text-muted)]">No allocations ending soon.</p>
        ) : (
          <ul className="space-y-2">
            {data.freeingSoon.map((f) => (
              <li
                key={f.allocationId}
                className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-4 py-3 text-sm flex flex-wrap justify-between gap-2"
              >
                <span>
                  {nameOf(f.user as { name?: string })} · {nameOf(f.project as { name?: string; key?: string })} · {f.percent}%
                </span>
                <span className="text-[color:var(--text-muted)]">ends {fmtDate(f.endDate)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ─── Forecast ────────────────────────────────────────────────────────────── */

export function ResourcesForecast() {
  const { token, user } = useAuth();
  const canManage = canAny(user, 'taskflow.resources.forecast.manage');
  const [forecast, setForecast] = useState<{
    supply: { teamSize: number; totalCapacityHours: number; avgCommittedPercent: number; availableHours: number };
    demand: { openCount: number; hoursNeeded: number; items: ResourceDemand[] };
    gapHours: number;
    shortfall: boolean;
  } | null>(null);
  const [demands, setDemands] = useState<ResourceDemand[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [error, setError] = useState('');
  const [options, setOptions] = useState<{ projects: Array<{ id: string; name: string; key: string }> }>({ projects: [] });
  const [form, setForm] = useState({
    title: '',
    projectId: '',
    roleLabel: '',
    hoursNeeded: 40,
    periodStart: toInputDate(new Date().toISOString()),
    periodEnd: toInputDate(new Date(Date.now() + 30 * 86400000).toISOString()),
    priority: 'medium',
    skills: '',
    notes: '',
  });

  function load() {
    if (!token) return;
    setLoading(true);
    Promise.all([resourcesApi.forecast(token), resourcesApi.listDemands(token)]).then(([f, d]) => {
      setLoading(false);
      if (f.success && f.data) setForecast(f.data as typeof forecast);
      if (d.success && d.data) setDemands(Array.isArray(d.data) ? d.data : []);
    });
  }

  useEffect(() => {
    load();
  }, [token]);

  useEffect(() => {
    if (!token || !canManage) return;
    resourcesApi.options(token).then((res) => {
      if (res.success && res.data) setOptions({ projects: res.data.projects });
    });
  }, [token, canManage]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError('');
    const res = await resourcesApi.createDemand(
      {
        ...form,
        projectId: form.projectId || null,
        hoursNeeded: Number(form.hoursNeeded),
        skills: form.skills
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      },
      token
    );
    if (!res.success) {
      setError((res as { message?: string }).message ?? 'Failed');
      return;
    }
    setModal(false);
    load();
  }

  async function setStatus(id: string, status: string) {
    if (!token || !canManage) return;
    await resourcesApi.updateDemand(id, { status }, token);
    load();
  }

  async function remove(id: string) {
    if (!token || !canManage) return;
    if (!confirm('Delete this demand?')) return;
    await resourcesApi.deleteDemand(id, token);
    load();
  }

  if (loading) return <div className="p-8 text-[color:var(--text-muted)]">Loading forecast…</div>;

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Forecast</h1>
          <p className="text-[13px] text-[color:var(--text-muted)]">90-day demand vs available supply.</p>
        </div>
        {canManage && (
          <button type="button" className="btn-primary px-3 py-1.5 rounded-lg text-sm" onClick={() => setModal(true)}>
            Add demand
          </button>
        )}
      </div>

      {forecast && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Available hours', value: forecast.supply.availableHours },
            { label: 'Demand hours', value: forecast.demand.hoursNeeded },
            { label: 'Gap (demand − supply)', value: forecast.gapHours },
            { label: 'Status', value: forecast.shortfall ? 'Shortfall' : 'Covered' },
          ].map((c) => (
            <div key={c.label} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4">
              <p className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">{c.label}</p>
              <p className={`text-xl font-semibold mt-1 ${c.label === 'Status' && forecast.shortfall ? 'text-amber-400' : ''}`}>
                {c.value}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[color:var(--border-subtle)] text-left text-[color:var(--text-muted)]">
              <th className="px-4 py-3 font-medium">Demand</th>
              <th className="px-4 py-3 font-medium">Hours</th>
              <th className="px-4 py-3 font-medium">Period</th>
              <th className="px-4 py-3 font-medium">Priority</th>
              <th className="px-4 py-3 font-medium">Status</th>
              {canManage && <th className="px-4 py-3 font-medium text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {demands.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[color:var(--text-muted)]">
                  No staffing demands yet.
                </td>
              </tr>
            ) : (
              demands.map((d) => (
                <tr key={d._id} className="border-b border-[color:var(--border-subtle)]/60">
                  <td className="px-4 py-3">
                    <div className="font-medium">{d.title}</div>
                    <div className="text-[11px] text-[color:var(--text-muted)]">
                      {d.roleLabel || 'Any role'}
                      {d.projectId ? ` · ${nameOf(d.projectId as { name?: string; key?: string })}` : ''}
                    </div>
                    {d.skills?.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {d.skills.map((s) => (
                          <span key={s} className="rounded px-1.5 py-0.5 text-[10px] bg-[color:var(--bg-elevated)]">
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{d.hoursNeeded}</td>
                  <td className="px-4 py-3 text-[color:var(--text-muted)]">
                    {fmtDate(d.periodStart)} → {fmtDate(d.periodEnd)}
                  </td>
                  <td className="px-4 py-3 capitalize">{d.priority}</td>
                  <td className="px-4 py-3">{d.status.replace('_', ' ')}</td>
                  {canManage && (
                    <td className="px-4 py-3 text-right space-x-2">
                      {d.status !== 'filled' && (
                        <button type="button" className="text-xs text-[color:var(--accent)] hover:underline" onClick={() => void setStatus(d._id, 'filled')}>
                          Mark filled
                        </button>
                      )}
                      <button type="button" className="text-xs text-red-400 hover:underline" onClick={() => void remove(d._id)}>
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modal &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setModal(false)}>
            <div
              className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl max-w-lg w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-semibold mb-4">Add demand</h2>
              <form onSubmit={submit} className="space-y-3">
                {error && <p className="text-sm text-red-400">{error}</p>}
                <label className="block text-xs space-y-1">
                  <span className="text-[color:var(--text-muted)]">Title</span>
                  <input
                    required
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs space-y-1">
                  <span className="text-[color:var(--text-muted)]">Project (optional)</span>
                  <select
                    value={form.projectId}
                    onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}
                    className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                  >
                    <option value="">None</option>
                    {options.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.key} · {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs space-y-1">
                    <span className="text-[color:var(--text-muted)]">Hours needed</span>
                    <input
                      type="number"
                      min={0}
                      required
                      value={form.hoursNeeded}
                      onChange={(e) => setForm((f) => ({ ...f, hoursNeeded: Number(e.target.value) }))}
                      className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-xs space-y-1">
                    <span className="text-[color:var(--text-muted)]">Priority</span>
                    <select
                      value={form.priority}
                      onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                      className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                    >
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                      <option value="critical">critical</option>
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs space-y-1">
                    <span className="text-[color:var(--text-muted)]">Period start</span>
                    <input
                      type="date"
                      required
                      value={form.periodStart}
                      onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))}
                      className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-xs space-y-1">
                    <span className="text-[color:var(--text-muted)]">Period end</span>
                    <input
                      type="date"
                      required
                      value={form.periodEnd}
                      onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))}
                      className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                    />
                  </label>
                </div>
                <label className="block text-xs space-y-1">
                  <span className="text-[color:var(--text-muted)]">Role</span>
                  <input
                    value={form.roleLabel}
                    onChange={(e) => setForm((f) => ({ ...f, roleLabel: e.target.value }))}
                    className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs space-y-1">
                  <span className="text-[color:var(--text-muted)]">Skills (comma-separated)</span>
                  <input
                    value={form.skills}
                    onChange={(e) => setForm((f) => ({ ...f, skills: e.target.value }))}
                    className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                    placeholder="React, Node, AWS"
                  />
                </label>
                <div className="flex gap-2 pt-2">
                  <button type="submit" className="btn-primary px-4 py-2 rounded-lg text-sm">
                    Save
                  </button>
                  <button type="button" className="px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm" onClick={() => setModal(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

/* ─── Conflicts ───────────────────────────────────────────────────────────── */

export function ResourcesConflicts() {
  const { token } = useAuth();
  const [data, setData] = useState<{
    count: number;
    conflicts: Array<{
      userId: string;
      userName: string;
      userEmail?: string;
      totalPercent: number;
      allocations: ResourceAllocation[];
    }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    resourcesApi.conflicts(token).then((res) => {
      setLoading(false);
      if (res.success && res.data) setData(res.data as typeof data);
    });
  }, [token]);

  if (loading) return <div className="p-8 text-[color:var(--text-muted)]">Loading conflicts…</div>;
  if (!data) return <div className="p-8 text-red-400">Failed to load conflicts.</div>;

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Over-allocation conflicts</h1>
        <p className="text-[13px] text-[color:var(--text-muted)]">
          People whose hard bookings exceed 100% right now ({data.count} conflict{data.count === 1 ? '' : 's'}).
        </p>
      </div>
      {data.conflicts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[color:var(--border-subtle)] p-8 text-center text-sm text-[color:var(--text-muted)]">
          No over-allocations detected.
        </div>
      ) : (
        <div className="space-y-3">
          {data.conflicts.map((c) => (
            <div key={c.userId} className="rounded-2xl border border-amber-500/30 bg-[color:var(--bg-surface)] p-4">
              <div className="flex justify-between gap-2 mb-2">
                <div>
                  <p className="font-medium">{c.userName}</p>
                  <p className="text-[11px] text-[color:var(--text-muted)]">{c.userEmail}</p>
                </div>
                <p className="text-lg font-semibold text-amber-400 tabular-nums">{c.totalPercent}%</p>
              </div>
              <ul className="text-sm space-y-1 text-[color:var(--text-muted)]">
                {c.allocations.map((a) => (
                  <li key={a._id}>
                    {nameOf(a.projectId as { name?: string; key?: string })} — {a.percent}%
                    {a.roleLabel ? ` (${a.roleLabel})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Team / profiles ─────────────────────────────────────────────────────── */

export function ResourcesTeam() {
  const { token, user } = useAuth();
  const canManage = canAny(user, 'taskflow.resources.allocation.manage');
  const [rows, setRows] = useState<ResourceProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ResourceProfileRow | null>(null);
  const [form, setForm] = useState({
    capacityHoursPerWeek: 40,
    skills: '',
    seniority: '',
    department: '',
    location: '',
    notes: '',
  });
  const [error, setError] = useState('');

  function load() {
    if (!token) return;
    setLoading(true);
    resourcesApi.listProfiles(token).then((res) => {
      setLoading(false);
      if (res.success && res.data) setRows(Array.isArray(res.data) ? res.data : []);
    });
  }

  useEffect(() => {
    load();
  }, [token]);

  function openEdit(row: ResourceProfileRow) {
    setEditing(row);
    setForm({
      capacityHoursPerWeek: row.capacityHoursPerWeek,
      skills: row.skills.join(', '),
      seniority: row.seniority ?? '',
      department: row.department ?? '',
      location: row.location ?? '',
      notes: row.notes ?? '',
    });
    setError('');
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !editing) return;
    const res = await resourcesApi.upsertProfile(
      {
        userId: editing.userId,
        capacityHoursPerWeek: Number(form.capacityHoursPerWeek),
        skills: form.skills
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        seniority: form.seniority,
        department: form.department,
        location: form.location,
        notes: form.notes,
      },
      token
    );
    if (!res.success) {
      setError((res as { message?: string }).message ?? 'Failed');
      return;
    }
    setEditing(null);
    load();
  }

  if (loading) return <div className="p-8 text-[color:var(--text-muted)]">Loading team…</div>;

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Team capacity</h1>
        <p className="text-[13px] text-[color:var(--text-muted)]">Skills, weekly capacity, and department for staffing.</p>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[color:var(--border-subtle)] text-left text-[color:var(--text-muted)]">
              <th className="px-4 py-3 font-medium">Person</th>
              <th className="px-4 py-3 font-medium">Capacity</th>
              <th className="px-4 py-3 font-medium">Department</th>
              <th className="px-4 py-3 font-medium">Skills</th>
              {canManage && <th className="px-4 py-3 font-medium text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId} className="border-b border-[color:var(--border-subtle)]/60">
                <td className="px-4 py-3">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-[11px] text-[color:var(--text-muted)]">{r.email}</div>
                </td>
                <td className="px-4 py-3 tabular-nums">{r.capacityHoursPerWeek}h/wk</td>
                <td className="px-4 py-3">{r.department || r.seniority || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {r.skills.length === 0 ? (
                      <span className="text-[color:var(--text-muted)]">—</span>
                    ) : (
                      r.skills.map((s) => (
                        <span key={s} className="rounded px-1.5 py-0.5 text-[10px] bg-[color:var(--bg-elevated)]">
                          {s}
                        </span>
                      ))
                    )}
                  </div>
                </td>
                {canManage && (
                  <td className="px-4 py-3 text-right">
                    <button type="button" className="text-xs text-[color:var(--accent)] hover:underline" onClick={() => openEdit(r)}>
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setEditing(null)}>
            <div
              className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl max-w-lg w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-semibold mb-1">Edit profile</h2>
              <p className="text-xs text-[color:var(--text-muted)] mb-4">{editing.name}</p>
              <form onSubmit={save} className="space-y-3">
                {error && <p className="text-sm text-red-400">{error}</p>}
                <label className="block text-xs space-y-1">
                  <span className="text-[color:var(--text-muted)]">Hours / week</span>
                  <input
                    type="number"
                    min={1}
                    max={168}
                    value={form.capacityHoursPerWeek}
                    onChange={(e) => setForm((f) => ({ ...f, capacityHoursPerWeek: Number(e.target.value) }))}
                    className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs space-y-1">
                  <span className="text-[color:var(--text-muted)]">Skills (comma-separated)</span>
                  <input
                    value={form.skills}
                    onChange={(e) => setForm((f) => ({ ...f, skills: e.target.value }))}
                    className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs space-y-1">
                    <span className="text-[color:var(--text-muted)]">Department</span>
                    <input
                      value={form.department}
                      onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                      className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-xs space-y-1">
                    <span className="text-[color:var(--text-muted)]">Seniority</span>
                    <input
                      value={form.seniority}
                      onChange={(e) => setForm((f) => ({ ...f, seniority: e.target.value }))}
                      className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                    />
                  </label>
                </div>
                <label className="block text-xs space-y-1">
                  <span className="text-[color:var(--text-muted)]">Location</span>
                  <input
                    value={form.location}
                    onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                    className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                  />
                </label>
                <div className="flex gap-2 pt-2">
                  <button type="submit" className="btn-primary px-4 py-2 rounded-lg text-sm">
                    Save
                  </button>
                  <button type="button" className="px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
