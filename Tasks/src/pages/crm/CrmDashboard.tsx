import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  FiActivity,
  FiAlertTriangle,
  FiAward,
  FiCalendar,
  FiCheckCircle,
  FiClock,
  FiDollarSign,
  FiFileText,
  FiFilter,
  FiGrid,
  FiPieChart,
  FiRefreshCw,
  FiTarget,
  FiTrendingUp,
  FiUsers,
  FiZap,
} from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { crmApi } from '../../lib/api';
import SectionCard from '../../components/SectionCard';
import { Avatar, Kpi } from '../../components/dashboard/PmWidgets';
import { chartTooltipProps, getChartColor } from '../../lib/chartTheme';
import { ModuleLoader } from '../../components/loaders/ModuleLoader';

type DealRef = {
  _id: string;
  title: string;
  value: number;
  currency?: string;
  probability: number;
  stage: string;
  owner: string | null;
  account: string | null;
  accountId: string | null;
  expectedCloseDate: string | null;
  lastTouchedAt: string;
};

type PeriodStats = { wonCount: number; wonValue: number; lostCount: number; winRate: number; newLeads: number; newDeals: number };

type CrmInsights = {
  momentum: { thisMonth: PeriodStats; lastMonth: PeriodStats };
  velocity: {
    avgSalesCycleDays: number;
    avgWonDealSize: number;
    avgOpenDealAgeDays: number;
    winRate12m: number;
    closingThisMonth: { count: number; value: number; weighted: number };
  };
  attention: {
    staleDays: number;
    overdueDeals: { count: number; value: number; items: DealRef[] };
    staleDeals: { count: number; value: number; items: DealRef[] };
    overdueActivities: {
      count: number;
      items: Array<{ _id: string; type: string; subject: string; dueAt: string; relatedType: string; relatedId: string | null; assignee: string | null }>;
    };
    overdueFollowUps: {
      count: number;
      items: Array<{ _id: string; title: string; companyName: string | null; status: string; nextFollowUpAt: string; assignee: string | null }>;
    };
    expiringQuotes: Array<{ _id: string; title: string; total: number; currency?: string; validUntil: string }>;
    renewals: Array<{ _id: string; title: string; value: number; currency?: string; date: string | null; autoRenew: boolean; account: string | null; accountId: string | null }>;
  };
  topDeals: DealRef[];
  leadSources: Array<{ name: string; total: number; converted: number; unqualified: number; conversionRate: number }>;
  leadTrend: Array<{ month: string; created: number; converted: number }>;
  leaderboard: Array<{
    id: string | null;
    name: string;
    openCount: number;
    openValue: number;
    weighted: number;
    wonCount: number;
    wonValue: number;
    lostCount: number;
    winRate: number;
  }>;
  lossReasons: Array<{ name: string; count: number; value: number }>;
  quoteAcceptanceRate: number;
  activityCadence: { last30: number; prev30: number };
};

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
  currency: string;
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
  insights: CrmInsights;
};

const TABS = [
  { id: 'overview', label: 'Overview', icon: <FiGrid /> },
  { id: 'pipeline', label: 'Pipeline', icon: <FiTrendingUp /> },
  { id: 'leads', label: 'Leads', icon: <FiFilter /> },
  { id: 'team', label: 'Team', icon: <FiUsers /> },
] as const;
type Tab = (typeof TABS)[number]['id'];

function makeMoney(currency: string) {
  const full = new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 });
  const compact = new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 });
  return { money: (n: number) => full.format(n || 0), tick: (n: number) => compact.format(n || 0) };
}

/** Percent change, or undefined when there is no baseline to compare against. */
function pctChange(cur: number, prev: number) {
  if (!prev) return undefined;
  return Math.round(((cur - prev) / prev) * 100);
}

const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—';

const daysFrom = (iso: string | null | undefined) =>
  iso ? Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000) : null;

const prettyName = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function relatedLink(type: string, id: string | null) {
  if (!id) return '/crm/activities';
  if (type === 'lead') return `/crm/leads/${id}`;
  if (type === 'account') return `/crm/accounts/${id}`;
  if (type === 'deal') return '/crm/deals';
  return '/crm/activities';
}

function EmptyChart({ label, h = 'h-64' }: { label: string; h?: string }) {
  return <div className={`${h} flex items-center justify-center text-sm text-[color:var(--text-muted)]`}>{label}</div>;
}

