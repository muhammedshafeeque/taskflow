import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { FiActivity, FiAlertTriangle, FiArrowDownRight, FiArrowUpRight, FiCheckCircle, FiMoreHorizontal, FiPlus, FiTarget, FiUserX, FiZap } from 'react-icons/fi';
import type { DashboardOverview, OverviewIssueRef } from '../../lib/api';
import { chartTooltipProps } from '../../lib/chartTheme';
import { HEALTH, SERIES, STATUS_FALLBACK, daysLabel, fmtDate, initials, issueLink, timeAgo, useDismiss } from './pmFormat';

/** Building blocks shared by the PM dashboard and the project dashboard. */

export function Card({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] card-shadow p-4 sm:p-5 min-w-0">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[color:var(--border-subtle)] p-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-[color:var(--text-muted)]">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Avatar({ name }: { name?: string }) {
  return (
    <span className="shrink-0 w-7 h-7 rounded-full bg-[color:var(--accent-subtle)] text-[color:var(--accent)] text-[10px] font-semibold grid place-items-center" title={name}>
      {initials(name)}
    </span>
  );
}

export function Kpi({
  icon,
  label,
  value,
  hint,
  tone,
  delta,
  deltaSuffix = '',
  deltaGoodWhenDown = false,
  deltaTitle = 'Change from last week',
  progress,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'good' | 'warn' | 'bad';
  delta?: number;
  deltaSuffix?: string;
  deltaGoodWhenDown?: boolean;
  deltaTitle?: string;
  progress?: number;
}) {
  const toneCls = tone === 'bad' ? 'text-red-500' : tone === 'warn' ? 'text-amber-500' : 'text-[color:var(--text-primary)]';
  const good = delta != null && (deltaGoodWhenDown ? delta < 0 : delta > 0);
  return (
    <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-4 py-3.5 card-shadow">
      <div className="flex items-center justify-between text-[color:var(--text-muted)]">
        <span className="text-[11px] font-medium uppercase tracking-wider truncate">{label}</span>
        <span className="opacity-70">{icon}</span>
      </div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className={`text-2xl font-bold tabular-nums ${toneCls}`}>{value}</span>
        {delta != null && delta !== 0 && (
          <span className={`inline-flex items-center text-[11px] font-medium ${good ? 'text-emerald-500' : 'text-amber-500'}`} title={deltaTitle}>
            {delta > 0 ? <FiArrowUpRight /> : <FiArrowDownRight />}
            {Math.abs(delta)}
            {deltaSuffix}
          </span>
        )}
      </div>
      {progress != null && (
        <div className="mt-1.5 h-1 rounded-full bg-[color:var(--bg-elevated)] overflow-hidden">
          <div className="h-full rounded-full bg-[color:var(--accent)]" style={{ width: `${progress}%` }} />
        </div>
      )}
      {hint && <div className="text-[11px] text-[color:var(--text-muted)] mt-1 truncate">{hint}</div>}
    </div>
  );
}

export function FlowVerdict({ trend }: { trend: DashboardOverview['trend'] }) {
  const recent = trend.slice(-4);
  const created = recent.reduce((s, w) => s + w.created, 0);
  const completed = recent.reduce((s, w) => s + w.completed, 0);
  if (!created && !completed) return null;
  const diff = completed - created;
  const cls = diff >= 0 ? 'bg-emerald-500/15 text-emerald-500' : 'bg-amber-500/15 text-amber-500';
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`} title="Last 4 weeks">
      {diff >= 0 ? `Backlog shrinking by ${diff}` : `Backlog growing by ${-diff}`}
    </span>
  );
}

export function TrendChart({ trend }: { trend: DashboardOverview['trend'] }) {
  const rows = trend.map((w) => ({ ...w, label: fmtDate(w.weekStart) }));
  const totals = { created: trend.reduce((s, w) => s + w.created, 0), completed: trend.reduce((s, w) => s + w.completed, 0) };
  return (
    <div>
      <div className="flex flex-wrap gap-4 text-xs mb-2">
        {(['created', 'completed'] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5 text-[color:var(--text-muted)]">
            <span className="w-3 h-0.5 rounded-full" style={{ background: SERIES[k] }} />
            <span className="capitalize">{k}</span>
            <span className="font-semibold text-[color:var(--text-primary)] tabular-nums">{totals[k]}</span>
          </span>
        ))}
      </div>
      <div className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border-subtle)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
            <Tooltip {...chartTooltipProps} labelFormatter={(l) => `Week of ${l}`} cursor={{ stroke: 'var(--border-subtle)' }} />
            <Line type="monotone" dataKey="created" name="Created" stroke={SERIES.created} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--bg-surface)' }} />
            <Line type="monotone" dataKey="completed" name="Completed" stroke={SERIES.completed} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--bg-surface)' }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function HoursChart({ trend }: { trend: DashboardOverview['trend'] }) {
  const rows = trend.map((w) => ({ ...w, label: fmtDate(w.weekStart) }));
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border-subtle)" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
          <Tooltip {...chartTooltipProps} labelFormatter={(l) => `Week of ${l}`} formatter={(v) => [`${v}h`, 'Logged']} cursor={{ fill: 'var(--bg-elevated)' }} />
          <Bar dataKey="loggedHours" fill={SERIES.created} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Neutral steps for statuses without a colour of their own; closed statuses use the success hue. */

export function StatusBreakdown({ rows }: { rows: DashboardOverview['byStatus'] }) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (!total) return <p className="text-sm text-[color:var(--text-muted)]">No issues yet.</p>;
  const colored = rows.map((r, i) => ({ ...r, fill: r.color || (r.closed ? '#10b981' : STATUS_FALLBACK[i % STATUS_FALLBACK.length]) }));
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden gap-[2px] mb-3">
        {colored.map((r) => (
          <span key={r.name} style={{ width: `${(r.count / total) * 100}%`, background: r.fill }} title={`${r.name}: ${r.count}`} />
        ))}
      </div>
      <ul className="space-y-1.5 text-xs">
        {colored.map((r) => (
          <li key={r.name} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: r.fill }} />
            <span className="flex-1 truncate">
              {r.name}
              {r.closed && <FiCheckCircle className="inline ml-1 text-emerald-500" aria-label="closed status" />}
            </span>
            <span className="tabular-nums text-[color:var(--text-muted)]">{Math.round((r.count / total) * 100)}%</span>
            <span className="w-8 text-right tabular-nums font-medium">{r.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BarList({ rows, keepOrder = false }: { rows: Array<{ name: string; count: number }>; keepOrder?: boolean }) {
  if (!rows.length || rows.every((r) => !r.count)) return <p className="text-sm text-[color:var(--text-muted)]">No open work.</p>;
  const max = Math.max(1, ...rows.map((r) => r.count));
  // Ordered rows (like age buckets) are shown whole; ranked rows fold the tail into "Other".
  const shown = keepOrder ? rows : rows.slice(0, 6);
  const other = keepOrder ? 0 : rows.slice(6).reduce((s, r) => s + r.count, 0);
  return (
    <ul className="space-y-2 text-xs">
      {[...shown, ...(other ? [{ name: 'Other', count: other }] : [])].map((r) => (
        <li key={r.name}>
          <div className="flex justify-between mb-0.5">
            <span className="truncate">{r.name}</span>
            <span className="tabular-nums font-medium">{r.count}</span>
          </div>
          <div className="h-1.5 rounded-full bg-[color:var(--bg-elevated)] overflow-hidden">
            <div className="h-full rounded-full bg-[color:var(--accent)]" style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function AttentionList({ data, onMore, moreLabel }: { data: DashboardOverview; onMore?: () => void; moreLabel?: string }) {
  const items = [
    ...data.attention.overdue.map((i) => ({ i, reason: 'overdue' as const })),
    ...data.attention.unassignedDueSoon.filter((u) => !data.attention.overdue.some((o) => o.id === u.id)).map((i) => ({ i, reason: 'unowned' as const })),
  ].slice(0, 8);
  if (!items.length)
    return (
      <div className="py-6 text-center text-sm text-[color:var(--text-muted)]">
        <FiCheckCircle className="mx-auto mb-2 text-emerald-500 text-xl" />
        Nothing overdue or unowned. Nice.
      </div>
    );
  return (
    <div>
      <ul className="divide-y divide-[color:var(--border-subtle)]">
        {items.map(({ i, reason }) => (
          <li key={i.id}>
            <Link to={issueLink(i)} className="flex items-start gap-2 py-2 hover:bg-[color:var(--bg-elevated)] -mx-2 px-2 rounded-lg">
              {reason === 'overdue' ? <FiAlertTriangle className="mt-0.5 shrink-0 text-red-500" /> : <FiUserX className="mt-0.5 shrink-0 text-amber-500" />}
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] truncate">
                  <span className="font-mono text-[11px] text-[color:var(--text-muted)] mr-1">{i.key}</span>
                  {i.title}
                </span>
                <span className="block text-[11px] text-[color:var(--text-muted)]">
                  {reason === 'overdue' ? `Due ${fmtDate(i.dueDate)} · ${i.assignee?.name ?? 'unassigned'}` : `No owner · due ${fmtDate(i.dueDate)}`}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {onMore && data.kpis.overdue > items.length && (
        <button type="button" onClick={onMore} className="mt-2 text-xs text-[color:var(--accent)] hover:underline">
          {data.kpis.overdue} overdue in total — {moreLabel ?? 'see more'} →
        </button>
      )}
    </div>
  );
}

const PROJECT_MENU: Array<{ path: string; label: string }> = [
  { path: 'dashboard', label: 'Dashboard' },
  { path: 'issues', label: 'Issues' },
  { path: 'boards', label: 'Board' },
  { path: 'backlog', label: 'Backlog' },
  { path: 'sprints', label: 'Sprints' },
  { path: 'roadmap', label: 'Roadmap' },
  { path: 'gantt', label: 'Gantt' },
  { path: 'timesheet', label: 'Timesheet' },
  { path: 'settings', label: 'Settings' },
];

export function ProjectRows({ projects, compact = false }: { projects: DashboardOverview['projects']; compact?: boolean }) {
  if (!projects.length) return <p className="text-sm text-[color:var(--text-muted)]">No projects match.</p>;
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-[color:var(--text-muted)] border-b border-[color:var(--border-subtle)]">
            <th className="py-2 px-1 font-medium">Project</th>
            <th className="py-2 px-2 font-medium">Health</th>
            <th className="py-2 px-2 font-medium w-40">Progress</th>
            <th className="py-2 px-2 font-medium text-right">Open</th>
            <th className="py-2 px-2 font-medium text-right">Overdue</th>
            {!compact && <th className="py-2 px-2 font-medium text-right">Unassigned</th>}
            {!compact && <th className="py-2 px-2 font-medium text-right">Done / new 14d</th>}
            {!compact && <th className="py-2 px-2 font-medium">Sprint · milestone</th>}
            <th className="py-2 px-1" />
          </tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--border-subtle)]">
          {projects.map((p) => (
            <tr key={p.id} className="hover:bg-[color:var(--bg-elevated)]/50">
              <td className="py-2 px-1">
                <Link to={`/projects/${p.id}/dashboard`} className="hover:text-[color:var(--accent)]">
                  <span className="font-mono text-[11px] text-[color:var(--text-muted)] mr-1.5">{p.key}</span>
                  <span className="font-medium">{p.name}</span>
                </Link>
                {!compact && p.lastActivity && <span className="block text-[10px] text-[color:var(--text-muted)]">Updated {timeAgo(p.lastActivity)}</span>}
              </td>
              <td className="py-2 px-2">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${HEALTH[p.health].cls}`} title={HEALTH[p.health].hint}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: HEALTH[p.health].dot }} />
                  {HEALTH[p.health].label}
                </span>
              </td>
              <td className="py-2 px-2">
                <span className="flex items-center gap-2">
                  <span className="flex-1 h-1.5 rounded-full bg-[color:var(--bg-elevated)] overflow-hidden">
                    <span className="block h-full rounded-full bg-[color:var(--accent)]" style={{ width: `${p.progressPct}%` }} />
                  </span>
                  <span className="w-9 text-right text-xs tabular-nums text-[color:var(--text-muted)]">{p.progressPct}%</span>
                </span>
              </td>
              <td className="py-2 px-2 text-right tabular-nums">{p.open}</td>
              <td className={`py-2 px-2 text-right tabular-nums ${p.overdue ? 'text-red-500 font-medium' : ''}`}>{p.overdue}</td>
              {!compact && <td className={`py-2 px-2 text-right tabular-nums ${p.unassigned ? 'text-amber-500' : ''}`}>{p.unassigned}</td>}
              {!compact && (
                <td className="py-2 px-2 text-right tabular-nums">
                  <span className="text-emerald-500">{p.completed14}</span> / {p.created14}
                </td>
              )}
              {!compact && (
                <td className="py-2 px-2 text-xs text-[color:var(--text-muted)]">
                  {p.activeSprint ? (
                    <span className="block truncate max-w-[14rem]">
                      <FiZap className="inline mr-1" />
                      {p.activeSprint.name} · {p.activeSprint.progressPct}% · ends {fmtDate(p.activeSprint.endDate)}
                    </span>
                  ) : (
                    <span className="block">No active sprint</span>
                  )}
                  {p.nextMilestone && (
                    <span className="block truncate max-w-[14rem]">
                      <FiTarget className="inline mr-1" />
                      {p.nextMilestone.name} · {fmtDate(p.nextMilestone.dueDate)}
                    </span>
                  )}
                  {p.lateMilestones > 0 && <span className="block text-red-500">{p.lateMilestones} milestone late</span>}
                </td>
              )}
              <td className="py-2 px-1 text-right">
                <ProjectMenu projectId={p.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Small popover menu; closes on outside click and Escape. */

function ProjectMenu({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Project menu"
        className="p-1.5 rounded-md text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)]"
      >
        <FiMoreHorizontal />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-44 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-modal)] shadow-xl py-1 text-left">
          {PROJECT_MENU.map((m) => (
            <Link key={m.path} role="menuitem" to={`/projects/${projectId}/${m.path}`} className="block px-3 py-1.5 text-sm hover:bg-[color:var(--bg-elevated)]" onClick={() => setOpen(false)}>
              {m.label}
            </Link>
          ))}
          <div className="my-1 border-t border-[color:var(--border-subtle)]" />
          <Link role="menuitem" to={`/projects/${projectId}/issues?create=1`} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[color:var(--accent)] hover:bg-[color:var(--bg-elevated)]" onClick={() => setOpen(false)}>
            <FiPlus /> New issue
          </Link>
        </div>
      )}
    </div>
  );
}

