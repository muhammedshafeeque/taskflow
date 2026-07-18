import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
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
import { crmApi } from '../../lib/api';
import MetricCard from '../../components/MetricCard';
import SectionCard from '../../components/SectionCard';
import { chartTooltipProps, getChartColor } from '../../lib/chartTheme';

type CrmDash = {
  counts: {
    accounts: number;
    contacts: number;
    leads: number;
    openDeals: number;
    openTickets: number;
    quotes: number;
    contracts: number;
    wonDeals: number;
  };
  pipelineValue: number;
  weightedPipeline: number;
  wonValue: number;
  winRate: number;
  activeContractValue: number;
  dealsByStatus: Array<{ name: string; count: number; value: number }>;
  dealsByStage: Array<{ name: string; order: number; count: number; value: number }>;
  leadsByStatus: Array<{ name: string; count: number }>;
  activitiesByType: Array<{ name: string; count: number }>;
  quotesByStatus: Array<{ name: string; count: number; value: number }>;
  contractsByStatus: Array<{ name: string; count: number; value: number }>;
  forecastSeries: Array<{ month: string; weighted: number; total: number; count: number }>;
  unscheduledForecast: { weighted: number; total: number; count: number };
  closedTrend: Array<{ month: string; won: number; lost: number; wonValue: number; lostValue: number }>;
  recentActivities: Array<{ _id: string; type: string; subject: string; createdAt: string }>;
};

