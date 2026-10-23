import { useCallback, useEffect, useMemo, useState } from 'react';
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { FiEdit2, FiPlus, FiTrash2, FiUserPlus } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import ConfirmModal from '../../components/ConfirmModal';
import SectionCard from '../../components/SectionCard';
import { chartTooltipProps, getChartColor } from '../../lib/chartTheme';
import { resourcesApi, type DemandCandidate, type ResourceDemand, type ResourceWeekRow } from '../../lib/api';
import {
  Chip,
  EmptyState,
  ErrorBanner,
  Field,
  LoadBar,
  LoadingBlock,
  Modal,
  PageShell,
  Segmented,
  Stat,
  Toast,
  addDaysKey,
  btnPrimary,
  btnSecondary,
  errorOf,
  fmtShort,
  inputCls,
  refKey,
  refName,
  todayKey,
  toInputDate,
  useResourceOptions,
} from './resourceKit';

interface ForecastReport {
  horizonWeeks: number;
  from: string;
  to: string;
  supply: { teamSize: number; totalCapacityHours: number; committedHours: number; avgCommittedPercent: number; availableHours: number };
  demand: { openCount: number; hoursNeeded: number; unfilledHours: number; items: ResourceDemand[] };
  weeks: ResourceWeekRow[];
  skillCoverage: Array<{ skill: string; demandHours: number; demands: number; people: number }>;
  gapHours: number;
  shortfall: boolean;
  shortWeeks: number;
}

type StatusFilter = 'active' | 'filled' | 'cancelled' | 'all';

const PRIORITY_TONE: Record<ResourceDemand['priority'], 'bad' | 'warn' | 'info' | 'neutral'> = {
  critical: 'bad',
  high: 'warn',
  medium: 'info',
  low: 'neutral',
};

const STATUS_LABEL: Record<ResourceDemand['status'], string> = {
  open: 'Open',
  partially_filled: 'Partly filled',
  filled: 'Filled',
  cancelled: 'Cancelled',
};

interface DemandForm {
  id?: string;
  title: string;
  projectId: string;
  roleLabel: string;
  hoursNeeded: number;
  periodStart: string;
  periodEnd: string;
  priority: ResourceDemand['priority'];
  skills: string;
  notes: string;
}

function blankDemand(): DemandForm {
  const start = todayKey();
  return { title: '', projectId: '', roleLabel: '', hoursNeeded: 80, periodStart: start, periodEnd: addDaysKey(start, 29), priority: 'medium', skills: '', notes: '' };
}

