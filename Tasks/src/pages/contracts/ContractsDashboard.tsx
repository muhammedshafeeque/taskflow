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
import { contractsApi } from '../../lib/api';
import MetricCard from '../../components/MetricCard';
import SectionCard from '../../components/SectionCard';
import { chartTooltipProps, getChartColor } from '../../lib/chartTheme';

type ContractsDash = {
  counts: {
    total: number;
    active: number;
    msas: number;
    retainers: number;
    renewalsIn30: number;
    renewalsIn90: number;
    slaPolicies: number;
    slaEnabled: number;
    autoRenew: number;
  };
  activeValue: number;
  byStatus: Array<{ name: string; count: number; value: number }>;
  byKind: Array<{ name: string; kind: string; count: number; value: number }>;
  renewalBuckets: Array<{ name: string; count: number; value: number }>;
  upcomingRenewals: Array<{
    _id: string;
    title: string;
    kind: string;
    value: number;
    currency: string;
    renewalDate?: string;
    daysUntilRenewal: number;
    autoRenew?: boolean;
  }>;
  retainerBurn: Array<{
    _id: string;
    title: string;
    kind: string;
    hoursIncluded: number;
    hoursUsed: number;
    percentUsed: number;
    hoursRemaining: number;
  }>;
  billingCycleMix: Array<{ name: string; count: number; value: number }>;
};

const money = (n: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-64 flex items-center justify-center text-sm text-[color:var(--text-muted)]">{label}</div>
  );
}

