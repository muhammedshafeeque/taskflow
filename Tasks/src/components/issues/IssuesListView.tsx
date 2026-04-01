import { Link } from 'react-router-dom';
import { MetaBadge } from '../MetaBadge';
import { WatchButton } from '../issue';
import { EditIcon, TrashIcon } from '../icons/NavigationIcons';
import type { Issue } from '../../lib/api';

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
    <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden">
      <ul className="divide-y divide-[color:var(--border-subtle)]/70">
        {issues.map((issue) => {
          const pid = projectId ?? (typeof issue.project === 'object' && issue.project ? issue.project._id : '');
          return (
          <li
            key={issue._id}
            role="button"
            tabIndex={0}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('a, button')) return;
              if (pid) navigate(`/projects/${pid}/issues/${encodeURIComponent(getIssueKey(issue))}`);
            }}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (pid) navigate(`/projects/${pid}/issues/${encodeURIComponent(getIssueKey(issue))}`);
              }
            }}
            className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-[color:var(--bg-elevated)] transition group cursor-pointer"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <span className="shrink-0 font-mono text-[11px] text-[color:var(--text-muted)] w-20">
                {getIssueKey(issue)}
              </span>
              <Link
                to={pid ? `/projects/${pid}/issues/${encodeURIComponent(getIssueKey(issue))}` : '#'}
                className="font-medium text-[color:var(--text-primary)] truncate hover:underline min-w-0 text-sm"
              >
                {issue.title}
              </Link>
              <MetaBadge label={issue.type} meta={getTypeMeta(issue.type)} />
              <MetaBadge label={issue.priority} meta={getPriorityMeta(issue.priority)} />
              <MetaBadge label={issue.status} meta={getStatusMeta(issue.status)} />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <WatchButton
                watching={watchingStatus[issue._id] ?? false}
                loading={watchingLoadingId === issue._id}
                onWatch={() => handleToggleWatch(issue._id)}
                onUnwatch={() => handleToggleWatch(issue._id)}
                size="sm"
              />
              <button
                type="button"
                onClick={() => openEdit(issue)}
                title="Edit"
                className="p-1.5 rounded-md text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)] hover:text-[color:var(--text-primary)] opacity-0 group-hover:opacity-100 transition"
              >
                <EditIcon className="w-4 h-4" />
              </button>
            </div>
          </li>
          );
        })}
      </ul>
    </div>
  );
}