function AllClear({ label }: { label: string }) {
  return (
    <div className="py-6 text-center text-sm text-[color:var(--text-muted)]">
      <FiCheckCircle className="mx-auto mb-2 text-emerald-500 text-xl" />
      {label}
    </div>
  );
}

function MiniStat({ label, value, to, tone }: { label: string; value: ReactNode; to?: string; tone?: 'bad' | 'warn' }) {
  const toneCls = tone === 'bad' ? 'text-red-500' : tone === 'warn' ? 'text-amber-500' : '';
  const body = (
    <>
      <p className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">{label}</p>
      <p className={`text-lg font-semibold mt-0.5 tabular-nums ${toneCls}`}>{value}</p>
    </>
  );
  const cls = 'block rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] px-4 py-3';
  return to ? (
    <Link to={to} className={`${cls} hover:border-[color:var(--accent)]/40 transition`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function RateBar({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'good' | 'bad' }) {
  const color = tone === 'good' ? 'bg-emerald-500' : tone === 'bad' ? 'bg-red-500' : 'bg-[color:var(--accent)]';
  return (
    <div className="h-1.5 rounded-full bg-[color:var(--bg-elevated)] overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export default function CrmDashboard() {
  const { token } = useAuth();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<CrmDash | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'overview') as Tab;
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params);
    if (t === 'overview') next.delete('tab');
    else next.set('tab', t);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (!token) return;
    crmApi.dashboard(token).then((dash) => {
      setLoading(false);
      if (dash.success && dash.data) setData(dash.data as CrmDash);
    });
  }, [token, tick]);

  if (loading && !data) {
    return <ModuleLoader label="Loading CRM dashboard…" />;
  }

  if (!data) {
    return <div className="p-8 text-red-400">Failed to load CRM dashboard.</div>;
  }

  const fmt = makeMoney(data.currency || 'USD');
  const att = data.insights.attention;
  const attentionCount =
    att.overdueDeals.count + att.staleDeals.count + att.overdueActivities.count + att.overdueFollowUps.count;

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
              {attentionCount > 0
                ? `${attentionCount} items need attention · ${fmt.money(data.insights.velocity.closingThisMonth.value)} expected to close this month.`
                : 'Pipeline health, weighted forecast, and conversion trends across accounts and deals.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setTick((t) => t + 1);
              }}
              className="px-3 py-1.5 rounded-lg border border-[color:var(--border-subtle)] hover:border-[color:var(--accent)]/40 transition inline-flex items-center gap-1.5"
              title="Refresh"
            >
              <FiRefreshCw className={loading ? 'animate-spin' : ''} />
            </button>
            <Link to="/crm/deals" className="btn-primary btn-primary-sm px-3 py-1.5 rounded-lg">
              Open pipeline
            </Link>
            {[
              { to: '/crm/leads', label: 'Leads' },
              { to: '/crm/quotes', label: 'Quotes' },
              { to: '/crm/follow-ups', label: 'Follow-ups' },
            ].map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="px-3 py-1.5 rounded-lg border border-[color:var(--border-subtle)] hover:border-[color:var(--accent)]/40 transition"
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b border-[color:var(--border-subtle)]" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === t.id
                ? 'border-[color:var(--accent)] text-[color:var(--text-primary)]'
                : 'border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
            }`}
          >
            {t.icon}
            {t.label}
            {t.id === 'overview' && attentionCount > 0 && (
              <span className="ml-0.5 rounded-full bg-red-500/15 text-red-500 text-[10px] px-1.5 tabular-nums">{attentionCount}</span>
            )}
          </button>
        ))}
      </nav>

      {tab === 'overview' && <OverviewTab data={data} fmt={fmt} />}
      {tab === 'pipeline' && <PipelineTab data={data} fmt={fmt} />}
      {tab === 'leads' && <LeadsTab data={data} />}
      {tab === 'team' && <TeamTab data={data} fmt={fmt} />}
    </div>
  );
}

type Fmt = ReturnType<typeof makeMoney>;

/* ───────────────────────── Overview ───────────────────────── */

function OverviewTab({ data, fmt }: { data: CrmDash; fmt: Fmt }) {
  const { momentum, velocity } = data.insights;
  const cur = momentum.thisMonth;
  const prev = momentum.lastMonth;
  const statusPie = data.dealsByStatus.filter((d) => d.count > 0).map((d) => ({ name: d.name, value: d.count }));

  return (
    <div className="space-y-6">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <Kpi
          icon={<FiDollarSign />}
          label="Pipeline value"
          value={fmt.tick(data.pipelineValue)}
          hint={`${data.counts.openDeals} open · ${fmt.tick(data.weightedPipeline)} weighted`}
        />
        <Kpi
          icon={<FiAward />}
          label="Won this month"
          value={fmt.tick(cur.wonValue)}
          delta={pctChange(cur.wonValue, prev.wonValue)}
          deltaSuffix="%"
          deltaTitle="Change from last month"
          hint={`${cur.wonCount} deals · last month ${fmt.tick(prev.wonValue)}`}
        />
        <Kpi
          icon={<FiCalendar />}
          label="Closing this month"
          value={fmt.tick(velocity.closingThisMonth.value)}
          hint={`${velocity.closingThisMonth.count} deals · ${fmt.tick(velocity.closingThisMonth.weighted)} weighted`}
        />
        <Kpi
          icon={<FiTarget />}
          label="Win rate (12 mo)"
          value={`${velocity.winRate12m}%`}
          progress={velocity.winRate12m}
          tone={velocity.winRate12m > 0 && velocity.winRate12m < 20 ? 'warn' : undefined}
          hint={`All time ${data.winRate}%`}
        />
        <Kpi
          icon={<FiClock />}
          label="Avg sales cycle"
          value={velocity.avgSalesCycleDays ? `${velocity.avgSalesCycleDays}d` : '—'}
          hint={`Open deals avg ${velocity.avgOpenDealAgeDays}d old`}
        />
        <Kpi
          icon={<FiZap />}
          label="New leads"
          value={cur.newLeads}
          delta={cur.newLeads - prev.newLeads || undefined}
          deltaTitle="Change from last month"
          hint={`This month · ${cur.newDeals} new deals`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <AttentionCard data={data} fmt={fmt} />
        </div>
        <SectionCard
          className="xl:col-span-2"
          title="Upcoming deadlines"
          description="Quotes expiring in 14 days and contract renewals in 60 days."
        >
          <DeadlineList data={data} fmt={fmt} />
        </SectionCard>
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
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" tickFormatter={fmt.tick} width={56} />
                  <Tooltip {...chartTooltipProps} formatter={(value, name) => [fmt.money(Number(value ?? 0)), String(name)]} />
                  <Legend />
                  <Area type="monotone" dataKey="total" name="Total" stroke={getChartColor(1)} fill="url(#crmTotal)" strokeWidth={2} />
                  <Area type="monotone" dataKey="weighted" name="Weighted" stroke={getChartColor(0)} fill="url(#crmWeighted)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          {data.unscheduledForecast.count > 0 && (
            <p className="mt-2 text-[11px] text-amber-500">
              {data.unscheduledForecast.count} open deals ({fmt.money(data.unscheduledForecast.total)}) have no expected close date and are not in this chart.
            </p>
          )}
        </SectionCard>

        <SectionCard className="xl:col-span-2" title="Deal mix" description="Open vs won vs lost.">
          {statusPie.length === 0 ? (
            <EmptyChart label="No deals yet." />
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

      <div className="grid gap-6 xl:grid-cols-5">
        <SectionCard
          className="xl:col-span-3"
          title="Biggest open deals"
          description="Where most of the pipeline value sits."
          actions={
            <Link to="/crm/deals" className="text-xs text-[color:var(--accent)] hover:underline">
              All deals →
            </Link>
          }
        >
          <DealTable deals={data.insights.topDeals} fmt={fmt} empty="No open deals." />
        </SectionCard>

        <SectionCard
          className="xl:col-span-2"
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
            <ul className="space-y-1 max-h-72 overflow-auto pr-1">
              {data.recentActivities.map((a) => (
                <li key={a._id} className="flex justify-between gap-3 text-sm py-2 px-2 rounded-lg hover:bg-[color:var(--bg-page)]">
                  <span className="min-w-0 truncate">
                    <span className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)] mr-1.5">{prettyName(a.type)}</span>
                    {a.subject}
                  </span>
                  <span className="shrink-0 text-[11px] text-[color:var(--text-muted)]">{shortDate(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
        <MiniStat label="Accounts" value={data.counts.accounts} to="/crm/accounts" />
        <MiniStat label="Contacts" value={data.counts.contacts} to="/crm/contacts" />
        <MiniStat label="Open leads" value={data.counts.leads} to="/crm/leads" />
        <MiniStat label="Quotes" value={data.counts.quotes} to="/crm/quotes" />
        <MiniStat label="Active contracts" value={fmt.tick(data.activeContractValue)} to="/crm/contracts" />
        <MiniStat label="Open tickets" value={data.counts.openTickets} tone={data.counts.openTickets > 0 ? 'warn' : undefined} />
      </div>
    </div>
  );
}

const ATTENTION_TABS = [
  { id: 'overdueDeals', label: 'Past close date' },
  { id: 'staleDeals', label: 'Stale deals' },
  { id: 'overdueActivities', label: 'Overdue tasks' },
  { id: 'overdueFollowUps', label: 'Missed follow-ups' },
] as const;

function AttentionCard({ data, fmt }: { data: CrmDash; fmt: Fmt }) {
  const att = data.insights.attention;
  const first = ATTENTION_TABS.find((t) => att[t.id].count > 0)?.id ?? 'overdueDeals';
  const [view, setView] = useState<(typeof ATTENTION_TABS)[number]['id']>(first);
  const total = ATTENTION_TABS.reduce((s, t) => s + att[t.id].count, 0);

  return (
    <SectionCard
      title="Needs attention"
      description={total ? `${total} items slipping — deals, tasks and follow-ups.` : 'Everything is on schedule.'}
    >
      <div className="flex flex-wrap gap-1.5 mb-3">
        {ATTENTION_TABS.map((t) => {
          const count = att[t.id].count;
          const active = view === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setView(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                active
                  ? 'border-[color:var(--accent)] bg-[color:var(--accent-subtle)] text-[color:var(--text-primary)]'
                  : 'border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
              }`}
            >
              {t.label}
              <span className={`tabular-nums rounded-full px-1.5 text-[10px] ${count ? 'bg-red-500/15 text-red-500' : 'bg-[color:var(--bg-elevated)]'}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {(view === 'overdueDeals' || view === 'staleDeals') && (
        <>
          <DealTable
            deals={att[view].items}
            fmt={fmt}
            mode={view === 'overdueDeals' ? 'overdue' : 'stale'}
            empty={view === 'overdueDeals' ? 'No open deals past their close date.' : `Every open deal was touched in the last ${att.staleDays} days.`}
          />
          {att[view].count > 0 && (
            <p className="mt-2 text-[11px] text-[color:var(--text-muted)]">
              {att[view].count} deals worth {fmt.money(att[view].value)}
              {view === 'staleDeals' ? ` with no update in ${att.staleDays}+ days.` : ' are past their expected close date.'}
            </p>
          )}
        </>
      )}

      {view === 'overdueActivities' &&
        (att.overdueActivities.items.length === 0 ? (
          <AllClear label="No overdue activities." />
        ) : (
          <ul className="divide-y divide-[color:var(--border-subtle)]">
            {att.overdueActivities.items.map((a) => (
              <li key={a._id}>
                <Link to={relatedLink(a.relatedType, a.relatedId)} className="flex items-start gap-2 py-2 -mx-2 px-2 rounded-lg hover:bg-[color:var(--bg-elevated)]">
                  <FiAlertTriangle className="mt-0.5 shrink-0 text-red-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] truncate">
                      <span className="text-[10px] uppercase tracking-wide text-[color:var(--text-muted)] mr-1.5">{prettyName(a.type)}</span>
                      {a.subject}
                    </span>
                    <span className="block text-[11px] text-[color:var(--text-muted)]">
                      Due {shortDate(a.dueAt)} · {-(daysFrom(a.dueAt) ?? 0)}d late · {a.assignee ?? 'unassigned'} · on {a.relatedType}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ))}

      {view === 'overdueFollowUps' &&
        (att.overdueFollowUps.items.length === 0 ? (
          <AllClear label="No missed lead follow-ups." />
        ) : (
          <ul className="divide-y divide-[color:var(--border-subtle)]">
            {att.overdueFollowUps.items.map((l) => (
              <li key={l._id}>
                <Link to={`/crm/leads/${l._id}`} className="flex items-start gap-2 py-2 -mx-2 px-2 rounded-lg hover:bg-[color:var(--bg-elevated)]">
                  <FiClock className="mt-0.5 shrink-0 text-amber-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] truncate">
                      {l.title}
                      {l.companyName && <span className="text-[color:var(--text-muted)]"> · {l.companyName}</span>}
                    </span>
                    <span className="block text-[11px] text-[color:var(--text-muted)]">
                      Follow-up was {shortDate(l.nextFollowUpAt)} · {prettyName(l.status)} · {l.assignee ?? 'unassigned'}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ))}

      {(view === 'overdueActivities' || view === 'overdueFollowUps') && att[view].count > att[view].items.length && (
        <Link
          to={view === 'overdueFollowUps' ? '/crm/follow-ups' : '/crm/activities'}
          className="mt-2 inline-block text-xs text-[color:var(--accent)] hover:underline"
        >
          {att[view].count} in total — see all →
        </Link>
      )}
    </SectionCard>
  );
}

function DealTable({ deals, fmt, empty, mode }: { deals: DealRef[]; fmt: Fmt; empty: string; mode?: 'overdue' | 'stale' }) {
  if (!deals.length) return <AllClear label={empty} />;
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)] text-left">
            <th className="py-1.5 px-1 font-medium">Deal</th>
            <th className="py-1.5 px-2 font-medium hidden sm:table-cell">Stage</th>
            <th className="py-1.5 px-2 font-medium text-right">Value</th>
            <th className="py-1.5 px-2 font-medium text-right hidden md:table-cell">Prob.</th>
            <th className="py-1.5 px-1 font-medium text-right">{mode === 'stale' ? 'Last update' : 'Close'}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--border-subtle)]">
          {deals.map((d) => {
            const closeIn = daysFrom(d.expectedCloseDate);
            const late = closeIn != null && closeIn < 0;
            return (
              <tr key={d._id} className="hover:bg-[color:var(--bg-elevated)]">
                <td className="py-2 px-1 min-w-0">
                  <Link to="/crm/deals" className="block truncate max-w-[16rem] font-medium hover:text-[color:var(--accent)]">
                    {d.title}
                  </Link>
                  <span className="block text-[11px] text-[color:var(--text-muted)] truncate max-w-[16rem]">
                    {d.accountId ? (
                      <Link to={`/crm/accounts/${d.accountId}`} className="hover:underline">
                        {d.account ?? 'Account'}
                      </Link>
                    ) : (
                      'No account'
                    )}
                    {' · '}
                    {d.owner ?? 'unassigned'}
                  </span>
                </td>
                <td className="py-2 px-2 hidden sm:table-cell">
                  <span className="rounded-full bg-[color:var(--bg-elevated)] px-2 py-0.5 text-[11px] whitespace-nowrap">{d.stage}</span>
                </td>
                <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{fmt.money(d.value)}</td>
                <td className="py-2 px-2 text-right tabular-nums hidden md:table-cell">{d.probability}%</td>
                <td className={`py-2 px-1 text-right text-[12px] whitespace-nowrap ${mode !== 'stale' && late ? 'text-red-500' : 'text-[color:var(--text-muted)]'}`}>
                  {mode === 'stale'
                    ? `${-(daysFrom(d.lastTouchedAt) ?? 0)}d ago`
                    : d.expectedCloseDate
                      ? `${shortDate(d.expectedCloseDate)}${late ? ` · ${-closeIn!}d late` : ''}`
                      : 'No date'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DeadlineList({ data, fmt }: { data: CrmDash; fmt: Fmt }) {
  const { expiringQuotes, renewals } = data.insights.attention;
  const rows = [
    ...expiringQuotes.map((q) => ({
      key: `q-${q._id}`,
      to: `/crm/quotes/${q._id}`,
      icon: <FiFileText className="text-sky-500" />,
      title: q.title,
      sub: `Quote expires · ${fmt.money(q.total)}`,
      date: q.validUntil,
    })),
    ...renewals.map((c) => ({
      key: `c-${c._id}`,
      to: c.accountId ? `/crm/accounts/${c.accountId}` : '/crm/contracts',
      icon: <FiRefreshCw className={c.autoRenew ? 'text-emerald-500' : 'text-amber-500'} />,
      title: c.title,
      sub: `${c.autoRenew ? 'Auto-renews' : 'Renewal due'}${c.account ? ` · ${c.account}` : ''} · ${fmt.money(c.value)}`,
      date: c.date,
    })),
  ].sort((a, b) => new Date(a.date ?? 0).getTime() - new Date(b.date ?? 0).getTime());

  if (!rows.length) return <AllClear label="No quotes expiring or contracts up for renewal soon." />;
  return (
    <ul className="divide-y divide-[color:var(--border-subtle)] max-h-80 overflow-auto pr-1">
      {rows.map((r) => {
        const days = daysFrom(r.date);
        return (
          <li key={r.key}>
            <Link to={r.to} className="flex items-start gap-2 py-2 -mx-2 px-2 rounded-lg hover:bg-[color:var(--bg-elevated)]">
              <span className="mt-0.5 shrink-0">{r.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] truncate">{r.title}</span>
                <span className="block text-[11px] text-[color:var(--text-muted)] truncate">{r.sub}</span>
              </span>
              <span className={`shrink-0 text-[11px] tabular-nums ${days != null && days <= 7 ? 'text-amber-500' : 'text-[color:var(--text-muted)]'}`}>
                {days === 0 ? 'today' : `in ${days}d`}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/* ───────────────────────── Pipeline ───────────────────────── */

function PipelineTab({ data, fmt }: { data: CrmDash; fmt: Fmt }) {
  const { velocity, lossReasons, quoteAcceptanceRate } = data.insights;
  const stageChart = data.dealsByStage.map((s) => ({ name: s.name, deals: s.count, value: s.value }));
  const maxStage = Math.max(1, ...data.dealsByStage.map((s) => s.count));
  const maxLoss = Math.max(1, ...lossReasons.map((r) => r.count));

  return (
    <div className="space-y-6">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Kpi icon={<FiDollarSign />} label="Avg won deal" value={velocity.avgWonDealSize ? fmt.tick(velocity.avgWonDealSize) : '—'} hint="Last 12 months" />
        <Kpi icon={<FiClock />} label="Avg sales cycle" value={velocity.avgSalesCycleDays ? `${velocity.avgSalesCycleDays} days` : '—'} hint="Created → won" />
        <Kpi
          icon={<FiFileText />}
          label="Quote acceptance"
          value={`${quoteAcceptanceRate}%`}
          progress={quoteAcceptanceRate}
          hint="Accepted of decided quotes"
        />
        <Kpi icon={<FiPieChart />} label="Active contracts" value={fmt.tick(data.activeContractValue)} hint={`${data.counts.contracts} contracts total`} />
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
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} stroke="var(--text-muted)" tickFormatter={fmt.tick} width={56} />
                  <Tooltip
                    {...chartTooltipProps}
                    formatter={(value, name) =>
                      String(name) === 'Value' ? [fmt.money(Number(value ?? 0)), 'Value'] : [Number(value ?? 0), 'Deals']
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

        <SectionCard title="Stage funnel" description="How many open deals sit at each step of the pipeline.">
          {data.dealsByStage.length === 0 ? (
            <EmptyChart label="No open deals in the pipeline." />
          ) : (
            <ul className="space-y-2.5">
              {data.dealsByStage.map((s, i) => (
                <li key={`${s.name}-${i}`}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="truncate font-medium">{s.name}</span>
                    <span className="tabular-nums text-[color:var(--text-muted)]">
                      {s.count} · {fmt.money(s.value)}
                    </span>
                  </div>
                  <div className="h-6 rounded-md bg-[color:var(--bg-elevated)] overflow-hidden">
                    <div
                      className="h-full rounded-md"
                      style={{ width: `${(s.count / maxStage) * 100}%`, background: getChartColor(i) }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
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
                  <Bar dataKey="won" name="Won" stackId="a" fill={getChartColor(2)} />
                  <Bar dataKey="lost" name="Lost" stackId="a" fill={getChartColor(4)} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Why deals are lost" description="Loss reasons over the last 12 months.">
          {lossReasons.length === 0 ? (
            <AllClear label="No lost deals in the last 12 months." />
          ) : (
            <ul className="space-y-2.5 text-xs">
              {lossReasons.map((r) => (
                <li key={r.name}>
                  <div className="flex justify-between mb-1">
                    <span className="truncate">{r.name}</span>
                    <span className="tabular-nums text-[color:var(--text-muted)]">
                      {r.count} · {fmt.money(r.value)}
                    </span>
                  </div>
                  <RateBar value={(r.count / maxLoss) * 100} tone="bad" />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <StatusTable title="Quotes by status" rows={data.quotesByStatus} fmt={fmt} to="/crm/quotes" />
        <StatusTable title="Contracts by status" rows={data.contractsByStatus} fmt={fmt} to="/crm/contracts" />
      </div>
    </div>
  );
}

function StatusTable({ title, rows, fmt, to }: { title: string; rows: Array<{ name: string; count: number; value: number }>; fmt: Fmt; to: string }) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <SectionCard
      title={title}
      actions={
        <Link to={to} className="text-xs text-[color:var(--accent)] hover:underline">
          Open →
        </Link>
      }
    >
      {total === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)] py-6 text-center">Nothing here yet.</p>
      ) : (
        <ul className="space-y-2.5 text-xs">
          {rows.map((r, i) => (
            <li key={r.name} className="grid grid-cols-[6rem_1fr_auto] items-center gap-3">
              <span className="truncate">{prettyName(r.name)}</span>
              <div className="h-1.5 rounded-full bg-[color:var(--bg-elevated)] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(r.count / total) * 100}%`, background: getChartColor(i) }} />
              </div>
              <span className="tabular-nums text-[color:var(--text-muted)] text-right">
                {r.count} · {fmt.tick(r.value)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/* ───────────────────────── Leads ───────────────────────── */

function LeadsTab({ data }: { data: CrmDash }) {
  const { leadSources, leadTrend, momentum, attention } = data.insights;
  const leadPie = data.leadsByStatus.filter((d) => d.count > 0).map((d) => ({ ...d, name: prettyName(d.name) }));
  const created6 = leadTrend.reduce((s, r) => s + r.created, 0);
  const converted6 = leadTrend.reduce((s, r) => s + r.converted, 0);
  const best = [...leadSources].filter((s) => s.total >= 3).sort((a, b) => b.conversionRate - a.conversionRate)[0];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon={<FiZap />}
          label="New leads this month"
          value={momentum.thisMonth.newLeads}
          delta={momentum.thisMonth.newLeads - momentum.lastMonth.newLeads || undefined}
          deltaTitle="Change from last month"
          hint={`Last month ${momentum.lastMonth.newLeads}`}
        />
        <Kpi
          icon={<FiTarget />}
          label="Conversion (6 mo)"
          value={`${created6 ? Math.round((converted6 / created6) * 1000) / 10 : 0}%`}
          hint={`${converted6} of ${created6} leads converted`}
        />
        <Kpi icon={<FiAward />} label="Best source" value={best ? prettyName(best.name) : '—'} hint={best ? `${best.conversionRate}% conversion` : 'Needs 3+ leads per source'} />
        <Kpi
          icon={<FiClock />}
          label="Missed follow-ups"
          value={attention.overdueFollowUps.count}
          tone={attention.overdueFollowUps.count ? 'bad' : undefined}
          hint={<Link to="/crm/follow-ups" className="hover:underline">Open follow-ups →</Link>}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <SectionCard className="xl:col-span-3" title="Lead flow" description="Leads created per month, and how many of them have converted.">
          {leadTrend.every((r) => !r.created) ? (
            <EmptyChart label="No leads in the last 6 months." />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={leadTrend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" allowDecimals={false} />
                  <Tooltip {...chartTooltipProps} />
                  <Legend />
                  <Line type="monotone" dataKey="created" name="Created" stroke={getChartColor(0)} strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="converted" name="Converted" stroke={getChartColor(2)} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard className="xl:col-span-2" title="Leads by status">
          {leadPie.length === 0 ? (
            <EmptyChart label="No leads yet." />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={leadPie} dataKey="count" nameKey="name" cx="50%" cy="45%" innerRadius="45%" outerRadius="70%" paddingAngle={2}>
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
      </div>

      <SectionCard
        title="Source performance"
        description="Volume and conversion by lead source — invest in what converts."
        actions={
          <Link to="/crm/leads" className="text-xs text-[color:var(--accent)] hover:underline">
            Leads →
          </Link>
        }
      >
        {leadSources.length === 0 ? (
          <p className="text-sm text-[color:var(--text-muted)] py-6 text-center">No leads yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)] text-left">
                  <th className="py-1.5 pr-3 font-medium">Source</th>
                  <th className="py-1.5 px-3 font-medium text-right">Leads</th>
                  <th className="py-1.5 px-3 font-medium text-right">Converted</th>
                  <th className="py-1.5 px-3 font-medium text-right hidden sm:table-cell">Unqualified</th>
                  <th className="py-1.5 pl-3 font-medium w-1/3">Conversion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border-subtle)]">
                {leadSources.map((s) => (
                  <tr key={s.name}>
                    <td className="py-2 pr-3 font-medium">{prettyName(s.name)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{s.total}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{s.converted}</td>
                    <td className="py-2 px-3 text-right tabular-nums hidden sm:table-cell text-[color:var(--text-muted)]">{s.unqualified}</td>
                    <td className="py-2 pl-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <RateBar value={s.conversionRate} tone={s.conversionRate >= 25 ? 'good' : 'accent'} />
                        </div>
                        <span className="w-12 text-right tabular-nums text-xs">{s.conversionRate}%</span>
                      </div>
                    </td>
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

/* ───────────────────────── Team ───────────────────────── */

function TeamTab({ data, fmt }: { data: CrmDash; fmt: Fmt }) {
  const { leaderboard, activityCadence, attention } = data.insights;
  const activityBars = data.activitiesByType.slice(0, 8).map((a) => ({ ...a, name: prettyName(a.name) }));
  const maxWon = Math.max(1, ...leaderboard.map((r) => r.wonValue));
  const cadenceDelta = activityCadence.last30 - activityCadence.prev30;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Kpi icon={<FiUsers />} label="Deal owners" value={leaderboard.filter((r) => r.id).length} hint={`${leaderboard.find((r) => !r.id)?.openCount ?? 0} open deals unassigned`} />
        <Kpi
          icon={<FiActivity />}
          label="Activities (30 d)"
          value={activityCadence.last30}
          delta={cadenceDelta || undefined}
          deltaTitle="Change from the previous 30 days"
          hint={`Previous 30 days ${activityCadence.prev30}`}
        />
        <Kpi
          icon={<FiAlertTriangle />}
          label="Overdue tasks"
          value={attention.overdueActivities.count}
          tone={attention.overdueActivities.count ? 'bad' : undefined}
          hint="Calls, meetings & tasks past due"
        />
        <Kpi
          icon={<FiClock />}
          label="Stale deals"
          value={attention.staleDeals.count}
          tone={attention.staleDeals.count ? 'warn' : undefined}
          hint={`No update in ${attention.staleDays}+ days`}
        />
      </div>

      <SectionCard title="Sales leaderboard" description="Won revenue and win rate over the last 12 months, with each owner's open pipeline.">
        {leaderboard.length === 0 ? (
          <p className="text-sm text-[color:var(--text-muted)] py-6 text-center">No deals yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)] text-left">
                  <th className="py-1.5 pr-3 font-medium">Owner</th>
                  <th className="py-1.5 px-3 font-medium w-1/4">Won</th>
                  <th className="py-1.5 px-3 font-medium text-right">Win rate</th>
                  <th className="py-1.5 px-3 font-medium text-right hidden md:table-cell">Open deals</th>
                  <th className="py-1.5 px-3 font-medium text-right hidden sm:table-cell">Open value</th>
                  <th className="py-1.5 pl-3 font-medium text-right hidden lg:table-cell">Weighted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border-subtle)]">
                {leaderboard.map((r, i) => (
                  <tr key={r.id ?? 'unassigned'}>
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="w-4 text-[11px] text-[color:var(--text-muted)] tabular-nums">{i + 1}</span>
                        <Avatar name={r.name} />
                        <span className={`truncate ${r.id ? 'font-medium' : 'italic text-[color:var(--text-muted)]'}`}>{r.name}</span>
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <RateBar value={(r.wonValue / maxWon) * 100} tone="good" />
                        </div>
                        <span className="tabular-nums text-xs whitespace-nowrap">
                          {fmt.tick(r.wonValue)} <span className="text-[color:var(--text-muted)]">({r.wonCount})</span>
                        </span>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">{r.wonCount + r.lostCount ? `${r.winRate}%` : '—'}</td>
                    <td className="py-2 px-3 text-right tabular-nums hidden md:table-cell">{r.openCount}</td>
                    <td className="py-2 px-3 text-right tabular-nums hidden sm:table-cell">{fmt.tick(r.openValue)}</td>
                    <td className="py-2 pl-3 text-right tabular-nums hidden lg:table-cell text-[color:var(--text-muted)]">{fmt.tick(r.weighted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Activity mix" description="All logged calls, meetings, emails and tasks by type.">
        {activityBars.length === 0 ? (
          <EmptyChart label="No activities logged." h="h-56" />
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activityBars} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--text-muted)" allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                <Tooltip {...chartTooltipProps} />
                <Bar dataKey="count" name="Count" fill={getChartColor(1)} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
