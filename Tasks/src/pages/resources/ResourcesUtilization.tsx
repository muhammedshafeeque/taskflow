import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart } from 'recharts';
import { FiDownload } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import SectionCard from '../../components/SectionCard';
import { chartTooltipProps, getChartColor } from '../../lib/chartTheme';
import { downloadCsv } from '../../lib/exportCsv';
import { resourcesApi, type ResourceSettingsRow } from '../../lib/api';
import {
  DEFAULT_SETTINGS,
  EmptyState,
  ErrorBanner,
  LoadBar,
  LoadingBlock,
  PageShell,
  Segmented,
  Stat,
  addDaysKey,
  btnSecondary,
  errorOf,
  fmtDate,
  fmtShort,
  inputCls,
  todayKey,
} from './resourceKit';

interface UtilPerson {
  userId: string;
  name: string;
  email: string;
  department?: string;
  capacityHoursPerWeek: number;
  capacityHours: number;
  plannedPercent: number;
  billablePercent: number;
  plannedHours: number;
  billablePlannedHours: number;
  softHours: number;
  loggedHours: number;
  billableLoggedHours: number;
  utilizationPct: number;
  billableUtilizationPct: number;
  varianceHours: number;
  overAllocated: boolean;
  peakPercent: number;
}

interface UtilReport {
  from: string;
  to: string;
  periodDays: number;
  settings: ResourceSettingsRow;
  departments: string[];
  summary: {
    teamSize: number;
    capacityHours: number;
    plannedHours: number;
    loggedHours: number;
    billableLoggedHours: number;
    avgPlannedUtilization: number;
    avgLoggedUtilization: number;
    billableUtilization: number;
    overAllocated: number;
    underUtilized: number;
    loggedBelowPlan: number;
  };
  weeks: Array<{ weekStart: string; capacityHours: number; plannedHours: number; loggedHours: number; billableHours: number }>;
  byProject: Array<{ projectId: string; name: string; plannedHours: number; loggedHours: number }>;
  people: UtilPerson[];
}

type Preset = 'last30' | 'last90' | 'thisMonth' | 'lastMonth' | 'qtd' | 'next30' | 'custom';

function presetRange(p: Preset, today: string): [string, string] {
  const [y, m] = today.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (p) {
    case 'last90':
      return [addDaysKey(today, -89), today];
    case 'thisMonth':
      return [`${y}-${pad(m)}-01`, today];
    case 'lastMonth': {
      const first = new Date(Date.UTC(y, m - 2, 1));
      const last = new Date(Date.UTC(y, m - 1, 0));
      return [first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)];
    }
    case 'qtd': {
      const qm = Math.floor((m - 1) / 3) * 3 + 1;
      return [`${y}-${pad(qm)}-01`, today];
    }
    case 'next30':
      return [today, addDaysKey(today, 29)];
    default:
      return [addDaysKey(today, -29), today];
  }
}

type SortKey = 'planned' | 'logged' | 'variance' | 'billable' | 'name';

