import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import { api } from '../lib/api';
import { formatDateDDMMYYYY, toIsoDateString, todayIsoDate } from '../lib/dateFormat';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { ResponsiveContainer } from '../components/charts/ResponsiveContainer';
import { getChartColor } from '../lib/chartTheme';
import { userHasPermission } from '../utils/permissions';
import { TASK_FLOW_PERMISSIONS } from '@shared/constants/permissions';

interface UsageStats {
  dailyActiveUsers: Array<{ date: string; count: number }>;
  actionsByType: Array<{ action: string; count: number }>;
  topUsers: Array<{ userId: string; userName: string; count: number }>;
}

export default function Analytics() {
  const { token, user } = useAuth();
  const [data, setData] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toIsoDateString(d);
  });
  const [to, setTo] = useState(() => todayIsoDate());

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError('');
    api
      .get<UsageStats>(`/analytics/usage?from=${from}&to=${to}`, token)
      .then((res) => {
        setLoading(false);
        if (res.success && res.data) setData(res.data);
        else setError(res.message ?? 'Failed to load');
      })
      .catch(() => {
        setLoading(false);
        setError('Failed to load');
      });
  }, [token, from, to, user?.activeOrganizationId]);

  if (
    user?.role !== 'admin' &&
    !userHasPermission(user?.permissions ?? [], TASK_FLOW_PERMISSIONS.TASKFLOW.ANALYTICS.VIEW)
  ) {
    return (
      <div className="p-8">
        <p className="text-[color:var(--text-muted)]">Access denied.</p>
      </div>
    );
  }

  return (
    <div className="p-8 animate-fade-in">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <h1 className="text-xl font-semibold mb-1">Usage Analytics</h1>
        <p className="text-[13px] text-[color:var(--text-muted)] mb-6">
          Daily active users, actions by type, and top users.
        </p>

        <div className="flex flex-wrap gap-4 mb-6">
          <div>
            <label className="block text-xs text-[color:var(--text-muted)] mb-1">From</label>
            <DateInputDDMMYYYY
              value={from}
              onChange={setFrom}
              className="px-3 py-2 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm w-[11rem]"
            />
          </div>
          <div>
            <label className="block text-xs text-[color:var(--text-muted)] mb-1">To</label>
            <DateInputDDMMYYYY
              value={to}
              onChange={setTo}
              className="px-3 py-2 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm w-[11rem]"
            />
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-8 text-center text-[color:var(--text-muted)] animate-pulse">
            Loading…
          </div>
        ) : error ? (
          <div className="rounded-2xl bg-red-500/10 border border-red-500/30 p-6 text-red-400">{error}</div>
        ) : data ? (
          <div className="space-y-6">
            {data.dailyActiveUsers.length > 0 && (
              <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-5">
                <h3 className="text-sm font-semibold text-[color:var(--text-primary)] mb-4">Daily active users</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.dailyActiveUsers}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10 }}
                        stroke="var(--text-muted)"
                        tickFormatter={(v) => (typeof v === 'string' ? formatDateDDMMYYYY(v) : String(v))}
                        interval="preserveStartEnd"
                      />
                      <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                      <Tooltip
                        contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
                        labelFormatter={(v) => formatDateDDMMYYYY(String(v))}
                      />
                      <Bar dataKey="count" name="DAU" fill={getChartColor(0)} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {data.actionsByType.length > 0 && (
              <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-5">
                <h3 className="text-sm font-semibold text-[color:var(--text-primary)] mb-4">Actions by type</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.actionsByType} layout="vertical" margin={{ left: 80 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                      <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                      <YAxis type="category" dataKey="action" tick={{ fontSize: 11 }} stroke="var(--text-muted)" width={70} />
                      <Tooltip
                        contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
                      />
                      <Bar dataKey="count" name="Count" fill={getChartColor(1)} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {data.topUsers.length > 0 && (
              <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-5">
                <h3 className="text-sm font-semibold text-[color:var(--text-primary)] mb-4">Top users by activity</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[color:var(--border-subtle)]">
                      <th className="text-left py-2 text-[color:var(--text-muted)] font-medium">User</th>
                      <th className="text-right py-2 text-[color:var(--text-muted)] font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topUsers.map((u) => (
                      <tr key={u.userId} className="border-b border-[color:var(--border-subtle)]/60 last:border-b-0">
                        <td className="py-2 text-[color:var(--text-primary)]">{u.userName}</td>
                        <td className="py-2 text-right text-[color:var(--text-muted)]">{u.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {data.dailyActiveUsers.length === 0 && data.actionsByType.length === 0 && data.topUsers.length === 0 && (
              <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-8 text-center text-[color:var(--text-muted)]">
                No usage data for this period.
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
