import { Link } from 'react-router-dom';
import { FiTrash2 } from 'react-icons/fi';
import { MetaBadge } from '../MetaBadge';
import { WatchButton } from '../issue';
import { EditIcon } from '../icons/NavigationIcons';
import {
  ISSUE_TABLE_COLUMNS,
  ISSUE_TABLE_CHECKBOX_WIDTH,
  getColumnWidthPx,
  isDueTodayOrPast,
} from './constants';
import { useColumnResize } from './useColumnResize';
import type { Issue, Project } from '../../lib/api';
import { formatDateDDMMYYYY } from '../../lib/dateFormat';

type MetaGetter = (name: string) => { icon?: string; color?: string } | undefined;

interface IssuesTableViewProps {
  issues: Issue[];
  projectId?: string;
  project: Project | null;
  projects?: Project[];
  visibleColumnIds: string[];
  columnWidths: Record<string, number>;
  onColumnWidthChange: (colId: string, width: number) => void;
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

function getAvatarBg(name: string): string {
  const palette = ['#388bfd', '#3fb950', '#d29922', '#bc8cff', '#f85149', '#e8912d', '#58b9de', '#79c0ff'];
  let hash = 0;
  for (const char of name) hash = char.charCodeAt(0) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
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
  setConfirmDeleteIssue: (i: Issue | null) => void,
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
    return (
      <span className="text-[color:var(--text-muted)] text-xs truncate block" title={proj?.name ?? proj?.key}>
        {proj ? proj.name ?? proj.key ?? '—' : '—'}
      </span>
    );
  }
  if (colId === 'type') {
    return <MetaBadge label={issue.type} meta={getTypeMeta(issue.type)} />;
  }
  if (colId === 'ticketId') {
    return (
      <span className="font-mono text-[color:var(--text-muted)] text-[11px] font-semibold truncate block" title={getIssueKey(issue)}>
        {getIssueKey(issue)}
      </span>
    );
  }
  if (colId === 'summary') {
    const pid = projectId ?? (typeof issue.project === 'object' && issue.project ? issue.project._id : '');
    return (
      <Link
        to={pid ? `/projects/${pid}/issues/${encodeURIComponent(getIssueKey(issue))}` : '#'}
        className={`font-medium text-[color:var(--text-primary)] hover:text-[color:var(--accent)] hover:underline truncate block w-full text-sm flex items-center gap-1.5 ${issue.parent ? 'pl-4' : ''}`}
        title={issue.title}
      >
        {issue.parent && <span className="text-[9px] text-[color:var(--text-muted)] shrink-0">↳</span>}
        {issue.title}
      </Link>
    );
  }
  if (colId === 'assignee') {
    const name = typeof issue.assignee === 'object' && issue.assignee ? issue.assignee.name : null;
    if (!name) {
      return <span className="text-[color:var(--text-muted)] text-sm">—</span>;
    }
    const initials = name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
    return (
      <div className="flex items-center gap-2 min-w-0">
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 ring-1 ring-[color:var(--border-subtle)]"
          style={{ backgroundColor: getAvatarBg(name) }}
          title={name}
        >
          {initials}
        </div>
        <span className="truncate text-sm text-[color:var(--text-primary)]" title={name}>{name}</span>
      </div>
    );
  }
  if (colId === 'reporter') {
    const name = typeof issue.reporter === 'object' && issue.reporter ? issue.reporter.name : null;
    if (!name) return <span className="text-[color:var(--text-muted)] text-sm">—</span>;
    const initials = name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
    return (
      <div className="flex items-center gap-2 min-w-0">
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 ring-1 ring-[color:var(--border-subtle)]"
          style={{ backgroundColor: getAvatarBg(name) }}
          title={name}
        >
          {initials}
        </div>
        <span className="truncate text-sm text-[color:var(--text-primary)]" title={name}>{name}</span>
      </div>
    );
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
      <span className={`text-xs font-medium ${isHot ? 'text-red-400' : 'text-[color:var(--text-muted)]'}`}>
        {formatDateDDMMYYYY(issue.dueDate)}
      </span>
    ) : (
      <span className="text-[color:var(--text-muted)] text-sm">—</span>
    );
  }
  if (colId === 'startDate') {
    return issue.startDate ? (
      <span className="text-xs text-[color:var(--text-muted)]">{formatDateDDMMYYYY(issue.startDate)}</span>
    ) : (
      <span className="text-[color:var(--text-muted)] text-sm">—</span>
    );
  }
  if (colId === 'storyPoints') {
    return issue.storyPoints != null ? (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] text-xs font-bold text-[color:var(--text-primary)]">
        {issue.storyPoints}
      </span>
    ) : (
      <span className="text-[color:var(--text-muted)] text-sm">—</span>
    );
  }
  if (colId === 'created') {
    return <span className="text-xs text-[color:var(--text-muted)]">{issue.createdAt ? formatDateDDMMYYYY(issue.createdAt) : '—'}</span>;
  }
  if (colId === 'updated') {
    return <span className="text-xs text-[color:var(--text-muted)]">{issue.updatedAt ? formatDateDDMMYYYY(issue.updatedAt) : '—'}</span>;
  }
  if (colId === 'description') {
    const desc = issue.description ?? '';
    return (
      <span className="text-[color:var(--text-muted)] text-xs truncate block w-full" title={desc}>
        {desc || '—'}
      </span>
    );
  }
  if (colId === 'labels') {
    const labels = issue.labels ?? [];
    return labels.length ? (
      <span className="flex flex-wrap gap-1">
        {labels.slice(0, 2).map((l) => (
          <span key={l} className="inline-flex px-2 py-0.5 rounded-md text-[11px] font-medium bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] text-[color:var(--text-muted)]">
            {l}
          </span>
        ))}
        {labels.length > 2 && (
          <span className="text-[color:var(--text-muted)] text-xs font-medium">+{labels.length - 2}</span>
        )}
      </span>
    ) : (
      <span className="text-[color:var(--text-muted)]">—</span>
    );
  }
  if (colId === 'fixVersion') {
    const ids = Array.isArray(issue.fixVersion)
      ? issue.fixVersion
      : issue.fixVersion
        ? [String(issue.fixVersion)]
        : [];
    const names = ids
      .map((id) => issueProject?.versions?.find((v) => v.id === id)?.name ?? id)
      .filter(Boolean);
    const text = names.length ? names.join(', ') : '—';
    return (
      <span className="text-[color:var(--text-muted)] text-xs truncate block" title={text}>
        {text}
      </span>
    );
  }
  if (colId === 'affectsVersions') {
    const ids = issue.affectsVersions ?? [];
    const names = ids.map((id) => issueProject?.versions?.find((v) => v.id === id)?.name ?? id).filter(Boolean);
    const text = names.length ? names.join(', ') : '—';
    return (
      <span className="text-[color:var(--text-muted)] text-xs truncate block" title={text}>
        {text}
      </span>
    );
  }
  if (colId === 'actions') {
    return (
      <div className="flex items-center justify-end gap-1">
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
          className="p-1 rounded-md text-[color:var(--text-muted)] hover:text-[color:var(--accent)] hover:bg-[color:var(--accent-subtle)] opacity-0 group-hover:opacity-100 transition"
        >
          <EditIcon className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setConfirmDeleteIssue(issue)}
          title="Delete"
          className="p-1 rounded-md text-[color:var(--text-muted)] hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition"
        >
          <FiTrash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }
  return <span className="text-[color:var(--text-muted)]">—</span>;
}

