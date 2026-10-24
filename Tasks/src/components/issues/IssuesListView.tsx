import { Link } from 'react-router-dom';
import { WatchButton } from '../issue';
import { EditIcon } from '../icons/NavigationIcons';
import { FiTrash2 } from 'react-icons/fi';
import type { Issue } from '../../lib/api';
import { Avatar, DueDate, PriorityTag, RelativeDate, StatusPill, TypeTag } from './issueUi';

type MetaGetter = (name: string) => { icon?: string; color?: string } | undefined;

interface IssuesListViewProps {
  issues: Issue[];
  projectId: string | undefined;
  getIssueKey: (issue: Issue) => string;
  getTypeMeta: MetaGetter;
  getPriorityMeta: MetaGetter;
  getStatusMeta: MetaGetter;
  watchingStatus: Record<string, boolean>;
  watchingLoadingId: string | null;
  handleToggleWatch: (issueId: string) => void;
  openEdit: (issue: Issue) => void;
  setConfirmDeleteIssue: (issue: Issue | null) => void;
  navigate: (path: string) => void;
}

export function IssuesListView({
  issues,
  projectId,
  getIssueKey,
  getTypeMeta,
  getPriorityMeta,
  getStatusMeta,
  watchingStatus,
  watchingLoadingId,
  handleToggleWatch,
  openEdit,
  setConfirmDeleteIssue,
  navigate,
}: IssuesListViewProps) {
  return (
    <ul className="overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] card-shadow divide-y divide-[color:var(--border-subtle)]/60">
      {issues.map((issue) => {
        const pid = projectId ?? (typeof issue.project === 'object' && issue.project ? issue.project._id : '');
        const key = getIssueKey(issue);
        const href = pid ? `/projects/${pid}/issues/${encodeURIComponent(key)}` : '#';
        const assigneeName = typeof issue.assignee === 'object' && issue.assignee ? issue.assignee.name : null;
        const projectName = !projectId && typeof issue.project === 'object' && issue.project ? issue.project.name ?? issue.project.key : null;
        const labels = issue.labels ?? [];
        const watching = watchingStatus[issue._id] ?? false;

        return (
          <li
            key={issue._id}
            role="button"
            tabIndex={0}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('a, button')) return;
              if (pid) navigate(href);
            }}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (pid) navigate(href);
              }
            }}
            className="group flex cursor-pointer items-center gap-4 px-4 py-3 outline-none transition-colors hover:bg-[color:var(--bg-elevated)]/70 focus-visible:bg-[color:var(--bg-elevated)]"
          >
            <div className="min-w-0 flex-1">
              {/* Line 1: key + title */}
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-mono text-[11.5px] font-semibold text-[color:var(--text-muted)] transition-colors group-hover:text-[color:var(--accent)]">
                  {key}
                </span>
                {issue.parent && <span className="shrink-0 text-[11px] text-[color:var(--text-muted)]" title="Sub-item">↳</span>}
                <Link to={href} className="truncate text-[14px] font-medium text-[color:var(--text-primary)] hover:text-[color:var(--accent)]" title={issue.title}>
                  {issue.title}
                </Link>
              </div>

              {/* Line 2: the facts you scan for */}
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <StatusPill label={issue.status} meta={getStatusMeta(issue.status)} />
                <TypeTag label={issue.type} meta={getTypeMeta(issue.type)} />
                <PriorityTag label={issue.priority} meta={getPriorityMeta(issue.priority)} />
                {issue.dueDate && (
                  <span className="inline-flex items-center gap-1 text-[12px] text-[color:var(--text-muted)]">
                    Due <DueDate value={issue.dueDate} />
                  </span>
                )}
                {projectName && <span className="truncate text-[12px] text-[color:var(--text-muted)]">{projectName}</span>}
                {labels.slice(0, 3).map((l) => (
                  <span key={l} className="hidden max-w-[110px] truncate rounded-full bg-[color:var(--bg-elevated)] px-2 py-px text-[11px] text-[color:var(--text-muted)] sm:inline-block">
                    {l}
                  </span>
                ))}
                {labels.length > 3 && <span className="hidden text-[11px] text-[color:var(--text-muted)] sm:inline">+{labels.length - 3}</span>}
              </div>
            </div>

            <div className="hidden shrink-0 text-right md:block">
              <RelativeDate value={issue.updatedAt ?? issue.createdAt} />
            </div>

            <Avatar name={assigneeName} size={28} />

            <div className={`flex shrink-0 items-center gap-0.5 transition-opacity ${watching ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}>
              <WatchButton
                watching={watching}
                loading={watchingLoadingId === issue._id}
                onWatch={() => handleToggleWatch(issue._id)}
                onUnwatch={() => handleToggleWatch(issue._id)}
                size="sm"
              />
              <button
                type="button"
                onClick={() => openEdit(issue)}
                title="Edit issue"
                className="rounded-md p-1.5 text-[color:var(--text-muted)] transition hover:bg-[color:var(--accent-subtle)] hover:text-[color:var(--accent)]"
              >
                <EditIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteIssue(issue)}
                title="Delete issue"
                className="rounded-md p-1.5 text-[color:var(--text-muted)] transition hover:bg-red-500/10 hover:text-red-500"
              >
                <FiTrash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
