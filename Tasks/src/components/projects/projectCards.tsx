import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FiCalendar, FiClock, FiEdit2, FiFlag, FiMoreHorizontal, FiSettings, FiStar, FiTrash2, FiZap } from 'react-icons/fi';
import type { DashboardOverview, Project } from '../../lib/api';
import { HEALTH, fmtDate, timeAgo, useDismiss } from '../dashboard/pmFormat';
import { Avatar } from '../issues/issueUi';

export type ProjectMetrics = DashboardOverview['projects'][number];
export type ProjectRow = { project: Project; metrics: ProjectMetrics | null; starred: boolean };

/** Stable accent per project key, so the same project always gets the same tile colour. */
const TILE_HUES = [221, 262, 291, 330, 12, 32, 152, 172, 192, 245];
function tileStyle(key: string) {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = TILE_HUES[h % TILE_HUES.length];
  return { background: `hsl(${hue} 70% 55% / 0.16)`, color: `hsl(${hue} 70% 50%)` };
}

export function KeyTile({ projectKey, size = 40 }: { projectKey: string; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-xl font-mono font-bold tracking-tight"
      style={{ ...tileStyle(projectKey), width: size, height: size, fontSize: size * 0.3 }}
    >
      {projectKey.slice(0, 3)}
    </span>
  );
}

export function HealthBadge({ metrics }: { metrics: ProjectMetrics | null }) {
  if (!metrics) {
    return <span className="rounded-full bg-[color:var(--bg-page)] px-2 py-0.5 text-[11px] text-[color:var(--text-muted)]" title="You are not a member, so delivery data is not shown">No access</span>;
  }
  const h = HEALTH[metrics.health];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${h.cls}`} title={h.hint}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: h.dot }} />
      {h.label}
    </span>
  );
}

function Progress({ pct, tone }: { pct: number; tone?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--border-subtle)]">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(pct, pct > 0 ? 3 : 0)}%`, background: tone ?? 'var(--accent)' }} />
    </div>
  );
}

function Signal({ icon, label, tone }: { icon: ReactNode; label: string; tone: 'red' | 'amber' | 'muted' }) {
  const cls =
    tone === 'red'
      ? 'bg-red-500/10 text-red-500'
      : tone === 'amber'
        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
        : 'bg-[color:var(--bg-page)] text-[color:var(--text-muted)]';
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>
      {icon}
      {label}
    </span>
  );
}

function signals(m: ProjectMetrics) {
  const out: Array<{ key: string; icon: ReactNode; label: string; tone: 'red' | 'amber' | 'muted' }> = [];
  if (m.overdue) out.push({ key: 'overdue', icon: <FiClock />, label: `${m.overdue} overdue`, tone: 'red' });
  if (m.lateMilestones) out.push({ key: 'late', icon: <FiFlag />, label: `${m.lateMilestones} late milestone${m.lateMilestones === 1 ? '' : 's'}`, tone: 'red' });
  if (m.dueSoon) out.push({ key: 'soon', icon: <FiCalendar />, label: `${m.dueSoon} due this week`, tone: 'amber' });
  if (m.unassigned) out.push({ key: 'unassigned', icon: null, label: `${m.unassigned} unassigned`, tone: 'muted' });
  return out;
}

type Actions = {
  onStar: (id: string) => void;
  onEdit?: (p: Project) => void;
  onDelete?: (p: Project) => void;
};