export function IssuesTableView(props: IssuesTableViewProps) {
  const {
    issues,
    projectId,
    project,
    visibleColumnIds,
    columnWidths,
    onColumnWidthChange,
    selectedIssueIds,
    toggleSelectIssue,
    toggleSelectAll,
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
  } = props;

  const { onResizePointerDown, onResizePointerMove, onResizePointerUp } = useColumnResize(onColumnWidthChange);

  const tableMinWidth =
    ISSUE_TABLE_CHECKBOX_WIDTH +
    visibleColumnIds.reduce((sum, colId) => sum + getColumnWidthPx(colId, columnWidths), 0);

  return (
    <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] card-shadow overflow-hidden">
      <div className="overflow-x-auto">
        <table
          className="w-full text-left text-sm"
          style={{ tableLayout: 'fixed', minWidth: tableMinWidth }}
        >
          <colgroup>
            <col style={{ width: ISSUE_TABLE_CHECKBOX_WIDTH }} />
            {visibleColumnIds.map((colId) => (
              <col key={colId} style={{ width: getColumnWidthPx(colId, columnWidths) }} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] text-[color:var(--text-muted)]">
              <th className="px-3 py-2.5 w-10 relative">
                <input
                  type="checkbox"
                  checked={issues.length > 0 && selectedIssueIds.size === issues.length}
                  onChange={toggleSelectAll}
                  className="rounded border-[color:var(--border-subtle)]"
                  aria-label="Select all"
                />
              </th>
              {visibleColumnIds.map((colId) => {
                const col = ISSUE_TABLE_COLUMNS.find((c) => c.id === colId);
                const widthPx = getColumnWidthPx(colId, columnWidths);
                return (
                  <th
                    key={colId}
                    className={`relative px-3 py-2.5 font-semibold uppercase text-[10px] tracking-wider select-none ${
                      colId === 'actions' ? 'text-right' : 'text-left'
                    }`}
                  >
                    <span className={`block truncate pr-2 ${colId === 'actions' ? 'text-right' : ''}`}>
                      {col?.label ?? colId}
                    </span>
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize ${col?.label ?? colId} column`}
                      className="absolute top-0 right-0 z-10 h-full w-2 cursor-col-resize touch-none group/resize"
                      onPointerDown={onResizePointerDown(colId, widthPx)}
                      onPointerMove={onResizePointerMove}
                      onPointerUp={onResizePointerUp}
                      onPointerCancel={onResizePointerUp}
                    >
                      <span className="absolute inset-y-2 right-0 w-px bg-[color:var(--border-subtle)] group-hover/resize:bg-[color:var(--accent)] group-hover/resize:w-0.5 transition-colors" />
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--border-subtle)]/50">
            {issues.map((issue) => {
              const priorityColor = getPriorityMeta(issue.priority)?.color;
              return (
                <tr
                  key={issue._id}
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('a, button, [role="separator"], input')) return;
                    const pid =
                      projectId ?? (typeof issue.project === 'object' && issue.project ? issue.project._id : '');
                    if (pid) navigate(`/projects/${pid}/issues/${encodeURIComponent(getIssueKey(issue))}`);
                  }}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      const pid =
                        projectId ?? (typeof issue.project === 'object' && issue.project ? issue.project._id : '');
                      if (pid) navigate(`/projects/${pid}/issues/${encodeURIComponent(getIssueKey(issue))}`);
                    }
                  }}
                  style={{ borderLeftColor: priorityColor ?? 'transparent' }}
                  className="group bg-[color:var(--bg-surface)] hover:bg-[color:var(--bg-elevated)] transition-colors cursor-pointer border-l-[3px]"
                >
                  <td className="px-3 py-2.5 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIssueIds.has(issue._id)}
                      onChange={() => toggleSelectIssue(issue._id)}
                      className="rounded border-[color:var(--border-subtle)]"
                      aria-label={`Select ${getIssueKey(issue)}`}
                    />
                  </td>
                  {visibleColumnIds.map((colId) => (
                    <td
                      key={colId}
                      className={`px-3 py-2.5 overflow-hidden ${colId === 'actions' ? 'text-right' : ''}`}
                      onClick={colId === 'actions' ? (e) => e.stopPropagation() : undefined}
                    >
                      {renderCell(
                        colId,
                        issue,
                        project,
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
                        props.projects
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
