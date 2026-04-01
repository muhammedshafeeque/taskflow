import { Link } from 'react-router-dom';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { MetaBadge } from '../MetaBadge';
import { WatchButton } from '../issue';
import { EditIcon, TrashIcon } from '../icons/NavigationIcons';
import { isDueTodayOrPast } from './constants';
import type { Issue } from '../../lib/api';
import { formatDateDDMMYYYY } from '../../lib/dateFormat';

interface KanbanCardProps {
  issue: Issue;
  projectId: string | undefined;
  getIssueKey: (issue: Issue) => string;
  getTypeMeta: (name: string) => { icon?: string; color?: string } | undefined;
  getPriorityMeta: (name: string) => { icon?: string; color?: string } | undefined;
  openEdit: (issue: Issue) => void;
  setConfirmDeleteIssue: (issue: Issue | null) => void;
  isUpdating: boolean;
  watching?: boolean;
  watchingLoading?: boolean;
  onToggleWatch?: () => void;
}

export function KanbanCard({
  issue,
  projectId,
  getIssueKey,
  getTypeMeta,
  getPriorityMeta,
  openEdit,
  setConfirmDeleteIssue,
  isUpdating,
  watching,
  watchingLoading,
  onToggleWatch,
}: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: issue._id,
  });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  const typeMeta = getTypeMeta(issue.type);
  const priorityMeta = getPriorityMeta(issue.priority);
  const pid = projectId ?? (typeof issue.project === 'object' && issue.project ? issue.project._id : '');
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group/card p-3 rounded-lg bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-elevated)] transition ${
        isDragging ? 'opacity-50' : ''
      } ${isUpdating ? 'animate-pulse' : ''}`}
    >
      <div className="flex gap-2 min-w-0">
        <button
          type="button"
          className="shrink-0 touch-none cursor-grab active:cursor-grabbing text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] p-0.5 -m-0.5"
          aria-label="Drag to move"
          {...listeners}
          {...attributes}
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16" aria-hidden>
            <path d="M5 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM5 9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM5 12a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <Link
            to={pid ? `/projects/${pid}/issues/${encodeURIComponent(getIssueKey(issue))}` : '#'}
            className="block min-w-0"
          >
            <p className="text-[11px] font-mono text-[color:var(--text-muted)]">{getIssueKey(issue)}</p>
            <p className="text-sm font-medium text-[color:var(--text-primary)] truncate">{issue.title}</p>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <MetaBadge label={issue.type} meta={typeMeta} />
              <MetaBadge label={issue.priority} meta={priorityMeta} />
            </div>
            {issue.dueDate && (
              <p
                className={`mt-1 text-[11px] ${
                  isDueTodayOrPast(issue.dueDate) ? 'text-red-400 font-medium' : 'text-[color:var(--text-muted)]'
                }`}
              >
                Due {formatDateDDMMYYYY(issue.dueDate)}
              </p>
            )}
            {typeof issue.assignee === 'object' && issue.assignee && (
              <p className="text-[11px] text-[color:var(--text-muted)] mt-1 truncate">{issue.assignee.name}</p>
            )}
          </Link>
          <div className="flex gap-2 mt-2 pt-2 border-t border-[color:var(--border-subtle)] opacity-0 group-hover/card:opacity-100 transition">
            {onToggleWatch && (
              <WatchButton
                watching={watching ?? false}
                loading={watchingLoading ?? false}
                onWatch={onToggleWatch}
                onUnwatch={onToggleWatch}
                size="sm"
              />
            )}
            <button
              type="button"
              onClick={() => openEdit(issue)}
              title="Edit"
              className="p-1 rounded text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] transition"
            >
              <EditIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