const money = (n: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

const moneyTick = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n}`;
};

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-64 flex items-center justify-center text-sm text-[color:var(--text-muted)]">{label}</div>
  );
}

export default function CrmDashboard() {
  const { token } = useAuth();
  const [data, setData] = useState<CrmDash | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    crmApi.dashboard(token).then((dash) => {
      setLoading(false);
      if (dash.success && dash.data) setData(dash.data as CrmDash);
    });
  }, [token]);

  if (loading) {
    return (
      <div className="p-8 w-full px-4 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-10 text-center text-[color:var(--text-muted)] animate-pulse">
          Loading CRM dashboard…
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="p-8 text-red-400">Failed to load CRM dashboard.</div>;
  }

  const stageChart = data.dealsByStage.map((s) => ({
    name: s.name,
    deals: s.count,
    value: s.value,
  }));

  const statusPie = data.dealsByStatus
    .filter((d) => d.count > 0)
    .map((d) => ({ name: d.name, value: d.count }));

  const leadPie = data.leadsByStatus.filter((d) => d.count > 0);
  const activityBars = data.activitiesByType.slice(0, 8);

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-6">
      <header className="relative overflow-hidden rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-6 py-5 sm:px-8">
        <div
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            background:
              'radial-gradient(ellipse 80% 120% at 100% 0%, color-mix(in srgb, var(--accent) 18%, transparent), transparent 55%), linear-gradient(135deg, color-mix(in srgb, var(--accent) 6%, transparent), transparent 40%)',
          }}
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--accent)]">CRM</p>
            <h1 className="text-2xl font-bold tracking-tight mt-1">Sales dashboard</h1>
            <p className="text-[13px] text-[color:var(--text-muted)] mt-1 max-w-xl">
              Pipeline health, weighted forecast, and conversion trends across accounts and deals.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Link to="/crm/deals" className="btn-primary btn-primary-sm px-3 py-1.5 rounded-lg">
              Open pipeline
            </Link>
            <Link
              to="/crm/leads"
              className="px-3 py-1.5 rounded-lg border border-[color:var(--border-subtle)] hover:border-[color:var(--accent)]/40 transition"
            >
              Leads
            </Link>
            <Link
              to="/crm/quotes"
              className="px-3 py-1.5 rounded-lg border border-[color:var(--border-subtle)] hover:border-[color:var(--accent)]/40 transition"
            >
              Quotes
            </Link>
          </div>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Link to="/crm/deals" className="block">
          <MetricCard title="Pipeline value" value={money(data.pipelineValue)} helperText={`${data.counts.openDeals} open deals`} />
        </Link>
        <MetricCard
          title="Weighted forecast"
          value={money(data.weightedPipeline)}
          helperText={
            data.unscheduledForecast.count
              ? `${data.unscheduledForecast.count} unscheduled`
              : 'Probability-adjusted'
          }
        />
        <MetricCard title="Won revenue" value={money(data.wonValue)} helperText={`${data.counts.wonDeals} won deals`} />
        <MetricCard title="Win rate" value={`${data.winRate}%`} helperText={`${data.counts.leads} open leads`} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Accounts', value: data.counts.accounts, to: '/crm/accounts' },
          { label: 'Contacts', value: data.counts.contacts, to: '/crm/contacts' },
          { label: 'Quotes', value: data.counts.quotes, to: '/crm/quotes' },
          { label: 'Active contracts', value: money(data.activeContractValue), to: '/crm/contracts' },
        ].map((c) => (
          <Link
            key={c.label}
            to={c.to}
            className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] px-4 py-3 hover:border-[color:var(--accent)]/40 transition"
          >
            <p className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">{c.label}</p>
            <p className="text-lg font-semibold mt-0.5">{c.value}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <SectionCard
          className="xl:col-span-3"
          title="Revenue forecast"
          description="Open deal value by expected close month (weighted vs total)."
          actions={
            <Link to="/crm/deals" className="text-xs text-[color:var(--accent)] hover:underline">
              Deals →
            </Link>
          }
        >
          {data.forecastSeries.length === 0 ? (
            <EmptyChart label="No deals with expected close dates yet." />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.forecastSeries} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="crmWeighted" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={getChartColor(0)} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={getChartColor(0)} stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="crmTotal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={getChartColor(1)} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={getChartColor(1)} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" tickFormatter={moneyTick} width={52} />
                  <Tooltip
                    {...chartTooltipProps}
                    formatter={(value, name) => [money(Number(value ?? 0)), String(name)]}
                  />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="total"
                    name="Total"
                    stroke={getChartColor(1)}
                    fill="url(#crmTotal)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="weighted"
                    name="Weighted"
                    stroke={getChartColor(0)}
                    fill="url(#crmWeighted)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard className="xl:col-span-2" title="Deal mix" description="Open vs won vs lost.">
          {statusPie.length === 0 ? (
            <EmptyChart label="No deals yet." />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusPie}
                    dataKey="value"
                    nameKey="name"
                    cx="42%"
                    cy="50%"
                    innerRadius="48%"
                    outerRadius="72%"
                    paddingAngle={3}
                  >
                    {statusPie.map((_, i) => (
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
        <SectionCard title="Pipeline by stage" description="Open deal count and value in each stage.">
          {stageChart.length === 0 ? (
            <EmptyChart label="No open deals in the pipeline." />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stageChart} margin={{ top: 8, right: 8, left: 4, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--text-muted)" interval={0} angle={-18} textAnchor="end" height={48} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} stroke="var(--text-muted)" allowDecimals={false} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    stroke="var(--text-muted)"
                    tickFormatter={moneyTick}
                    width={48}
                  />
                  <Tooltip
                    {...chartTooltipProps}
                    formatter={(value, name) =>
                      String(name) === 'value' ? [money(Number(value ?? 0)), 'Value'] : [Number(value ?? 0), 'Deals']
                    }
                  />
                  <Legend />
                  <Bar yAxisId="left" dataKey="deals" name="Deals" fill={getChartColor(0)} radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="right" dataKey="value" name="Value" fill={getChartColor(2)} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Won / lost trend" description="Closed deals over the last 6 months.">
          {data.closedTrend.every((r) => r.won === 0 && r.lost === 0) ? (
            <EmptyChart label="No won or lost deals in this window." />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.closedTrend} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" allowDecimals={false} />
                  <Tooltip {...chartTooltipProps} />
                  <Legend />
                  <Bar dataKey="won" name="Won" stackId="a" fill={getChartColor(2)} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="lost" name="Lost" stackId="a" fill={getChartColor(4)} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard title="Leads by status">
          {leadPie.length === 0 ? (
            <EmptyChart label="No leads yet." />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={leadPie} dataKey="count" nameKey="name" cx="50%" cy="50%" innerRadius="45%" outerRadius="70%" paddingAngle={2}>
                    {leadPie.map((_, i) => (
                      <Cell key={i} fill={getChartColor(i + 1)} stroke="var(--bg-surface)" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip {...chartTooltipProps} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Activity mix">
          {activityBars.length === 0 ? (
            <EmptyChart label="No activities logged." />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activityBars} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--text-muted)" allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                  <Tooltip {...chartTooltipProps} />
                  <Bar dataKey="count" name="Count" fill={getChartColor(1)} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Recent activity"
          actions={
            <Link to="/crm/activities" className="text-xs text-[color:var(--accent)] hover:underline">
              View all
            </Link>
          }
        >
          {data.recentActivities.length === 0 ? (
            <p className="text-sm text-[color:var(--text-muted)] py-8 text-center">No recent activity.</p>
          ) : (
            <ul className="space-y-2 max-h-56 overflow-auto pr-1">
              {data.recentActivities.map((a) => (
                <li
                  key={a._id}
                  className="flex justify-between gap-3 text-sm py-2 px-2 rounded-lg hover:bg-[color:var(--bg-page)]"
                >
                  <span className="min-w-0 truncate">
                    <span className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)] mr-1.5">
                      {a.type}
                    </span>
                    {a.subject}
                  </span>
                  <span className="shrink-0 text-[11px] text-[color:var(--text-muted)]">
                    {new Date(a.createdAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