export default function ResourcesUtilization() {
  const { token, user } = useAuth();
  const workspaceKey = user?.activeOrganizationId ?? '';
  const today = todayKey();
  const [preset, setPreset] = useState<Preset>('last30');
  const [range, setRange] = useState<[string, string]>(presetRange('last30', today));
  const [department, setDepartment] = useState('');
  const [sort, setSort] = useState<SortKey>('planned');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<UtilReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    resourcesApi.utilization(token, { from: range[0], to: range[1], department: department || undefined }).then((res) => {
      setLoading(false);
      if (res.success && res.data) {
        setData(res.data as UtilReport);
        setError('');
      } else setError(errorOf(res, 'Failed to load utilization'));
    });
  }, [token, range, department]);

  useEffect(() => {
    load();
  }, [load, workspaceKey]);

  function pickPreset(p: Preset) {
    setPreset(p);
    if (p !== 'custom') setRange(presetRange(p, today));
  }

  const settings = data?.settings ?? DEFAULT_SETTINGS;
  const people = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const rows = data.people.filter((p) => !q || `${p.name} ${p.email} ${p.department ?? ''}`.toLowerCase().includes(q));
    const by: Record<SortKey, (a: UtilPerson, b: UtilPerson) => number> = {
      planned: (a, b) => b.plannedPercent - a.plannedPercent,
      logged: (a, b) => b.utilizationPct - a.utilizationPct,
      variance: (a, b) => a.varianceHours - b.varianceHours,
      billable: (a, b) => b.billableUtilizationPct - a.billableUtilizationPct,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return [...rows].sort(by[sort]);
  }, [data, search, sort]);

  function exportCsv() {
    if (!data) return;
    downloadCsv(`utilization-${data.from}-to-${data.to}`, people, [
      { header: 'Person', value: (p) => p.name },
      { header: 'Email', value: (p) => p.email },
      { header: 'Department', value: (p) => p.department },
      { header: 'Capacity h', value: (p) => p.capacityHours },
      { header: 'Planned %', value: (p) => p.plannedPercent },
      { header: 'Planned h', value: (p) => p.plannedHours },
      { header: 'Soft h', value: (p) => p.softHours },
      { header: 'Logged h', value: (p) => p.loggedHours },
      { header: 'Billable logged h', value: (p) => p.billableLoggedHours },
      { header: 'Logged util %', value: (p) => p.utilizationPct },
      { header: 'Billable util %', value: (p) => p.billableUtilizationPct },
      { header: 'Variance h', value: (p) => p.varianceHours },
    ]);
  }

  const futureRange = range[1] > today;

  return (
    <PageShell
      title="Utilization"
      description="Planned allocation against hours actually logged, per person and per project, for any period."
      actions={
        <button type="button" className={btnSecondary} onClick={exportCsv} disabled={!data || people.length === 0}>
          <FiDownload /> Export
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={preset}
          onChange={pickPreset}
          options={[
            { value: 'last30', label: 'Last 30d' },
            { value: 'last90', label: 'Last 90d' },
            { value: 'thisMonth', label: 'This month' },
            { value: 'lastMonth', label: 'Last month' },
            { value: 'qtd', label: 'Quarter to date' },
            { value: 'next30', label: 'Next 30d' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
        {preset === 'custom' && (
          <div className="flex items-center gap-1 text-xs">
            <input type="date" value={range[0]} max={range[1]} onChange={(e) => e.target.value && setRange([e.target.value, range[1]])} className={`${inputCls} w-auto`} />
            <span>→</span>
            <input type="date" value={range[1]} min={range[0]} onChange={(e) => e.target.value && setRange([range[0], e.target.value])} className={`${inputCls} w-auto`} />
          </div>
        )}
        <div className="flex flex-1 justify-end gap-2">
          {(data?.departments.length ?? 0) > 0 && (
            <select value={department} onChange={(e) => setDepartment(e.target.value)} className={`${inputCls} w-auto`} aria-label="Department">
              <option value="">All departments</option>
              {data!.departments.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {!data ? (
        loading && <LoadingBlock label="Loading utilization…" />
      ) : (
        <div className={`space-y-5 ${loading ? 'opacity-60' : ''}`}>
          <p className="text-xs text-[color:var(--text-muted)]">
            {fmtDate(data.from)} – {fmtDate(data.to)} · {data.periodDays} days · {data.summary.teamSize} people
            {futureRange && ' · logged hours only exist up to today'}
          </p>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Stat label="Capacity" value={`${Math.round(data.summary.capacityHours).toLocaleString()}h`} hint={`${data.summary.teamSize} people`} />
            <Stat label="Planned" value={`${data.summary.avgPlannedUtilization}%`} hint={`${Math.round(data.summary.plannedHours).toLocaleString()}h booked`} />
            <Stat label="Logged" value={`${data.summary.avgLoggedUtilization}%`} hint={`${Math.round(data.summary.loggedHours).toLocaleString()}h logged`} />
            <Stat
              label="Billable util."
              value={`${data.summary.billableUtilization}%`}
              hint={`${Math.round(data.summary.billableLoggedHours).toLocaleString()}h billable`}
              tone={data.summary.billableUtilization > 0 ? 'good' : undefined}
            />
            <Stat label="Over-allocated" value={data.summary.overAllocated} tone={data.summary.overAllocated ? 'bad' : undefined} to="/resources/conflicts" />
            <Stat
              label="Logged < 80% of plan"
              value={data.summary.loggedBelowPlan}
              hint={`${data.summary.underUtilized} under ${settings.benchThresholdPct}% planned`}
              tone={data.summary.loggedBelowPlan ? 'warn' : undefined}
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-5">
            <SectionCard className="xl:col-span-3" title="Week by week" description="Capacity vs booked vs logged hours.">
              {data.weeks.length === 0 ? (
                <EmptyState title="No weeks in range" />
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data.weeks.map((w) => ({ ...w, label: fmtShort(w.weekStart) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                      <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" unit="h" />
                      <Tooltip {...chartTooltipProps} formatter={(v) => [`${Number(v ?? 0).toLocaleString()}h`]} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="plannedHours" name="Booked" fill={getChartColor(0)} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="loggedHours" name="Logged" fill={getChartColor(1)} radius={[4, 4, 0, 0]} />
                      <Line dataKey="capacityHours" name="Capacity" stroke={getChartColor(3)} strokeWidth={2} dot={false} type="monotone" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </SectionCard>
            <SectionCard className="xl:col-span-2" title="By project" description="Booked vs logged hours.">
              {data.byProject.length === 0 ? (
                <EmptyState title="No project hours in range" />
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.byProject} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--text-muted)" unit="h" />
                      <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                      <Tooltip {...chartTooltipProps} formatter={(v) => [`${Number(v ?? 0).toLocaleString()}h`]} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="plannedHours" name="Booked" fill={getChartColor(0)} radius={[0, 4, 4, 0]} />
                      <Bar dataKey="loggedHours" name="Logged" fill={getChartColor(1)} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </SectionCard>
          </div>

          <SectionCard
            title="People"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Segmented
                  size="xs"
                  value={sort}
                  onChange={setSort}
                  options={[
                    { value: 'planned', label: 'Planned' },
                    { value: 'logged', label: 'Logged' },
                    { value: 'billable', label: 'Billable' },
                    { value: 'variance', label: 'Under plan' },
                    { value: 'name', label: 'Name' },
                  ]}
                />
                <input type="search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputCls} w-36 py-1`} />
              </div>
            }
          >
            {people.length === 0 ? (
              <EmptyState title="No people match" />
            ) : (
              <div className="overflow-x-auto -mx-6">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[color:var(--border-subtle)] text-left text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
                      <th className="px-6 py-2 font-medium">Person</th>
                      <th className="px-3 py-2 font-medium">Planned</th>
                      <th className="px-3 py-2 font-medium">Logged</th>
                      <th className="px-3 py-2 font-medium text-right">Capacity</th>
                      <th className="px-3 py-2 font-medium text-right">Booked h</th>
                      <th className="px-3 py-2 font-medium text-right">Logged h</th>
                      <th className="px-3 py-2 font-medium text-right">Billable</th>
                      <th className="px-6 py-2 font-medium text-right">Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((p) => (
                      <tr key={p.userId} className="border-b border-[color:var(--border-subtle)]/60">
                        <td className="px-6 py-2.5">
                          <div className="font-medium">{p.name}</div>
                          <div className="text-[11px] text-[color:var(--text-muted)]">{p.department || p.email}</div>
                        </td>
                        <td className="px-3 py-2.5 w-40">
                          <LoadBar hard={p.plannedPercent} settings={settings} />
                          {p.peakPercent > settings.overAllocationPct && <div className="text-[10px] text-red-400">peak {p.peakPercent}%</div>}
                        </td>
                        <td className="px-3 py-2.5 w-40">
                          <LoadBar hard={p.utilizationPct} settings={{ ...settings, overAllocationPct: Math.max(100, settings.overAllocationPct) }} />
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{Math.round(p.capacityHours)}h</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {p.plannedHours}h{p.softHours > 0 && <span className="block text-[10px] text-amber-400">+{p.softHours}h soft</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{p.loggedHours}h</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{p.billableUtilizationPct}%</td>
                        <td
                          className={`px-6 py-2.5 text-right tabular-nums ${
                            p.plannedHours > 0 && p.varianceHours < -p.plannedHours * 0.2 ? 'text-amber-400' : p.varianceHours > 0 ? 'text-sky-400' : ''
                          }`}
                        >
                          {p.varianceHours > 0 ? '+' : ''}
                          {p.varianceHours}h
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </PageShell>
  );
}
