import { Link } from 'react-router-dom';
import { FiTrash2 } from 'react-icons/fi';
import { WatchButton } from '../issue';
import { EditIcon } from '../icons/NavigationIcons';
import {
  ISSUE_TABLE_COLUMNS,
  ISSUE_TABLE_CHECKBOX_WIDTH,
  getColumnWidthPx,
} from './constants';
import { useColumnResize } from './useColumnResize';
import type { Issue, Project } from '../../lib/api';
import { DueDate, PersonCell, PriorityTag, RelativeDate, StatusPill, TypeTag } from './issueUi';

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
    return <TypeTag label={issue.type} meta={getTypeMeta(issue.type)} />;
  }
  if (colId === 'ticketId') {
    return (
      <span className="block truncate font-mono text-[11.5px] font-semibold text-[color:var(--text-muted)] transition-colors group-hover:text-[color:var(--accent)]" title={getIssueKey(issue)}>
        {getIssueKey(issue)}
      </span>
    );
  }
  if (colId === 'summary') {
    const pid = projectId ?? (typeof issue.project === 'object' && issue.project ? issue.project._id : '');
    return (
      <Link
        to={pid ? `/projects/${pid}/issues/${encodeURIComponent(getIssueKey(issue))}` : '#'}
        className={`flex w-full items-center gap-1.5 text-[13.5px] font-medium text-[color:var(--text-primary)] hover:text-[color:var(--accent)] ${issue.parent ? 'pl-3' : ''}`}
        title={issue.title}
      >
        {issue.parent && <span className="shrink-0 text-[11px] text-[color:var(--text-muted)]" title="Sub-item">↳</span>}
        <span className="truncate">{issue.title}</span>
      </Link>
    );
  }
  if (colId === 'assignee') {
    return <PersonCell name={typeof issue.assignee === 'object' && issue.assignee ? issue.assignee.name : null} />;
  }
  if (colId === 'reporter') {
    return <PersonCell name={typeof issue.reporter === 'object' && issue.reporter ? issue.reporter.name : null} />;
  }
  if (colId === 'priority') {
    return <PriorityTag label={issue.priority} meta={getPriorityMeta(issue.priority)} />;
  }
  if (colId === 'status') {
    return <StatusPill label={issue.status} meta={getStatusMeta(issue.status)} />;
  }
  if (colId === 'dueDate') {
    return <DueDate value={issue.dueDate} />;
  }
  if (colId === 'startDate') {
    return <RelativeDate value={issue.startDate} />;
  }
  if (colId === 'storyPoints') {
    return issue.storyPoints != null ? (
      <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-[color:var(--bg-elevated)] px-1.5 text-[11px] font-bold tabular-nums text-[color:var(--text-primary)]">
        {issue.storyPoints}
      </span>
    ) : (
      <span className="text-[color:var(--text-muted)] text-sm">—</span>
    );
  }
  if (colId === 'created') {
    return <RelativeDate value={issue.createdAt} />;
  }
  if (colId === 'updated') {
    return <RelativeDate value={issue.updatedAt} />;
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
          <span key={l} className="inline-flex max-w-[110px] truncate rounded-full bg-[color:var(--bg-elevated)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--text-muted)]">
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
      <div className={`flex items-center justify-end gap-0.5 transition-opacity ${watchingStatus[issue._id] ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}>
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
          className="rounded-md p-1.5 text-[color:var(--text-muted)] transition hover:bg-[color:var(--accent-subtle)] hover:text-[color:var(--accent)]"
        >
          <EditIcon className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setConfirmDeleteIssue(issue)}
          title="Delete"
          className="rounded-md p-1.5 text-[color:var(--text-muted)] transition hover:bg-red-500/10 hover:text-red-500"
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
    <div className="overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] card-shadow">
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
            <tr className="border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]/70 text-[color:var(--text-muted)]">
              <th className="relative w-10 px-3 py-2.5">
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
                    className={`relative select-none px-3 py-2.5 text-[11px] font-semibold tracking-wide ${
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
              const selected = selectedIssueIds.has(issue._id);
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
                  aria-selected={selected}
                  className={`group cursor-pointer outline-none transition-colors focus-visible:bg-[color:var(--bg-elevated)] ${
                    selected
                      ? 'bg-[color:var(--accent-subtle)] hover:bg-[color:var(--accent-subtle)]'
                      : 'bg-[color:var(--bg-surface)] hover:bg-[color:var(--bg-elevated)]/70'
                  }`}
                >
                  <td className={`overflow-hidden px-3 py-2.5 ${selected ? 'shadow-[inset_3px_0_0_var(--accent)]' : ''}`} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSelectIssue(issue._id)}
                      className="rounded border-[color:var(--border-subtle)]"
                      aria-label={`Select ${getIssueKey(issue)}`}
                    />
                  </td>
                  {visibleColumnIds.map((colId) => (
                    <td
                      key={colId}
                      className={`overflow-hidden px-3 py-2.5 align-middle ${colId === 'actions' ? 'text-right' : ''}`}
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
