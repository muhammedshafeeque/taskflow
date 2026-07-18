import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '../../contexts/AuthContext';
import { resourcesApi } from '../../lib/api';
import MetricCard from '../../components/MetricCard';
import SectionCard from '../../components/SectionCard';
import { chartTooltipProps, getChartColor } from '../../lib/chartTheme';

type ResourcesDash = {
  counts: {
    teamSize: number;
    activeAllocations: number;
    softBookings: number;
    openDemands: number;
    profiles: number;
    overAllocated: number;
    onBench: number;
    fullyBooked: number;
    partiallyBooked: number;
  };
  avgUtilization: number;
  charts: {
    loadDistribution: Array<{ name: string; count: number }>;
    topLoaded: Array<{ userId: string; name: string; plannedPercent: number }>;
    allocationsByProject: Array<{ name: string; percent: number; people: number }>;
    allocationMix: Array<{ name: string; value: number }>;
    staffingMix: Array<{ name: string; value: number }>;
    capacity: {
      capacityHoursWeek: number;
      availableHoursWeek: number;
      demandHoursOpen: number;
      gapHours: number;
    };
    demandByPriority: Array<{ name: string; count: number; hours: number }>;
  };
};

type Forecast = {
  supply: { availableHours: number; totalCapacityHours: number; avgCommittedPercent: number };
  demand: { hoursNeeded: number; openCount: number };
  gapHours: number;
  shortfall: boolean;
};

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-64 flex items-center justify-center text-sm text-[color:var(--text-muted)]">{label}</div>
  );
}

