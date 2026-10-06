import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { serviceApi } from '../../lib/api';

type Report = Awaited<ReturnType<typeof serviceApi.csatReport>>['data'];

/** CSAT over 30/90/365 days: score, rating spread, per-agent averages and what customers said. */
export default function CsatReportCard({ token }: { token: string }) {
  const [days, setDays] = useState(90);
  const [data, setData] = useState<Report | null>(null);

  useEffect(() => {
    serviceApi.csatReport(days, token).then((r) => setData(r.success && r.data ? r.data : null));
  }, [days, token]);

  const max = Math.max(1, ...(data?.distribution ?? []).map((d) => d.count));

  return (
    <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">Customer satisfaction</h2>
          <p className="text-xs text-[color:var(--text-muted)]">
            {data
              ? `${data.responses} ratings${data.responseRate !== null ? ` · ${Math.round(data.responseRate * 100)}% of resolved tickets rated` : ''}`
              : 'Loading…'}
          </p>
        </div>
        <select
          className="rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-2 py-1 text-xs"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last 12 months</option>
        </select>
      </div>

      {data && data.responses === 0 && <p className="text-sm text-[color:var(--text-muted)]">No ratings in this period yet.</p>}
      {data && data.responses > 0 && (
        <div className="grid gap-5 md:grid-cols-3">
          <div>
            <p className="text-3xl font-semibold text-[color:var(--text-primary)]">{data.csatPercent}%</p>
            <p className="text-xs text-[color:var(--text-muted)]">rated 4–5 · average {data.average}/5</p>
            <div className="mt-3 space-y-1">
              {[...data.distribution].reverse().map((d) => (
                <div key={d.score} className="flex items-center gap-2 text-[11px]">
                  <span className="w-6 text-[color:var(--text-muted)]">{d.score}★</span>
                  <div className="h-2 flex-1 rounded bg-[color:var(--bg-page)]">
                    <div className="h-2 rounded bg-[color:var(--accent)]" style={{ width: `${(d.count / max) * 100}%` }} />
                  </div>
                  <span className="w-6 text-right text-[color:var(--text-muted)]">{d.count}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-[color:var(--text-primary)]">By agent</p>
            <ul className="space-y-1 text-xs">
              {data.byAgent.map((a) => (
                <li key={a.agent} className="flex justify-between gap-2">
                  <span className="truncate">{a.agent}</span>
                  <span className="text-[color:var(--text-muted)]">
                    {a.average}/5 · {a.count}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-[color:var(--text-primary)]">Recent comments</p>
            <ul className="space-y-2 text-xs">
              {data.recentComments.length === 0 && <li className="text-[color:var(--text-muted)]">No comments.</li>}
              {data.recentComments.map((c) => (
                <li key={c.ticketId}>
                  <Link to={`/service/tickets?ticket=${c.ticketId}`} className="text-[color:var(--accent)] hover:underline">
                    {c.score}★ {c.subject}
                  </Link>
                  <p className="text-[color:var(--text-muted)] line-clamp-2">“{c.comment}”</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
