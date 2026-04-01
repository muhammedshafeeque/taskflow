import { Link } from 'react-router-dom';
import { MetaBadge } from '../MetaBadge';
import { WatchButton } from '../issue';
import { EditIcon } from '../icons/NavigationIcons';
import { ISSUE_TABLE_COLUMNS, isDueTodayOrPast } from './constants';
import type { Issue, Project } from '../../lib/api';
import { formatDateDDMMYYYY } from '../../lib/dateFormat';

type MetaGetter = (name: string) => { icon?: string; color?: string } | undefined;

interface IssuesTableViewProps {
  issues: Issue[];
  projectId?: string;
  project: Project | null;
  projects?: Project[];
  visibleColumnIds: string[];
  selectedIssueIds: Set<string>;
  toggleSelectIssue: (id: string) => void;
  toggleSelectAll: () => void;
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

function renderCell(
  colId: string,
  issue: Issue,
  project: Project | null,
  projectId: string | undefined,
  getIssueKey: (i: Issue) => string,
  getTypeMeta: MetaGetter,
  getPriorityMeta: MetaGetter,
  getStatusMeta: MetaGetter,
  watchingStatus: Record<string, boolean>,
  watchingLoadingId: string | null,
  handleToggleWatch: (id: string) => void,
  openEdit: (i: Issue) => void,
  _setConfirmDeleteIssue: (i: Issue | null) => void,
  projects?: Project[]
) {
  const issueProjectId =
    typeof issue.project === 'object' && issue.project ? issue.project._id : undefined;
  const issueProject =
    projectId || !issueProjectId
      ? project
      : projects?.find((p) => p._id === issueProjectId) ?? null;

  if (colId === 'project') {
    const proj = typeof issue.project === 'object' && issue.project ? issue.project : null;
    return proj ? <span className="text-[color:var(--text-muted)] text-sm">{proj.name ?? proj.key ?? '—'}</span> : '—';
  }
  if (colId === 'type') {
    return <MetaBadge label={issue.type} meta={getTypeMeta(issue.type)} />;
  }
  if (colId === 'ticketId') {
    return <span className="font-mono text-[color:var(--text-muted)] text-xs">{getIssueKey(issue)}</span>;
  }
  if (colId === 'summary') {
    const pid = projectId ?? (typeof issue.project === 'object' && issue.project ? issue.project._id : '');
    return (
      <Link
        to={pid ? `/projects/${pid}/issues/${encodeURIComponent(getIssueKey(issue))}` : '#'}
        className={`font-medium text-[color:var(--text-primary)] hover:underline truncate block max-w-[280px] text-sm flex items-center gap-1.5 ${issue.parent ? 'pl-4' : ''}`}
      >
        {issue.parent && <span className="text-[10px] text-[color:var(--text-muted)] shrink-0" title="Subtask">↳</span>}
        {issue.title}
      </Link>
    );
  }
  if (colId === 'assignee') {
    return typeof issue.assignee === 'object' && issue.assignee ? issue.assignee.name : '—';
  }
  if (colId === 'reporter') {
    return typeof issue.reporter === 'object' && issue.reporter ? issue.reporter.name : '—';
  }
  if (colId === 'priority') {
    return <MetaBadge label={issue.priority} meta={getPriorityMeta(issue.priority)} />;
  }
  if (colId === 'status') {
    return <MetaBadge label={issue.status} meta={getStatusMeta(issue.status)} />;
  }
  if (colId === 'dueDate') {
    const isHot = isDueTodayOrPast(issue.dueDate);
    return issue.dueDate ? (
      <span className={isHot ? 'text-red-400 font-medium' : 'text-[color:var(--text-muted)]'}>
        {formatDateDDMMYYYY(issue.dueDate)}
      </span>
    ) : (
      <span className="text-[color:var(--text-muted)]">—</span>
    );
  }
  if (colId === 'startDate') {
    return issue.startDate ? formatDateDDMMYYYY(issue.startDate) : '—';
  }
  if (colId === 'storyPoints') {
    return issue.storyPoints != null ? issue.storyPoints : '—';
  }
  if (colId === 'created') {
    return issue.createdAt ? formatDateDDMMYYYY(issue.createdAt) : '—';
  }
  if (colId === 'updated') {
    return issue.updatedAt ? formatDateDDMMYYYY(issue.updatedAt) : '—';
  }
  if (colId === 'description') {
    const desc = issue.description ?? '';
    return <span className="text-[color:var(--text-muted)] text-xs max-w-[200px] truncate block" title={desc}>{desc || '—'}</span>;
  }
  if (colId === 'labels') {
    const labels = issue.labels ?? [];
    return labels.length ? (
      <span className="flex flex-wrap gap-1">
        {labels.slice(0, 3).map((l) => (
          <span key={l} className="inline-flex px-2 py-0.5 rounded text-xs bg-[color:var(--bg-button-secondary)] text-[color:var(--text-primary)]">{l}</span>
        ))}
        {labels.length > 3 && <span className="text-[color:var(--text-muted)] text-xs">+{labels.length - 3}</span>}
      </span>
    ) : '—';
  }
  if (colId === 'fixVersion') {
    const versionName =
      issueProject?.versions?.find((v) => v.id === issue.fixVersion)?.name ??
      issue.fixVersion ??
      '—';
    return <span className="text-[color:var(--text-muted)] text-sm">{versionName}</span>;
  }
  if (colId === 'affectsVersions') {
    const ids = issue.affectsVersions ?? [];
    const names = ids
      .map((id) => issueProject?.versions?.find((v) => v.id === id)?.name ?? id)
      .filter(Boolean);
    return <span className="text-[color:var(--text-muted)] text-sm">{names.length ? names.join(', ') : '—'}</span>;
  }
  if (colId === 'actions') {
    return (
      <div className="flex items-center justify-end gap-2">
        <WatchButton watching={watchingStatus[issue._id] ?? false} loading={watchingLoadingId === issue._id} onWatch={() => handleToggleWatch(issue._id)} onUnwatch={() => handleToggleWatch(issue._id)} size="sm" />
        <button type="button" onClick={() => openEdit(issue)} title="Edit" className="p-1 rounded text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] opacity-0 group-hover:opacity-100 transition">
          <EditIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }
  return '—';
}

export function IssuesTableView(props: IssuesTableViewProps) {
  const { issues, projectId, project, visibleColumnIds, selectedIssueIds, toggleSelectIssue, toggleSelectAll, getIssueKey, getTypeMeta, getPriorityMeta, getStatusMeta, watchingStatus, watchingLoadingId, handleToggleWatch, openEdit, setConfirmDeleteIssue: _setConfirmDeleteIssue2, navigate } = props;

  return (
    <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] text-[color:var(--text-muted)]">
              <th className="px-2 py-3 w-10">
                <input type="checkbox" checked={issues.length > 0 && selectedIssueIds.size === issues.length} onChange={toggleSelectAll} className="rounded border-[color:var(--border-subtle)]" aria-label="Select all" />
              </th>
              {visibleColumnIds.map((colId) => {
                const col = ISSUE_TABLE_COLUMNS.find((c) => c.id === colId);
                return <th key={colId} className={`px-4 py-3 font-medium ${col?.width ?? ''} ${colId === 'actions' ? 'text-right' : ''}`}>{col?.label ?? colId}</th>;
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--border-subtle)]/70">
            {issues.map((issue) => (
              <tr
                key={issue._id}
                role="button"
                tabIndex={0}
                onClick={(e) => { if ((e.target as HTMLElement).closest('a, button')) return; const pid = projectId ?? (typeof issue.project === 'object' && issue.project ? issue.project._id : ''); if (pid) navigate(`/projects/${pid}/issues/${encodeURIComponent(getIssueKey(issue))}`); }}
                onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const pid = projectId ?? (typeof issue.project === 'object' && issue.project ? issue.project._id : ''); if (pid) navigate(`/projects/${pid}/issues/${encodeURIComponent(getIssueKey(issue))}`); } }}
                className="group bg-[color:var(--bg-surface)] hover:bg-[color:var(--bg-elevated)] transition cursor-pointer"
              >
                <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selectedIssueIds.has(issue._id)} onChange={() => toggleSelectIssue(issue._id)} className="rounded border-[color:var(--border-subtle)]" aria-label={`Select ${getIssueKey(issue)}`} />
                </td>
                {visibleColumnIds.map((colId) => (
                  <td key={colId} className={`px-4 py-3 ${colId === 'actions' ? 'text-right' : ''}`} onClick={colId === 'actions' ? (e) => e.stopPropagation() : undefined}>
                    {renderCell(colId, issue, project, projectId, getIssueKey, getTypeMeta, getPriorityMeta, getStatusMeta, watchingStatus, watchingLoadingId, handleToggleWatch, openEdit, _setConfirmDeleteIssue2, props.projects)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
