import { useEffect, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useAuth } from '../../contexts/AuthContext';
import { hrmsApi } from '../../lib/api';
import MetricCard from '../../components/MetricCard';
import SectionCard from '../../components/SectionCard';
import { chartTooltipProps, getChartColor } from '../../lib/chartTheme';
import { EmptyChart, LoadingCard, ModuleHeader, StatusPill, money } from '../../components/moduleKit';

type Dash = {
  counts: { headcount: number; active: number; onLeave: number; pendingLeave: number; approvedLeaveThisMonth: number; departments: number };
  monthlyPayroll: number;
  annualPayroll: number;
  byDepartment: { name: string; count: number }[];
  byType: { name: string; value: number }[];
  byStatus: { name: string; value: number }[];
  attendanceMix: { name: string; value: number }[];
  headcountTrend: { month: string; headcount: number; joined: number }[];
  pendingLeaveRequests: Array<{ _id: string; type: string; days: number; startDate: string; employeeId?: { name?: string } }>;
};

export default function HrmsDashboard() {
  const { token } = useAuth();
  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    hrmsApi.dashboard(token).then((res) => {
      setLoading(false);
      if (res.success && res.data) setData(res.data as Dash);
    });
  }, [token]);

  if (loading) return <LoadingCard label="Loading HRMS dashboard…" />;
  if (!data) return <div className="p-8 text-red-400">Failed to load HRMS dashboard.</div>;

  const typePie = data.byType.filter((d) => d.value > 0);
  const statusPie = data.byStatus.filter((d) => d.value > 0);
  const attendancePie = data.attendanceMix.filter((d) => d.value > 0);

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-6">
      <ModuleHeader
        eyebrow="People"
        title="HRMS dashboard"
        subtitle="Headcount, attendance, leave, and payroll for the workspace."
        actions={[
          { to: '/hrms/employees', label: 'Employees', primary: true },
          { to: '/hrms/leave', label: 'Leave' },
          { to: '/hrms/payroll', label: 'Payroll' },
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Headcount" value={data.counts.headcount} helperText={`${data.counts.active} active · ${data.counts.departments} departments`} />
        <MetricCard title="Monthly payroll" value={money(data.monthlyPayroll)} helperText={`ARR ${money(data.annualPayroll)}`} />
        <MetricCard title="On leave" value={data.counts.onLeave} helperText={`${data.counts.approvedLeaveThisMonth} approved this month`} />
        <MetricCard title="Pending leave" value={data.counts.pendingLeave} helperText="Awaiting approval" />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <SectionCard className="xl:col-span-3" title="Headcount trend" description="Net headcount over the last 6 months.">
          {data.headcountTrend.every((r) => r.headcount === 0) ? (
            <EmptyChart label="No employees yet." />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.headcountTrend} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="hcGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={getChartColor(0)} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={getChartColor(0)} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" allowDecimals={false} />
                  <Tooltip {...chartTooltipProps} />
                  <Legend />
                  <Area type="monotone" dataKey="headcount" name="Headcount" stroke={getChartColor(0)} fill="url(#hcGrad)" strokeWidth={2} />
                  <Bar dataKey="joined" name="Joined" fill={getChartColor(2)} radius={[4, 4, 0, 0]} barSize={16} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard className="xl:col-span-2" title="Employment type">
          {typePie.length === 0 ? (
            <EmptyChart label="No employees yet." />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={typePie} dataKey="value" nameKey="name" cx="42%" cy="50%" innerRadius="48%" outerRadius="72%" paddingAngle={3}>
                    {typePie.map((_, i) => (
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

      <div className="grid gap-6 xl:grid-cols-3">
        <SectionCard title="Headcount by department">
          {data.byDepartment.length === 0 ? (
            <EmptyChart label="No departments yet." />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byDepartment} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--text-muted)" allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="var(--text-muted)" width={90} />
                  <Tooltip {...chartTooltipProps} />
                  <Bar dataKey="count" name="Employees" fill={getChartColor(5)} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Attendance mix (this month)">
          {attendancePie.length === 0 ? (
            <EmptyChart label="No attendance recorded." />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={attendancePie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="75%">
                    {attendancePie.map((_, i) => (
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

        <SectionCard title="Status breakdown">
          {statusPie.length === 0 ? (
            <EmptyChart label="No employees yet." />
          ) : (
            <ul className="space-y-2.5 pt-1">
              {data.byStatus.map((s, i) => (
                <li key={s.name} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 capitalize">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: getChartColor(i) }} />
                    {s.name}
                  </span>
                  <span className="tabular-nums font-medium">{s.value}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Pending leave requests">
        {data.pendingLeaveRequests.length === 0 ? (
          <p className="text-sm text-[color:var(--text-muted)] py-6 text-center">No pending requests. 🎉</p>
        ) : (
          <ul className="divide-y divide-[color:var(--border-subtle)]">
            {data.pendingLeaveRequests.map((l) => (
              <li key={l._id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <p className="font-medium">{l.employeeId?.name ?? 'Employee'}</p>
                  <p className="text-[11px] text-[color:var(--text-muted)]">{new Date(l.startDate).toLocaleDateString()} · {l.days}d</p>
                </div>
                <StatusPill label={l.type} tone="amber" />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