export default function ContractsDashboard() {
  const { token } = useAuth();
  const [data, setData] = useState<ContractsDash | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    contractsApi.dashboard(token).then((res) => {
      setLoading(false);
      if (res.success && res.data) setData(res.data as ContractsDash);
    });
  }, [token]);

  if (loading) {
    return (
      <div className="p-8 w-full px-4 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-10 text-center text-[color:var(--text-muted)] animate-pulse">
          Loading contracts dashboard…
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="p-8 text-red-400">Failed to load contracts dashboard.</div>;
  }

  const statusPie = data.byStatus.filter((d) => d.count > 0).map((d) => ({ name: d.name, value: d.count }));
  const kindBars = data.byKind.filter((d) => d.count > 0);
  const billingPie = data.billingCycleMix.filter((d) => d.count > 0).map((d) => ({ name: d.name, value: d.count }));

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-6">
      <header className="relative overflow-hidden rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-6 py-5 sm:px-8">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 75% 110% at 100% 0%, color-mix(in srgb, #22c55e 14%, transparent), transparent 55%), radial-gradient(ellipse 55% 90% at 0% 100%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 50%)',
          }}
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--accent)]">
              Contracts
            </p>
            <h1 className="text-2xl font-bold tracking-tight mt-1">Agreement dashboard</h1>
            <p className="text-[13px] text-[color:var(--text-muted)] mt-1 max-w-xl">
              MSAs, retainers, renewals, and SLA coverage across your customer agreements.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Link to="/contracts/msas" className="btn-primary btn-primary-sm px-3 py-1.5 rounded-lg">
              MSAs
            </Link>
            <Link
              to="/contracts/retainers"
              className="px-3 py-1.5 rounded-lg border border-[color:var(--border-subtle)] hover:border-[color:var(--accent)]/40 transition"
            >
              Retainers
            </Link>
            <Link
              to="/contracts/renewals"
              className="px-3 py-1.5 rounded-lg border border-[color:var(--border-subtle)] hover:border-[color:var(--accent)]/40 transition"
            >
              Renewals
            </Link>
            <Link
              to="/contracts/slas"
              className="px-3 py-1.5 rounded-lg border border-[color:var(--border-subtle)] hover:border-[color:var(--accent)]/40 transition"
            >
              SLAs
            </Link>
          </div>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Active value" value={money(data.activeValue)} helperText={`${data.counts.active} active`} />
        <Link to="/contracts/msas" className="block">
          <MetricCard title="MSAs" value={data.counts.msas} helperText={`${data.counts.total} total agreements`} />
        </Link>
        <Link to="/contracts/renewals" className="block">
          <MetricCard
            title="Renewals (30d)"
            value={data.counts.renewalsIn30}
            helperText={`${data.counts.renewalsIn90} within 90 days`}
          />
        </Link>
        <Link to="/contracts/slas" className="block">
          <MetricCard
            title="SLA policies"
            value={data.counts.slaEnabled}
            helperText={`${data.counts.slaPolicies} defined · ${data.counts.autoRenew} auto-renew`}
          />
        </Link>
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <SectionCard
          className="xl:col-span-3"
          title="Renewal pipeline"
          description="Upcoming renewals by time window and contract value."
          actions={
            <Link to="/contracts/renewals" className="text-xs text-[color:var(--accent)] hover:underline">
              Calendar →
            </Link>
          }
        >
          {data.renewalBuckets.every((b) => b.count === 0) ? (
            <EmptyChart label="No renewal dates set on active contracts." />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.renewalBuckets} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} stroke="var(--text-muted)" allowDecimals={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                  <Tooltip
                    {...chartTooltipProps}
                    formatter={(value, name) =>
                      String(name) === 'value' ? [money(Number(value ?? 0)), 'Value'] : [Number(value ?? 0), 'Contracts']
                    }
                  />
                  <Legend />
                  <Bar yAxisId="left" dataKey="count" name="Contracts" fill={getChartColor(0)} radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="right" dataKey="value" name="Value" fill={getChartColor(2)} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard className="xl:col-span-2" title="Status mix">
          {statusPie.length === 0 ? (
            <EmptyChart label="No contracts yet." />
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
                    wrapperStyle={{ fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="By agreement type" description="MSA, retainer, AMC, and other contracts.">
          {kindBars.length === 0 ? (
            <EmptyChart label="Create contracts to see the type mix." />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={kindBars} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" allowDecimals={false} />
                  <Tooltip
                    {...chartTooltipProps}
                    formatter={(value, name, item) => {
                      const row = item?.payload as { value?: number };
                      return [`${value} · ${money(row?.value ?? 0)}`, String(name)];
                    }}
                  />
                  <Bar dataKey="count" name="Count" radius={[4, 4, 0, 0]}>
                    {kindBars.map((_, i) => (
                      <Cell key={i} fill={getChartColor(i)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Billing cycle (active)">
          {billingPie.length === 0 ? (
            <EmptyChart label="No active contracts." />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={billingPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="42%" outerRadius="68%" paddingAngle={2}>
                    {billingPie.map((_, i) => (
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
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Upcoming renewals"
          actions={
            <Link to="/contracts/renewals" className="text-xs text-[color:var(--accent)] hover:underline">
              View all
            </Link>
          }
        >
          {data.upcomingRenewals.length === 0 ? (
            <p className="text-sm text-[color:var(--text-muted)] py-8 text-center">No renewals in the next 90 days.</p>
          ) : (
            <ul className="space-y-2 max-h-72 overflow-auto pr-1">
              {data.upcomingRenewals.map((r) => (
                <li
                  key={r._id}
                  className="flex items-center justify-between gap-3 text-sm py-2 px-2 rounded-lg hover:bg-[color:var(--bg-page)]"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{r.title}</p>
                    <p className="text-[11px] text-[color:var(--text-muted)] uppercase">
                      {r.kind}
                      {r.autoRenew ? ' · auto-renew' : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="tabular-nums">{money(r.value)}</p>
                    <p
                      className={`text-[11px] ${
                        r.daysUntilRenewal <= 30 ? 'text-amber-600 dark:text-amber-400' : 'text-[color:var(--text-muted)]'
                      }`}
                    >
                      {r.daysUntilRenewal}d
                      {r.renewalDate ? ` · ${new Date(r.renewalDate).toLocaleDateString()}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Retainer burn-down"
          description="Hours used vs included on active retainers and AMC."
          actions={
            <Link to="/contracts/retainers" className="text-xs text-[color:var(--accent)] hover:underline">
              Manage →
            </Link>
          }
        >
          {data.retainerBurn.length === 0 ? (
            <p className="text-sm text-[color:var(--text-muted)] py-8 text-center">No retainer or AMC hour blocks yet.</p>
          ) : (
            <ul className="space-y-3 max-h-72 overflow-auto pr-1">
              {data.retainerBurn.map((r) => (
                <li key={r._id} className="space-y-1.5">
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="truncate font-medium">
                      {r.title}{' '}
                      <span className="text-[11px] uppercase text-[color:var(--text-muted)]">{r.kind}</span>
                    </span>
                    <span className="tabular-nums shrink-0 text-[color:var(--text-muted)]">
                      {r.hoursUsed}/{r.hoursIncluded}h · {r.percentUsed}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[color:var(--bg-page)] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, r.percentUsed)}%`,
                        background:
                          r.percentUsed >= 90
                            ? getChartColor(4)
                            : r.percentUsed >= 70
                              ? getChartColor(3)
                              : getChartColor(2),
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