export function SprintList({ sprints }: { sprints: DashboardOverview['sprints'] }) {
  if (!sprints.length) return <p className="text-sm text-[color:var(--text-muted)]">No sprints here.</p>;
  return (
    <ul className="space-y-3">
      {sprints.map((s) => {
        const behind = s.elapsedPct != null && s.status === 'active' && s.progressPct + 10 < s.elapsedPct;
        return (
          <li key={s.id} className="rounded-xl border border-[color:var(--border-subtle)] p-3">
            <div className="flex items-start justify-between gap-2">
              <Link to={`/projects/${s.project.id}/sprints`} className="min-w-0 hover:text-[color:var(--accent)]">
                <span className="block text-sm font-medium truncate">{s.name}</span>
                <span className="block text-[11px] text-[color:var(--text-muted)]">
                  {s.project.key} · {fmtDate(s.startDate)} → {fmtDate(s.endDate)}
                </span>
              </Link>
              <span className={`shrink-0 text-[11px] font-medium ${behind ? 'text-amber-500' : 'text-[color:var(--text-muted)]'}`}>
                {behind ? 'Behind · ' : ''}
                {s.status === 'active' ? daysLabel(s.daysLeft).replace('in ', '') + (s.daysLeft != null && s.daysLeft > 1 ? ' left' : '') : 'planned'}
              </span>
            </div>
            <div className="relative mt-2 h-2 rounded-full bg-[color:var(--bg-elevated)] overflow-hidden">
              <div className="h-full rounded-full bg-[color:var(--accent)]" style={{ width: `${s.progressPct}%` }} />
              {s.elapsedPct != null && s.status === 'active' && (
                <div className="absolute top-0 bottom-0 w-0.5 bg-[color:var(--text-primary)]" style={{ left: `${s.elapsedPct}%` }} title={`${s.elapsedPct}% of time elapsed`} />
              )}
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-[color:var(--text-muted)] tabular-nums">
              <span>
                {s.done}/{s.total} issues · {s.progressPct}%
              </span>
              {s.points > 0 && (
                <span>
                  {s.donePoints}/{s.points} pts
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function MilestoneList({ milestones }: { milestones: DashboardOverview['milestones'] }) {
  if (!milestones.length) return <p className="text-sm text-[color:var(--text-muted)]">No open milestones.</p>;
  return (
    <ul className="divide-y divide-[color:var(--border-subtle)]">
      {milestones.map((m) => {
        const late = m.daysLeft != null && m.daysLeft < 0;
        return (
          <li key={m.id} className="py-2.5 flex items-center gap-3">
            <span className={`w-9 h-9 shrink-0 rounded-lg grid place-items-center ${late ? 'bg-red-500/15 text-red-500' : 'bg-[color:var(--accent-subtle)] text-[color:var(--accent)]'}`}>
              <FiTarget />
            </span>
            <span className="min-w-0 flex-1">
              <Link to={`/projects/${m.project.id}/roadmap`} className="block text-sm font-medium truncate hover:text-[color:var(--accent)]">
                {m.name}
              </Link>
              <span className="flex items-center gap-2 text-[11px] text-[color:var(--text-muted)]">
                <span>{m.project.key}</span>
                <span className="flex-1 max-w-[8rem] h-1 rounded-full bg-[color:var(--bg-elevated)] overflow-hidden">
                  <span className="block h-full bg-[color:var(--accent)]" style={{ width: `${m.progressPct}%` }} />
                </span>
                <span className="tabular-nums">
                  {m.done}/{m.total}
                </span>
              </span>
            </span>
            <span className={`shrink-0 text-right text-[11px] ${late ? 'text-red-500 font-medium' : 'text-[color:var(--text-muted)]'}`}>
              <span className="block">{fmtDate(m.dueDate)}</span>
              <span className="block">{daysLabel(m.daysLeft)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function ActivityFeed({ items }: { items: DashboardOverview['activity'] }) {
  if (!items.length) return <p className="text-sm text-[color:var(--text-muted)]">No recent activity.</p>;
  const verb = (a: DashboardOverview['activity'][number]) => {
    if (a.action === 'created') return 'created';
    if (a.action === 'comment_added') return 'commented on';
    if (a.action === 'comment_updated') return 'edited a comment on';
    if (a.field === 'status' && a.toValue) return `moved to ${a.toValue}`;
    return `updated ${a.field ?? ''}`.trim();
  };
  return (
    <ul className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="flex gap-2.5 text-xs">
          <span className="mt-0.5">
            <FiActivity className="text-[color:var(--text-muted)]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="text-[color:var(--text-primary)]">
              <span className="font-medium">{a.author}</span> {verb(a)}{' '}
            </span>
            <Link to={issueLink(a.issue)} className="text-[color:var(--accent)] hover:underline">
              {a.issue.key ?? a.issue.title}
            </Link>
            <span className="block truncate text-[color:var(--text-muted)]">{a.issue.title}</span>
          </span>
          <span className="shrink-0 text-[10px] text-[color:var(--text-muted)]">{timeAgo(a.at)}</span>
        </li>
      ))}
    </ul>
  );
}

export function IssueTable({ items, today, hideAssignee = false }: { items: OverviewIssueRef[]; today: string; hideAssignee?: boolean }) {
  return (
    <ul className="divide-y divide-[color:var(--border-subtle)] rounded-xl border border-[color:var(--border-subtle)]">
      {items.map((i) => (
        <li key={i.id}>
          <Link to={issueLink(i)} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-[color:var(--bg-elevated)]">
            <span className="font-mono text-[11px] text-[color:var(--text-muted)] w-20 shrink-0 truncate">{i.key}</span>
            <span className="flex-1 min-w-0 truncate">{i.title}</span>
            <span className="hidden md:inline text-[11px] text-[color:var(--text-muted)] w-24 truncate">{i.status}</span>
            {i.priority && <span className="hidden md:inline text-[11px] text-[color:var(--text-muted)] w-16 truncate">{i.priority}</span>}
            {!hideAssignee && <span className="text-[11px] text-[color:var(--text-muted)] w-24 truncate">{i.assignee?.name ?? 'Unassigned'}</span>}
            <span className={`text-[11px] w-16 text-right tabular-nums ${i.dueDate && i.dueDate < today ? 'text-red-500 font-medium' : 'text-[color:var(--text-muted)]'}`}>
              {fmtDate(i.dueDate)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function FilterPill({ active, onClick, label, count, dot }: { active: boolean; onClick: () => void; label: string; count: number; dot?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border font-medium transition ${
        active ? 'border-[color:var(--accent)] bg-[color:var(--accent-subtle)] text-[color:var(--accent)]' : 'border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
      }`}
    >
      {dot && <span className="w-2 h-2 rounded-full" style={{ background: dot }} />}
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}