export default function ResourcesDashboard() {
  const { token } = useAuth();
  const [data, setData] = useState<ResourcesDash | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([resourcesApi.dashboard(token), resourcesApi.forecast(token)]).then(([dash, fc]) => {
      setLoading(false);
      if (dash.success && dash.data) setData(dash.data as ResourcesDash);
      if (fc.success && fc.data) setForecast(fc.data as Forecast);
    });
  }, [token]);

  if (loading) {
    return (
      <div className="p-8 w-full px-4 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-10 text-center text-[color:var(--text-muted)] animate-pulse">
          Loading resources dashboard…
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="p-8 text-red-400">Failed to load resources dashboard.</div>;
  }

  const { charts } = data;
  const staffingPie = charts.staffingMix.filter((d) => d.value > 0);
  const mixPie = charts.allocationMix.filter((d) => d.value > 0);

  const capacityBars = [
    {
      name: 'Weekly capacity',
      hours: charts.capacity.capacityHoursWeek,
    },
    {
      name: 'Available now',
      hours: charts.capacity.availableHoursWeek,
    },
    {
      name: 'Open demand',
      hours: charts.capacity.demandHoursOpen,
    },
  ];

  const forecastBars = forecast
    ? [
        { name: '90d capacity', hours: forecast.supply.totalCapacityHours },
        { name: 'Available', hours: forecast.supply.availableHours },
        { name: 'Demand', hours: forecast.demand.hoursNeeded },
      ]
    : capacityBars;

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-6">
      <header className="relative overflow-hidden rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-6 py-5 sm:px-8">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 70% 100% at 0% 0%, color-mix(in srgb, #0ea5e9 16%, transparent), transparent 50%), radial-gradient(ellipse 50% 80% at 100% 100%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 45%)',
          }}
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--accent)]">
              Resources
            </p>
            <h1 className="text-2xl font-bold tracking-tight mt-1">Capacity dashboard</h1>
            <p className="text-[13px] text-[color:var(--text-muted)] mt-1 max-w-xl">
              Utilization, bench, project load, and demand vs supply for the next planning window.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Link to="/resources/allocations" className="btn-primary btn-primary-sm px-3 py-1.5 rounded-lg">
              Allocations
            </Link>
            <Link
              to="/resources/utilization"
              className="px-3 py-1.5 rounded-lg border border-[color:var(--border-subtle)] hover:border-[color:var(--accent)]/40 transition"
            >
              Utilization
            </Link>
            <Link
              to="/resources/forecast"
              className="px-3 py-1.5 rounded-lg border border-[color:var(--border-subtle)] hover:border-[color:var(--accent)]/40 transition"
            >
              Forecast
            </Link>
          </div>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Link to="/resources/team" className="block">
          <MetricCard title="Team size" value={data.counts.teamSize} helperText={`${data.counts.profiles} profiles`} />
        </Link>
        <Link to="/resources/utilization" className="block">
          <MetricCard
            title="Avg planned util."
            value={`${data.avgUtilization}%`}
            helperText={`${data.counts.fullyBooked} fully booked`}
          />
        </Link>
        <Link to="/resources/bench" className="block">
          <MetricCard title="On bench" value={data.counts.onBench} helperText="Under 20% allocated" />
        </Link>
        <Link to="/resources/conflicts" className="block">
          <MetricCard
            title="Over-allocated"
            value={data.counts.overAllocated}
            helperText={`${data.counts.openDemands} open demands`}
          />
        </Link>
      </div>

      {forecast && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            forecast.shortfall
              ? 'border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-200'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
          }`}
        >
          <span className="font-medium">{forecast.shortfall ? 'Capacity shortfall' : 'Supply covers demand'}</span>
          <span className="opacity-80">
            {' '}
            — 90-day gap {forecast.gapHours > 0 ? '+' : ''}
            {forecast.gapHours.toLocaleString()} hrs ({forecast.demand.openCount} demand items,{' '}
            {forecast.supply.avgCommittedPercent}% avg committed).
          </span>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-5">
        <SectionCard
          className="xl:col-span-3"
          title="Demand vs supply"
          description="Capacity and open staffing demand (90-day horizon when forecast is available)."
          actions={
            <Link to="/resources/forecast" className="text-xs text-[color:var(--accent)] hover:underline">
              Forecast →
            </Link>
          }
        >
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={forecastBars} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                <Tooltip
                  {...chartTooltipProps}
                  formatter={(value) => [`${Number(value ?? 0).toLocaleString()} hrs`, 'Hours']}
                />
                <Bar dataKey="hours" name="Hours" radius={[6, 6, 0, 0]}>
                  {forecastBars.map((_, i) => (
                    <Cell key={i} fill={getChartColor(i === 2 ? 4 : i)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-2" title="Staffing mix" description="How the team is currently booked.">
          {staffingPie.length === 0 ? (
            <EmptyChart label="No team members yet." />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={staffingPie}
                    dataKey="value"
                    nameKey="name"
                    cx="42%"
                    cy="50%"
                    innerRadius="48%"
                    outerRadius="72%"
                    paddingAngle={3}
                  >
                    {staffingPie.map((_, i) => (
                      <Cell key={i} fill={getChartColor(i)} stroke="var(--bg-surface)" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip {...chartTooltipProps} />
                  <Legend
                    layout="vertical"
                    verticalAlign="middle"
                    align="right"
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 12, color: 'var(--text-primary)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Load distribution" description="Headcount by planned allocation band.">
          {charts.loadDistribution.every((b) => b.count === 0) ? (
            <EmptyChart label="No allocation data yet." />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.loadDistribution} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" allowDecimals={false} />
                  <Tooltip {...chartTooltipProps} />
                  <Bar dataKey="count" name="People" fill={getChartColor(0)} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Top planned load"
          description="People with the highest current allocation %."
          actions={
            <Link to="/resources/utilization" className="text-xs text-[color:var(--accent)] hover:underline">
              Details →
            </Link>
          }
        >
          {charts.topLoaded.length === 0 ? (
            <EmptyChart label="No people in this workspace." />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={charts.topLoaded}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} />
                  <XAxis type="number" domain={[0, 'dataMax']} tick={{ fontSize: 11 }} stroke="var(--text-muted)" unit="%" />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={96}
                    tick={{ fontSize: 11 }}
                    stroke="var(--text-muted)"
                  />
                  <Tooltip
                    {...chartTooltipProps}
                    formatter={(value) => [`${Number(value ?? 0)}%`, 'Planned']}
                  />
                  <Bar dataKey="plannedPercent" name="Planned %" radius={[0, 4, 4, 0]}>
                    {charts.topLoaded.map((row, i) => (
                      <Cell key={row.userId} fill={row.plannedPercent > 100 ? getChartColor(4) : getChartColor(i % 3)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard title="Load by project" description="Sum of allocation % on active assignments.">
          {charts.allocationsByProject.length === 0 ? (
            <EmptyChart label="No project allocations." />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.allocationsByProject} margin={{ top: 4, right: 8, left: 0, bottom: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="var(--text-muted)" interval={0} angle={-20} textAnchor="end" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                  <Tooltip {...chartTooltipProps} />
                  <Bar dataKey="percent" name="% allocated" fill={getChartColor(1)} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Demand by priority">
          {charts.demandByPriority.every((d) => d.count === 0) ? (
            <EmptyChart label="No open demand." />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.demandByPriority} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" allowDecimals={false} />
                  <Tooltip
                    {...chartTooltipProps}
                    formatter={(value, name, item) => {
                      const hours = (item?.payload as { hours?: number })?.hours ?? 0;
                      return [`${value} (${hours} hrs)`, String(name)];
                    }}
                  />
                  <Bar dataKey="count" name="Requests" fill={getChartColor(3)} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Booking type">
          {mixPie.length === 0 ? (
            <EmptyChart label="No active bookings." />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={mixPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="42%" outerRadius="68%" paddingAngle={2}>
                    {mixPie.map((_, i) => (
                      <Cell key={i} fill={getChartColor(i + 2)} stroke="var(--bg-surface)" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip {...chartTooltipProps} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { to: '/resources/allocations', title: 'Allocations', desc: 'Assign people to projects with % and dates.' },
          { to: '/resources/utilization', title: 'Utilization', desc: 'Planned vs logged capacity by person.' },
          { to: '/resources/bench', title: 'Bench', desc: 'Available talent and freeing capacity.' },
          { to: '/resources/conflicts', title: 'Conflicts', desc: 'Over-allocation and schedule clashes.' },
        ].map((s) => (
          <Link
            key={s.to}
            to={s.to}
            className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-4 hover:border-[color:var(--accent)]/40 transition"
          >
            <h2 className="font-medium text-[color:var(--text-primary)]">{s.title}</h2>
            <p className="mt-1 text-[12px] text-[color:var(--text-muted)]">{s.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
