import { useEffect, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useAuth } from '../../contexts/AuthContext';
import { accountsApi } from '../../lib/api';
import MetricCard from '../../components/MetricCard';
import SectionCard from '../../components/SectionCard';
import { chartTooltipProps, getChartColor } from '../../lib/chartTheme';
import { EmptyChart, LoadingCard, ModuleHeader, money } from '../../components/moduleKit';

type Dash = {
  counts: { invoices: number; expenses: number; unpaidInvoices: number; postedToLedger: number };
  revenue: number;
  collected: number;
  outstanding: number;
  totalExpense: number;
  netProfit: number;
  profitMargin: number;
  cashflow: { month: string; income: number; expense: number; net: number }[];
  expenseCategories: { name: string; value: number }[];
  receivablesAging: { name: string; value: number }[];
};

export default function AccountsDashboard() {
  const { token } = useAuth();
  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    accountsApi.dashboard(token).then((r) => { setLoading(false); if (r.success && r.data) setData(r.data as Dash); });
  }, [token]);

  if (loading) return <LoadingCard label="Loading finance dashboard…" />;
  if (!data) return <div className="p-8 text-red-400">Failed to load finance dashboard.</div>;

  const expensePie = data.expenseCategories.filter((d) => d.value > 0);
  const aging = data.receivablesAging.filter((d) => d.value > 0);

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-6">
      <ModuleHeader
        eyebrow="Finance"
        title="Accounts dashboard"
        subtitle="Revenue from Billing, expenses, cash flow, and receivables — the financial books for the workspace."
        accent="#22c55e"
        actions={[
          { to: '/accounts/ledger', label: 'Ledger', primary: true },
          { to: '/accounts/invoices', label: 'Invoices' },
          { to: '/accounts/expenses', label: 'Expenses' },
          { to: '/cost-usage', label: 'Cost report' },
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Revenue" value={money(data.revenue)} helperText={`${money(data.collected)} collected`} />
        <MetricCard title="Expenses" value={money(data.totalExpense)} helperText={`${data.counts.expenses} records`} />
        <MetricCard title="Net profit" value={money(data.netProfit)} helperText={`${data.profitMargin}% margin`} />
        <MetricCard title="Outstanding" value={money(data.outstanding)} helperText={`${data.counts.unpaidInvoices} unpaid invoices`} />
      </div>

      <SectionCard title="Cash flow" description="Income vs expense over the last 6 months.">
        {data.cashflow.every((r) => r.income === 0 && r.expense === 0) ? (
          <EmptyChart label="No financial activity yet." />
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.cashflow} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="acIncome" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={getChartColor(2)} stopOpacity={0.35} /><stop offset="100%" stopColor={getChartColor(2)} stopOpacity={0.02} /></linearGradient>
                  <linearGradient id="acExpense" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={getChartColor(4)} stopOpacity={0.3} /><stop offset="100%" stopColor={getChartColor(4)} stopOpacity={0.02} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" tickFormatter={(v) => money(Number(v))} />
                <Tooltip {...chartTooltipProps} formatter={(v, n) => [money(Number(v)), String(n)]} />
                <Legend />
                <Area type="monotone" dataKey="income" name="Income" stroke={getChartColor(2)} fill="url(#acIncome)" strokeWidth={2} />
                <Area type="monotone" dataKey="expense" name="Expense" stroke={getChartColor(4)} fill="url(#acExpense)" strokeWidth={2} />
                <Line type="monotone" dataKey="net" name="Net" stroke={getChartColor(0)} strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Expenses by category">
          {expensePie.length === 0 ? <EmptyChart label="No expenses recorded." /> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={expensePie} dataKey="value" nameKey="name" cx="42%" cy="50%" innerRadius="48%" outerRadius="72%" paddingAngle={3}>
                    {expensePie.map((_, i) => <Cell key={i} fill={getChartColor(i)} stroke="var(--bg-surface)" strokeWidth={2} />)}
                  </Pie>
                  <Tooltip {...chartTooltipProps} formatter={(v) => money(Number(v))} />
                  <Legend layout="vertical" verticalAlign="middle" align="right" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Receivables aging" description="Outstanding invoice amounts by overdue bucket.">
          {aging.length === 0 ? <EmptyChart label="Nothing outstanding." /> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.receivablesAging} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" tickFormatter={(v) => money(Number(v))} />
                  <Tooltip {...chartTooltipProps} formatter={(v) => money(Number(v))} />
                  <Bar dataKey="value" name="Outstanding" radius={[4, 4, 0, 0]}>
                    {data.receivablesAging.map((_, i) => <Cell key={i} fill={getChartColor(i === 3 ? 4 : i)} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
