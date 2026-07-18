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
import { billingApi } from '../../lib/api';
import MetricCard from '../../components/MetricCard';
import SectionCard from '../../components/SectionCard';
import { chartTooltipProps, getChartColor } from '../../lib/chartTheme';

type BillingDash = {
  counts: {
    activeSubscriptions: number;
    drafts: number;
    overdue: number;
    taxRules: number;
    unbilledProjects: number;
  };
  mrr: number;
  arr: number;
  outstanding: number;
  collected: number;
  unbilledHours: number;
  unbilledValue: number;
  byStatus: Array<{ name: string; count: number; value: number }>;
  byCycle: Array<{ name: string; count: number; mrr: number }>;
  invoiceTrend: Array<{ month: string; invoiced: number; paid: number; count: number }>;
  upcomingBilling: Array<{
    _id: string;
    name: string;
    amount: number;
    currency: string;
    nextBillingDate?: string;
    daysUntil: number;
    billingCycle: string;
  }>;
  recentInvoices: Array<{
    _id: string;
    number: string;
    status: string;
    total: number;
    currency: string;
    issueDate: string;
  }>;
};

const money = (n: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-64 flex items-center justify-center text-sm text-[color:var(--text-muted)]">{label}</div>
  );
}

export default function BillingDashboard() {
  const { token } = useAuth();
  const [data, setData] = useState<BillingDash | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    billingApi.dashboard(token).then((res) => {
      setLoading(false);
      if (res.success && res.data) setData(res.data as BillingDash);
    });
  }, [token]);

  if (loading) {
    return (
      <div className="p-8 w-full px-4 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-10 text-center text-[color:var(--text-muted)] animate-pulse">
          Loading billing dashboard…
        </div>
      </div>
    );
  }

  if (!data) return <div className="p-8 text-red-400">Failed to load billing dashboard.</div>;

  const statusPie = data.byStatus.filter((d) => d.count > 0).map((d) => ({ name: d.name, value: d.count }));
  const cycleBars = data.byCycle.filter((d) => d.count > 0);

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-6">
      <header className="relative overflow-hidden rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-6 py-5 sm:px-8">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 70% 110% at 0% 0%, color-mix(in srgb, #f97316 14%, transparent), transparent 50%), radial-gradient(ellipse 60% 90% at 100% 100%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 45%)',
          }}
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--accent)]">Billing</p>
            <h1 className="text-2xl font-bold tracking-tight mt-1">Revenue dashboard</h1>
            <p className="text-[13px] text-[color:var(--text-muted)] mt-1 max-w-xl">
              MRR, invoices, subscriptions, and unbilled time ready to convert.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Link to="/billing/invoices" className="btn-primary btn-primary-sm px-3 py-1.5 rounded-lg">
              Invoices
            </Link>
            <Link
              to="/billing/subscriptions"
              className="px-3 py-1.5 rounded-lg border border-[color:var(--border-subtle)] hover:border-[color:var(--accent)]/40 transition"
            >
              Subscriptions
            </Link>
            <Link
              to="/billing/time-to-invoice"
              className="px-3 py-1.5 rounded-lg border border-[color:var(--border-subtle)] hover:border-[color:var(--accent)]/40 transition"
            >
              Time to invoice
            </Link>
          </div>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="MRR" value={money(data.mrr)} helperText={`ARR ${money(data.arr)}`} />
        <MetricCard title="Outstanding" value={money(data.outstanding)} helperText={`${data.counts.overdue} overdue`} />
        <MetricCard title="Collected" value={money(data.collected)} helperText={`${data.counts.drafts} drafts`} />
        <Link to="/billing/time-to-invoice" className="block">
          <MetricCard
            title="Unbilled time"
            value={`${data.unbilledHours}h`}
            helperText={`≈ ${money(data.unbilledValue)} · ${data.counts.unbilledProjects} projects`}
          />
        </Link>
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <SectionCard
          className="xl:col-span-3"
          title="Invoice trend"
          description="Issued vs paid totals over the last 6 months."
        >
          {data.invoiceTrend.every((r) => r.count === 0) ? (
            <EmptyChart label="No invoices issued yet." />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.invoiceTrend} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="billInvoiced" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={getChartColor(0)} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={getChartColor(0)} stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="billPaid" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={getChartColor(2)} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={getChartColor(2)} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                  <Tooltip
                    {...chartTooltipProps}
                    formatter={(value, name) => [money(Number(value ?? 0)), String(name)]}
                  />
                  <Legend />
                  <Area type="monotone" dataKey="invoiced" name="Invoiced" stroke={getChartColor(0)} fill="url(#billInvoiced)" strokeWidth={2} />
                  <Area type="monotone" dataKey="paid" name="Paid" stroke={getChartColor(2)} fill="url(#billPaid)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard className="xl:col-span-2" title="Invoice status">
          {statusPie.length === 0 ? (
            <EmptyChart label="No invoices yet." />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusPie} dataKey="value" nameKey="name" cx="42%" cy="50%" innerRadius="48%" outerRadius="72%" paddingAngle={3}>
                    {statusPie.map((_, i) => (
                      <Cell key={i} fill={getChartColor(i)} stroke="var(--bg-surface)" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip {...chartTooltipProps} />
                  <Legend layout="vertical" verticalAlign="middle" align="right" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="MRR by billing cycle" description={`${data.counts.activeSubscriptions} active subscriptions`}>
          {cycleBars.length === 0 ? (
            <EmptyChart label="No active subscriptions." />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cycleBars} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                  <Tooltip
                    {...chartTooltipProps}
                    formatter={(value, name) =>
                      String(name) === 'mrr' ? [money(Number(value ?? 0)), 'MRR'] : [Number(value ?? 0), 'Subs']
                    }
                  />
                  <Legend />
                  <Bar dataKey="mrr" name="MRR" fill={getChartColor(3)} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="count" name="Subs" fill={getChartColor(1)} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Upcoming subscription billing"
          actions={
            <Link to="/billing/subscriptions" className="text-xs text-[color:var(--accent)] hover:underline">
              Manage →
            </Link>
          }
        >
          {data.upcomingBilling.length === 0 ? (
            <p className="text-sm text-[color:var(--text-muted)] py-8 text-center">No charges due in the next 60 days.</p>
          ) : (
            <ul className="space-y-2 max-h-72 overflow-auto pr-1">
              {data.upcomingBilling.map((s) => (
                <li key={s._id} className="flex justify-between gap-3 text-sm py-2 px-2 rounded-lg hover:bg-[color:var(--bg-page)]">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{s.name}</p>
                    <p className="text-[11px] text-[color:var(--text-muted)] uppercase">{s.billingCycle}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="tabular-nums">{money(s.amount)}</p>
                    <p className={`text-[11px] ${s.daysUntil <= 7 ? 'text-amber-600 dark:text-amber-400' : 'text-[color:var(--text-muted)]'}`}>
                      {s.daysUntil}d
                      {s.nextBillingDate ? ` · ${new Date(s.nextBillingDate).toLocaleDateString()}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Recent invoices"
        actions={
          <Link to="/billing/invoices" className="text-xs text-[color:var(--accent)] hover:underline">
            View all
          </Link>
        }
      >
        {data.recentInvoices.length === 0 ? (
          <p className="text-sm text-[color:var(--text-muted)] py-6 text-center">No invoices yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
                <tr>
                  <th className="text-left py-2 font-medium">Number</th>
                  <th className="text-left py-2 font-medium">Status</th>
                  <th className="text-left py-2 font-medium">Issued</th>
                  <th className="text-right py-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.recentInvoices.map((inv) => (
                  <tr key={inv._id} className="border-t border-[color:var(--border-subtle)]">
                    <td className="py-2.5 font-medium">{inv.number}</td>
                    <td className="py-2.5 capitalize">{inv.status}</td>
                    <td className="py-2.5 text-[color:var(--text-muted)]">{new Date(inv.issueDate).toLocaleDateString()}</td>
                    <td className="py-2.5 text-right tabular-nums">{money(inv.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