export default function ResourcesForecast() {
  const { token, user } = useAuth();
  const canManage = canAny(user, 'taskflow.resources.forecast.manage');
  const canBook = canAny(user, 'taskflow.resources.allocation.manage');
  const workspaceKey = user?.activeOrganizationId ?? '';
  const { options, reloadOptions } = useResourceOptions(token, workspaceKey);
  const [forecast, setForecast] = useState<ForecastReport | null>(null);
  const [demands, setDemands] = useState<ResourceDemand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [form, setForm] = useState<DemandForm | null>(null);
  const [staffing, setStaffing] = useState<ResourceDemand | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ResourceDemand | null>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([resourcesApi.forecast(token), resourcesApi.listDemands(token)]).then(([f, d]) => {
      setLoading(false);
      if (f.success && f.data) {
        setForecast(f.data as ForecastReport);
        setError('');
      } else setError(errorOf(f, 'Failed to load forecast'));
      if (d.success && d.data) setDemands(Array.isArray(d.data) ? d.data : []);
    });
  }, [token]);

  useEffect(() => {
    load();
  }, [load, workspaceKey]);

  const counts = useMemo(() => {
    const c = { active: 0, filled: 0, cancelled: 0, all: demands.length };
    demands.forEach((d) => {
      if (d.status === 'open' || d.status === 'partially_filled') c.active += 1;
      else c[d.status] += 1;
    });
    return c;
  }, [demands]);

  const shown = useMemo(
    () =>
      demands.filter((d) =>
        status === 'all' ? true : status === 'active' ? d.status === 'open' || d.status === 'partially_filled' : d.status === status
      ),
    [demands, status]
  );

  const chartData = useMemo(
    () => (forecast?.weeks ?? []).map((w) => ({ ...w, label: fmtShort(w.weekStart), shortfall: Math.max(0, w.gapHours) })),
    [forecast]
  );

  async function setDemandStatus(d: ResourceDemand, next: ResourceDemand['status']) {
    if (!token) return;
    const res = await resourcesApi.updateDemand(d._id, { status: next }, token);
    setToast(res.success ? `Demand marked ${STATUS_LABEL[next].toLowerCase()}.` : errorOf(res, 'Update failed'));
    load();
  }

  async function remove(d: ResourceDemand) {
    if (!token) return;
    setConfirmDelete(null);
    const res = await resourcesApi.deleteDemand(d._id, token);
    setToast(res.success ? 'Demand deleted.' : errorOf(res, 'Delete failed'));
    load();
    reloadOptions();
  }

  function edit(d: ResourceDemand) {
    setForm({
      id: d._id,
      title: d.title,
      projectId: refKey(d.projectId as never),
      roleLabel: d.roleLabel ?? '',
      hoursNeeded: d.hoursNeeded,
      periodStart: toInputDate(d.periodStart),
      periodEnd: toInputDate(d.periodEnd),
      priority: d.priority,
      skills: d.skills.join(', '),
      notes: d.notes ?? '',
    });
  }

  return (
    <PageShell
      title="Forecast"
      description={
        forecast
          ? `Supply against open demand for the next ${forecast.horizonWeeks} weeks (${fmtShort(forecast.from)} – ${fmtShort(forecast.to)}).`
          : 'Supply against open demand in the weeks ahead.'
      }
      actions={
        canManage && (
          <button type="button" className={btnPrimary} onClick={() => setForm(blankDemand())}>
            <FiPlus /> New demand
          </button>
        )
      }
    >
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!forecast ? (
        loading && <LoadingBlock label="Loading forecast…" />
      ) : (
        <div className={`space-y-5 ${loading ? 'opacity-60' : ''}`}>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Stat label="Team" value={forecast.supply.teamSize} hint={`${forecast.supply.totalCapacityHours.toLocaleString()}h capacity`} />
            <Stat label="Committed" value={`${forecast.supply.avgCommittedPercent}%`} hint={`${forecast.supply.committedHours.toLocaleString()}h booked`} />
            <Stat label="Available" value={`${forecast.supply.availableHours.toLocaleString()}h`} tone="good" />
            <Stat label="Open demand" value={forecast.demand.openCount} hint={`${forecast.demand.unfilledHours.toLocaleString()}h unfilled`} />
            <Stat
              label={forecast.shortfall ? 'Shortfall' : 'Surplus'}
              value={`${Math.abs(forecast.gapHours).toLocaleString()}h`}
              tone={forecast.shortfall ? 'bad' : 'good'}
            />
            <Stat label="Short weeks" value={forecast.shortWeeks} tone={forecast.shortWeeks ? 'warn' : undefined} hint="demand > free hours" />
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <SectionCard className="xl:col-span-2" title="Week by week" description="Booked and free hours against the demand still to fill.">
              {chartData.length === 0 ? (
                <EmptyState title="No weeks in horizon" />
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                      <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" unit="h" />
                      <Tooltip {...chartTooltipProps} formatter={(v) => [`${Number(v ?? 0).toLocaleString()}h`]} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="committedHours" name="Booked" stackId="s" fill={getChartColor(0)} />
                      <Bar dataKey="availableHours" name="Free" stackId="s" fill={getChartColor(2)} radius={[4, 4, 0, 0]} />
                      <Area dataKey="demandHours" name="Demand" type="monotone" stroke={getChartColor(3)} fill={getChartColor(3)} fillOpacity={0.15} />
                      <Line dataKey="shortfall" name="Shortfall" type="monotone" stroke="#ef4444" strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </SectionCard>
            <SectionCard title="Skills in demand" description="Open demand per skill vs people with room.">
              {forecast.skillCoverage.length === 0 ? (
                <EmptyState title="No skills requested">Add skills to demands to see coverage.</EmptyState>
              ) : (
                <ul className="space-y-2 text-sm">
                  {forecast.skillCoverage.slice(0, 12).map((s) => (
                    <li key={s.skill} className="flex items-center justify-between gap-2">
                      <span className="truncate">{s.skill}</span>
                      <span className="flex items-center gap-2 text-xs tabular-nums">
                        <span className="text-[color:var(--text-muted)]">{s.demandHours}h</span>
                        <Chip tone={s.people === 0 ? 'bad' : s.people === 1 ? 'warn' : 'good'}>
                          {s.people} with room
                        </Chip>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>

          <SectionCard
            title="Demands"
            description="Roles and hours projects need. Staff them to turn demand into allocations."
            actions={
              <Segmented
                size="xs"
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'active', label: 'Open', count: counts.active },
                  { value: 'filled', label: 'Filled', count: counts.filled },
                  { value: 'cancelled', label: 'Cancelled', count: counts.cancelled },
                  { value: 'all', label: 'All', count: counts.all },
                ]}
              />
            }
          >
            {shown.length === 0 ? (
              <EmptyState title="No demands here">{canManage && status === 'active' && 'Add a demand when a project needs people.'}</EmptyState>
            ) : (
              <div className="space-y-3">
                {shown.map((d) => (
                  <div key={d._id} className="rounded-xl border border-[color:var(--border-subtle)] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{d.title}</p>
                          <Chip tone={PRIORITY_TONE[d.priority]}>{d.priority}</Chip>
                          <Chip tone={d.status === 'filled' ? 'good' : d.status === 'cancelled' ? 'neutral' : 'accent'}>{STATUS_LABEL[d.status]}</Chip>
                        </div>
                        <p className="text-xs text-[color:var(--text-muted)] mt-0.5">
                          {d.projectId ? refName(d.projectId as never) : 'No project yet'}
                          {d.roleLabel ? ` · ${d.roleLabel}` : ''} · {fmtShort(toInputDate(d.periodStart))} – {fmtShort(toInputDate(d.periodEnd))}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 text-xs">
                        {canBook && d.status !== 'cancelled' && d.status !== 'filled' && (
                          <button type="button" className={btnSecondary} onClick={() => setStaffing(d)}>
                            <FiUserPlus /> Find people
                          </button>
                        )}
                        {canManage && (
                          <>
                            <button type="button" className="p-1.5 rounded-md hover:bg-[color:var(--bg-elevated)]" title="Edit" aria-label="Edit" onClick={() => edit(d)}>
                              <FiEdit2 />
                            </button>
                            <button
                              type="button"
                              className="p-1.5 rounded-md hover:bg-[color:var(--bg-elevated)] hover:text-red-400"
                              title="Delete"
                              aria-label="Delete"
                              onClick={() => setConfirmDelete(d)}
                            >
                              <FiTrash2 />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <div className="flex-1 min-w-[10rem]">
                        <div className="h-2 rounded-full bg-[color:var(--bg-elevated)] overflow-hidden">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${d.fillPct ?? 0}%` }} />
                        </div>
                      </div>
                      <span className="text-xs tabular-nums text-[color:var(--text-muted)]">
                        {d.fulfilledHours ?? 0}h of {d.hoursNeeded}h · {d.remainingHours ?? d.hoursNeeded}h left
                      </span>
                    </div>
                    {(d.skills.length > 0 || (d.assignees?.length ?? 0) > 0) && (
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        {d.skills.map((s) => (
                          <Chip key={s}>{s}</Chip>
                        ))}
                        {d.assignees?.map((a) => (
                          <Chip key={a.allocationId} tone="good">
                            {a.name ?? 'Someone'} {a.percent}%{a.softBooked ? ' (soft)' : ''}
                          </Chip>
                        ))}
                      </div>
                    )}
                    {canManage && (
                      <div className="mt-2 flex gap-3 text-[11px]">
                        {d.status !== 'cancelled' ? (
                          <button type="button" className="text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]" onClick={() => void setDemandStatus(d, 'cancelled')}>
                            Cancel demand
                          </button>
                        ) : (
                          <button type="button" className="text-[color:var(--accent)] hover:underline" onClick={() => void setDemandStatus(d, 'open')}>
                            Reopen
                          </button>
                        )}
                        {d.status !== 'filled' && d.status !== 'cancelled' && (
                          <button type="button" className="text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]" onClick={() => void setDemandStatus(d, 'filled')}>
                            Mark filled
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {token && (
        <DemandModal
          form={form}
          projects={options.projects}
          token={token}
          onClose={() => setForm(null)}
          onSaved={(m) => {
            setForm(null);
            setToast(m);
            load();
            reloadOptions();
          }}
        />
      )}
      {token && staffing && (
        <StaffModal
          demand={staffing}
          projects={options.projects}
          settings={options.settings}
          token={token}
          onClose={() => setStaffing(null)}
          onBooked={(m) => {
            setToast(m);
            load();
          }}
        />
      )}
      <ConfirmModal
        open={!!confirmDelete}
        title="Delete demand?"
        message={confirmDelete ? `“${confirmDelete.title}” will be removed. Linked allocations stay but are no longer tied to it. Cancel it instead to keep history.` : ''}
        confirmLabel="Delete"
        onConfirm={() => confirmDelete && void remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
      <Toast message={toast} onDone={() => setToast('')} />
    </PageShell>
  );
}

function DemandModal({
  form: initial,
  projects,
  token,
  onClose,
  onSaved,
}: {
  form: DemandForm | null;
  projects: Array<{ id: string; name: string; key: string }>;
  token: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState<DemandForm>(initial ?? blankDemand());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initial) {
      setForm(initial);
      setError('');
    }
  }, [initial]);

  const set = <K extends keyof DemandForm>(k: K, v: DemandForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.periodEnd < form.periodStart) {
      setError('End must be on or after the start.');
      return;
    }
    setSaving(true);
    setError('');
    const body = {
      title: form.title,
      projectId: form.projectId || null,
      roleLabel: form.roleLabel,
      hoursNeeded: Number(form.hoursNeeded),
      periodStart: form.periodStart,
      periodEnd: form.periodEnd,
      priority: form.priority,
      skills: form.skills
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      notes: form.notes,
    };
    const res = form.id ? await resourcesApi.updateDemand(form.id, body, token) : await resourcesApi.createDemand(body, token);
    setSaving(false);
    if (!res.success) {
      setError(errorOf(res, 'Failed to save demand'));
      return;
    }
    onSaved(form.id ? 'Demand updated.' : 'Demand added.');
  }

  return (
    <Modal open={!!initial} onClose={onClose} title={form.id ? 'Edit demand' : 'New demand'} subtitle="A role or block of hours a project needs filled." width="max-w-xl">
      <form onSubmit={submit} className="space-y-3">
        {error && <ErrorBanner message={error} />}
        <Field label="Title">
          <input required value={form.title} onChange={(e) => set('title', e.target.value)} className={inputCls} placeholder="e.g. Second frontend developer" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Project">
            <select value={form.projectId} onChange={(e) => set('projectId', e.target.value)} className={inputCls}>
              <option value="">Not decided</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.key} · {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Role">
            <input value={form.roleLabel} onChange={(e) => set('roleLabel', e.target.value)} className={inputCls} placeholder="e.g. Frontend" />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Hours needed">
            <input type="number" min={1} required value={form.hoursNeeded} onChange={(e) => set('hoursNeeded', Number(e.target.value))} className={inputCls} />
          </Field>
          <Field label="From">
            <input type="date" required value={form.periodStart} onChange={(e) => set('periodStart', e.target.value)} className={inputCls} />
          </Field>
          <Field label="To">
            <input type="date" required min={form.periodStart} value={form.periodEnd} onChange={(e) => set('periodEnd', e.target.value)} className={inputCls} />
          </Field>
          <Field label="Priority">
            <select value={form.priority} onChange={(e) => set('priority', e.target.value as DemandForm['priority'])} className={inputCls}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </Field>
        </div>
        <Field label="Skills" hint="Comma-separated. Used to rank candidates.">
          <input value={form.skills} onChange={(e) => set('skills', e.target.value)} className={inputCls} placeholder="React, TypeScript" />
        </Field>
        <Field label="Notes">
          <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} className={inputCls} />
        </Field>
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={saving} className={`${btnPrimary} px-4 py-2`}>
            {saving ? 'Saving…' : form.id ? 'Save changes' : 'Add demand'}
          </button>
          <button type="button" className={`${btnSecondary} px-4 py-2`} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function StaffModal({
  demand: initialDemand,
  projects,
  settings,
  token,
  onClose,
  onBooked,
}: {
  demand: ResourceDemand;
  projects: Array<{ id: string; name: string; key: string }>;
  settings: Parameters<typeof LoadBar>[0]['settings'];
  token: string;
  onClose: () => void;
  onBooked: (message: string) => void;
}) {
  const [demand, setDemand] = useState(initialDemand);
  const [data, setData] = useState<{ period: { from: string; to: string; days: number }; candidates: DemandCandidate[] } | null>(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<DemandCandidate | null>(null);
  const [percent, setPercent] = useState(50);
  const [soft, setSoft] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [saving, setSaving] = useState(false);
  const [onlyMatches, setOnlyMatches] = useState(demand.skills.length > 0);

  const load = useCallback(() => {
    resourcesApi.demandCandidates(demand._id, token).then((res) => {
      if (res.success && res.data) {
        setData(res.data);
        setDemand(res.data.demand);
        setError('');
      } else setError(errorOf(res, 'Failed to load candidates'));
    });
  }, [demand._id, token]);

  useEffect(() => {
    load();
  }, [load]);

  function pick(c: DemandCandidate) {
    setPicked(c);
    setPercent(c.suggestedPercent > 0 ? c.suggestedPercent : 25);
    setSoft(false);
  }

  async function book(e: React.FormEvent) {
    e.preventDefault();
    if (!picked) return;
    setSaving(true);
    setError('');
    const res = await resourcesApi.fulfilDemand(
      demand._id,
      { userId: picked.userId, percent, softBooked: soft, projectId: demand.projectId ? undefined : projectId },
      token
    );
    setSaving(false);
    if (!res.success) {
      setError(errorOf(res, 'Booking failed'));
      return;
    }
    const over = res.data?.conflicts?.overAllocated;
    onBooked(`${picked.name} booked at ${percent}%${over ? ` — now peaks at ${res.data!.conflicts.committedPercent}%` : ''}.`);
    setPicked(null);
    load();
  }

  const list = (data?.candidates ?? []).filter((c) => !onlyMatches || c.matchedSkills.length > 0 || c.roleMatch);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Staff: ${demand.title}`}
      subtitle={
        <>
          {demand.remainingHours ?? demand.hoursNeeded}h still needed
          {data && ` · ${fmtShort(data.period.from)} – ${fmtShort(data.period.to)} (${data.period.days} days)`}
        </>
      }
      width="max-w-3xl"
    >
      <div className="space-y-3">
        {error && <ErrorBanner message={error} />}
        {picked ? (
          <form onSubmit={book} className="rounded-xl border border-[color:var(--accent)]/40 bg-[color:var(--accent-subtle)] p-4 space-y-3">
            <p className="text-sm">
              Book <b>{picked.name}</b> for this demand
            </p>
            {!demand.projectId && (
              <Field label="Project (the demand has none)">
                <select required value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputCls}>
                  <option value="">Select…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.key} · {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <div className="flex flex-wrap items-end gap-4">
              <Field label="Share of week">
                <div className="flex items-center gap-1">
                  <input type="number" min={1} max={100} required value={percent} onChange={(e) => setPercent(Number(e.target.value))} className={`${inputCls} w-20`} />
                  <span className="text-xs">%</span>
                </div>
              </Field>
              <label className="flex items-center gap-2 text-xs pb-2">
                <input type="checkbox" checked={soft} onChange={(e) => setSoft(e.target.checked)} />
                Soft booking
              </label>
              <span className="text-[11px] text-[color:var(--text-muted)] pb-2">
                ≈ {Math.round(((picked.capacityHoursPerWeek / 7) * (data?.period.days ?? 0) * percent) / 100)}h over the period
              </span>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className={btnPrimary}>
                {saving ? 'Booking…' : 'Book'}
              </button>
              <button type="button" className={btnSecondary} onClick={() => setPicked(null)}>
                Back
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap gap-1">
                {demand.skills.map((s) => (
                  <Chip key={s} tone="accent">
                    {s}
                  </Chip>
                ))}
                {demand.roleLabel && <Chip>{demand.roleLabel}</Chip>}
              </div>
              {(demand.skills.length > 0 || demand.roleLabel) && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={onlyMatches} onChange={(e) => setOnlyMatches(e.target.checked)} />
                  Only skill or role matches
                </label>
              )}
            </div>
            {!data ? (
              <LoadingBlock label="Ranking people…" />
            ) : list.length === 0 ? (
              <EmptyState title="No matching people">{onlyMatches && 'Untick the filter to see everyone.'}</EmptyState>
            ) : (
              <ul className="divide-y divide-[color:var(--border-subtle)] max-h-[55vh] overflow-y-auto -mx-2">
                {list.map((c) => (
                  <li key={c.userId} className="flex flex-wrap items-center gap-3 px-2 py-2.5">
                    <div
                      className="h-9 w-9 shrink-0 rounded-full grid place-items-center text-xs font-bold tabular-nums"
                      style={{ background: `color-mix(in srgb, ${c.score >= 70 ? '#22c55e' : c.score >= 40 ? '#f59e0b' : '#64748b'} 22%, transparent)` }}
                      title="Match score"
                    >
                      {c.score}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm">
                        {c.name}
                        {c.roleMatch && <span className="ml-1.5 text-[10px] text-emerald-400">role match</span>}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {c.matchedSkills.map((s) => (
                          <Chip key={s} tone="good">
                            {s}
                          </Chip>
                        ))}
                        {c.missingSkills.map((s) => (
                          <Chip key={s} tone="neutral" title="Missing">
                            <s>{s}</s>
                          </Chip>
                        ))}
                        {c.availableFrom && <Chip tone="warn">from {fmtShort(c.availableFrom)}</Chip>}
                      </div>
                    </div>
                    <div className="w-32">
                      <LoadBar hard={c.peakCommittedPercent} settings={settings} />
                      <p className="text-[10px] text-[color:var(--text-muted)] text-right">{c.freeHours}h free in period</p>
                    </div>
                    <button type="button" className={btnSecondary} onClick={() => pick(c)} disabled={c.freeHours <= 0}>
                      Book
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