export function ProjectCard({ row, onStar, onEdit, onDelete }: { row: ProjectRow } & Actions) {
  const { project: p, metrics: m, starred } = row;
  const base = `/projects/${p._id}`;
  const sig = m ? signals(m) : [];
  return (
    <article className="group relative flex min-w-0 flex-col rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 card-shadow transition hover:-translate-y-0.5 hover:border-[color:var(--accent)]/40 hover:shadow-lg">
      <div className="flex items-start gap-3">
        <KeyTile projectKey={p.key} />
        <div className="min-w-0 flex-1">
          <Link to={`${base}/dashboard`} className="block truncate text-[15px] font-semibold leading-tight after:absolute after:inset-0 after:rounded-2xl hover:text-[color:var(--accent)]">
            {p.name}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-[color:var(--text-muted)]">{p.key}</span>
            <HealthBadge metrics={m} />
          </div>
        </div>
        <div className="relative z-10 flex items-center gap-0.5">
          <StarButton starred={starred} onClick={() => onStar(p._id)} />
          <RowMenu project={p} onEdit={onEdit} onDelete={onDelete} />
        </div>
      </div>

      {p.description ? (
        <p className="mt-3 line-clamp-2 min-h-[2.5em] text-[13px] leading-snug text-[color:var(--text-muted)]">{p.description}</p>
      ) : (
        <p className="mt-3 min-h-[2.5em] text-[13px] italic text-[color:var(--text-muted)]/70">No description</p>
      )}

      {m ? (
        <>
          {m.total === 0 ? (
            <Link
              to={`${base}/issues`}
              className="relative z-10 mt-4 flex items-center justify-between rounded-lg border border-dashed border-[color:var(--border-subtle)] px-3 py-2.5 text-xs text-[color:var(--text-muted)] transition hover:border-[color:var(--accent)]/50 hover:text-[color:var(--accent)]"
            >
              No issues yet
              <span className="font-medium">Add the first one →</span>
            </Link>
          ) : (
            <>
              <div className="mt-4">
                <div className="mb-1.5 flex items-baseline justify-between text-xs">
                  <span className="font-medium">{m.progressPct}% done</span>
                  <span className="tabular-nums text-[color:var(--text-muted)]">
                    {m.done}/{m.total} · {m.open} open
                  </span>
                </div>
                <Progress pct={m.progressPct} tone={m.health === 'off_track' ? '#ef4444' : m.health === 'at_risk' ? '#f59e0b' : undefined} />
              </div>

              <div className="mt-3 flex min-h-[22px] flex-wrap gap-1.5">
                {sig.length ? (
                  sig.map(({ key, ...s }) => <Signal key={key} {...s} />)
                ) : (
                  <Signal icon={<FiZap />} label={m.completed14 ? `${m.completed14} done in 14 days` : 'Nothing finished in 14 days'} tone="muted" />
                )}
              </div>
            </>
          )}

          <div className="mt-3 space-y-1.5 text-xs">
            {m.activeSprint ? (
              <Link to={`${base}/sprints`} className="relative z-10 flex items-center gap-2 hover:text-[color:var(--accent)]">
                <span className="w-16 shrink-0 text-[color:var(--text-muted)]">Sprint</span>
                <span className="min-w-0 flex-1 truncate font-medium">{m.activeSprint.name}</span>
                <span className="w-16 shrink-0">
                  <Progress pct={m.activeSprint.progressPct} />
                </span>
                {m.activeSprint.endDate && <span className="shrink-0 text-[color:var(--text-muted)]">ends {fmtDate(m.activeSprint.endDate)}</span>}
              </Link>
            ) : (
              <div className="flex items-center gap-2 text-[color:var(--text-muted)]">
                <span className="w-16 shrink-0">Sprint</span>
                <span>None active</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-[color:var(--text-muted)]">Milestone</span>
              {m.nextMilestone ? (
                <>
                  <span className="min-w-0 flex-1 truncate font-medium">{m.nextMilestone.name}</span>
                  {m.nextMilestone.dueDate && <span className="shrink-0 text-[color:var(--text-muted)]">{fmtDate(m.nextMilestone.dueDate)}</span>}
                </>
              ) : (
                <span className="text-[color:var(--text-muted)]">None upcoming</span>
              )}
            </div>
          </div>
        </>
      ) : (
        <p className="mt-4 rounded-lg bg-[color:var(--bg-page)] px-3 py-2 text-xs text-[color:var(--text-muted)]">
          You’re not a member of this project, so delivery data isn’t shown.
        </p>
      )}

      <div className="mt-4 flex items-center gap-2 border-t border-[color:var(--border-subtle)] pt-3">
        <Avatar name={p.lead?.name} size={22} />
        <span className="min-w-0 flex-1 truncate text-xs">{p.lead?.name ?? 'No lead'}</span>
        {m?.lastActivity && <span className="shrink-0 text-[11px] text-[color:var(--text-muted)]">active {timeAgo(m.lastActivity)}</span>}
      </div>

      <nav className="relative z-10 mt-3 grid grid-cols-4 gap-1 text-[11px]">
        {[
          ['Issues', 'issues'],
          ['Board', 'boards'],
          ['Backlog', 'backlog'],
          ['Docs', 'docs'],
        ].map(([label, path]) => (
          <Link key={path} to={`${base}/${path}`} className="rounded-md py-1.5 text-center text-[color:var(--text-muted)] transition hover:bg-[color:var(--accent)]/10 hover:text-[color:var(--accent)]">
            {label}
          </Link>
        ))}
      </nav>
    </article>
  );
}

export function ProjectListRow({ row, onStar, onEdit, onDelete }: { row: ProjectRow } & Actions) {
  const { project: p, metrics: m, starred } = row;
  return (
    <tr className="group border-t border-[color:var(--border-subtle)] transition hover:bg-[color:var(--accent)]/[0.04]">
      <td className="w-8 py-2.5 pl-3">
        <StarButton starred={starred} onClick={() => onStar(p._id)} />
      </td>
      <td className="max-w-[22rem] py-2.5 pr-3">
        <Link to={`/projects/${p._id}/dashboard`} className="flex min-w-0 items-center gap-3">
          <KeyTile projectKey={p.key} size={30} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium group-hover:text-[color:var(--accent)]">{p.name}</span>
            <span className="block truncate font-mono text-[11px] text-[color:var(--text-muted)]">{p.key}</span>
          </span>
        </Link>
      </td>
      <td className="px-3 py-2.5">
        <HealthBadge metrics={m} />
      </td>
      <td className="w-44 px-3 py-2.5">
        {m ? (
          <div className="flex items-center gap-2">
            <Progress pct={m.progressPct} />
            <span className="w-9 shrink-0 text-right text-xs tabular-nums">{m.progressPct}%</span>
          </div>
        ) : (
          <span className="text-xs text-[color:var(--text-muted)]">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right text-sm tabular-nums">{m?.open ?? '—'}</td>
      <td className={`px-3 py-2.5 text-right text-sm tabular-nums ${m?.overdue ? 'font-semibold text-red-500' : ''}`}>{m ? m.overdue : '—'}</td>
      <td className="hidden max-w-[12rem] px-3 py-2.5 text-xs lg:table-cell">
        {m?.activeSprint ? <span className="block truncate">{m.activeSprint.name}</span> : <span className="text-[color:var(--text-muted)]">—</span>}
      </td>
      <td className="hidden px-3 py-2.5 md:table-cell">
        <span className="flex min-w-0 items-center gap-2">
          <Avatar name={p.lead?.name} size={22} />
          <span className="truncate text-xs">{p.lead?.name ?? '—'}</span>
        </span>
      </td>
      <td className="hidden px-3 py-2.5 text-xs text-[color:var(--text-muted)] xl:table-cell">{m?.lastActivity ? timeAgo(m.lastActivity) : '—'}</td>
      <td className="w-10 py-2.5 pr-3 text-right">
        <RowMenu project={p} onEdit={onEdit} onDelete={onDelete} />
      </td>
    </tr>
  );
}

function StarButton({ starred, onClick }: { starred: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      title={starred ? 'Unstar' : 'Star'}
      aria-pressed={starred}
      className={`rounded-lg p-1.5 transition ${
        starred ? 'text-amber-400' : 'text-[color:var(--text-muted)] opacity-60 hover:opacity-100 group-hover:opacity-100'
      } hover:bg-[color:var(--bg-page)]`}
    >
      <FiStar className={starred ? 'fill-current' : ''} />
    </button>
  );
}

function RowMenu({ project: p, onEdit, onDelete }: { project: Project; onEdit?: (p: Project) => void; onDelete?: (p: Project) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const item = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[color:var(--bg-page)]';
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
        className="rounded-lg p-1.5 text-[color:var(--text-muted)] transition hover:bg-[color:var(--bg-page)] hover:text-[color:var(--text-primary)]"
        aria-label={`Actions for ${p.name}`}
        aria-expanded={open}
      >
        <FiMoreHorizontal />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] py-1 text-left shadow-xl animate-fade-in">
          <Link to={`/projects/${p._id}/dashboard`} className={item}>
            Open dashboard
          </Link>
          <Link to={`/projects/${p._id}/issues`} className={item}>
            Issues
          </Link>
          <Link to={`/projects/${p._id}/roadmap`} className={item}>
            Roadmap
          </Link>
          {p.canEdit && (
            <>
              <div className="my-1 border-t border-[color:var(--border-subtle)]" />
              <button type="button" className={item} onClick={() => (setOpen(false), onEdit?.(p))}>
                <FiEdit2 className="text-[color:var(--text-muted)]" /> Edit details
              </button>
              <Link to={`/projects/${p._id}/settings`} className={item}>
                <FiSettings className="text-[color:var(--text-muted)]" /> Settings
              </Link>
            </>
          )}
          {p.canDelete && (
            <button type="button" className={`${item} text-red-500`} onClick={() => (setOpen(false), onDelete?.(p))}>
              <FiTrash2 /> Delete project
            </button>
          )}
        </div>
      )}
    </div>
  );
}
