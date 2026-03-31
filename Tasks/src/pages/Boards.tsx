import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  type DragEndEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationsContext';
import { boardsApi, issuesApi, projectsApi, type Board, type Issue, type Project, getIssueKey } from '../lib/api';
import { MetaBadge } from '../components/MetaBadge';
import { WatchButton } from '../components/issue';
import { KanbanScrollArea, KanbanDragPreview } from '../components/issues';

function StatusMultiSelect({
  selected,
  options,
  label,
  onChange,
}: {
  selected: string[];
  options: string[];
  label?: string;
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  function toggleValue(value: string) {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value]
    );
  }

  const selectedCount = selected.length;

  return (
    <div className="relative">
      {label && (
        <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">
          {label}
        </label>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-left text-xs text-[color:var(--text-primary)]"
      >
        <span>
          {selectedCount ? `${selectedCount} selected` : 'Select statuses'}
        </span>
        <span className="text-[color:var(--text-muted)]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full py-1 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] shadow-xl max-h-48 overflow-y-auto">
          {options.map((opt) => {
            const isSelected = selected.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => toggleValue(opt)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs ${
                  isSelected
                    ? 'bg-[color:var(--bg-surface)] text-[color:var(--text-primary)]'
                    : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-surface)]'
                }`}
              >
                <span
                  className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 text-[10px] ${
                    isSelected
                      ? 'border-[color:var(--accent)]'
                      : 'border-[color:var(--border-subtle)]'
                  }`}
                >
                  {isSelected ? '✓' : ''}
                </span>
                {opt}
              </button>
            );
          })}
          {options.length === 0 && (
            <div className="px-3 py-2 text-[color:var(--text-muted)] text-xs">
              No statuses configured for this project
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BoardColumn({
  statusId,
  name,
  count,
  getStatusMeta,
  children,
}: {
  statusId: string;
  name: string;
  count: number;
  getStatusMeta: (name: string) => { icon?: string; color?: string } | undefined;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: statusId });
  const statusMeta = getStatusMeta(name);
  return (
    <div
      ref={setNodeRef}
      className={`w-72 shrink-0 rounded-xl overflow-hidden border transition-colors animate-slide-in-right ${
        isOver
          ? 'border-[color:var(--accent)] ring-1 ring-[color:var(--accent)]/40'
          : 'border-[color:var(--border-subtle)]'
      } bg-[color:var(--bg-surface)]`}
    >
      <div className="p-3 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]">
        <div className="flex items-center gap-2">
          <MetaBadge label={name} meta={statusMeta} />
          <span className="text-[11px] text-[color:var(--text-muted)]">{count} issues</span>
        </div>
      </div>
      <div className="p-2 min-h-[200px] space-y-2">{children}</div>
    </div>
  );
}

function BoardCard({
  issue,
  projectId,
  getIssueKeyFn,
  getTypeMeta,
  getPriorityMeta,
  isUpdating,
  watching,
  watchingLoading,
  onToggleWatch,
}: {
  issue: Issue;
  projectId: string;
  getIssueKeyFn: (issue: Issue) => string;
  getTypeMeta: (name: string) => { icon?: string; color?: string } | undefined;
  getPriorityMeta: (name: string) => { icon?: string; color?: string } | undefined;
  isUpdating: boolean;
  watching?: boolean;
  watchingLoading?: boolean;
  onToggleWatch?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: issue._id,
  });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex gap-2 min-w-0 ${isDragging ? 'opacity-50' : ''} ${isUpdating ? 'animate-pulse' : ''}`}
    >
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
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <Link
          to={`/projects/${projectId}/issues/${encodeURIComponent(getIssueKeyFn(issue))}`}
          className="block p-3 rounded-lg bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-elevated)] text-left transition"
        >
          <p className="text-[11px] font-mono text-[color:var(--text-muted)]">{getIssueKeyFn(issue)}</p>
          <p className="text-sm font-medium text-[color:var(--text-primary)] truncate">{issue.title}</p>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            <MetaBadge label={issue.type} meta={getTypeMeta(issue.type)} />
            <MetaBadge label={issue.priority} meta={getPriorityMeta(issue.priority)} />
            {issue.storyPoints != null && (
              <span className="text-[10px] text-[color:var(--text-muted)]">{issue.storyPoints} SP</span>
            )}
          </div>
        </Link>
        {onToggleWatch && (
          <div className="px-3 pb-2">
            <WatchButton
              watching={watching ?? false}
              loading={watchingLoading ?? false}
              onWatch={onToggleWatch}
              onUnwatch={onToggleWatch}
              size="sm"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function Boards() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const { subscribeProject } = useNotifications();
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<{ name: string; type: 'Kanban' | 'Scrum'; project: string }>({
    name: '',
    type: 'Kanban',
    project: projectId ?? '',
  });
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null);
  const [boardIssues, setBoardIssues] = useState<Issue[]>([]);
  const [boardUpdatingId, setBoardUpdatingId] = useState<string | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [boardDragId, setBoardDragId] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [watchingStatus, setWatchingStatus] = useState<Record<string, boolean>>({});
  const [watchingLoadingId, setWatchingLoadingId] = useState<string | null>(null);
  const [configModal, setConfigModal] = useState(false);
  const [configColumns, setConfigColumns] = useState<Board['columns']>([]);
  const [configError, setConfigError] = useState('');
  const [configSaving, setConfigSaving] = useState(false);

  useEffect(() => {
    if (!projectId) {
      navigate('/projects', { replace: true });
      return;
    }
  }, [projectId, navigate]);

  useEffect(() => {
    if (!projectId) return;
    return subscribeProject(projectId, () => {
      if (token && projectId) {
        boardsApi.list(1, 10, projectId, token).then((res) => {
          if (res.success && res.data) setBoards(res.data.data);
        });
      }
      if (token && selectedBoard) {
        const pid = typeof selectedBoard.project === 'object' ? selectedBoard.project._id : projectId;
        if (pid) {
          issuesApi.list({ page: 1, limit: 100, token, project: pid }).then((res) => {
            if (res.success && res.data) setBoardIssues(res.data.data);
          });
        }
      }
    });
  }, [projectId, subscribeProject, token, selectedBoard]);

  useEffect(() => {
    if (!token || !projectId) return;
    setLoading(true);
    boardsApi.list(1, 10, projectId, token).then((res) => {
      setLoading(false);
      if (res.success && res.data) {
        setBoards(res.data.data);
      }
    });
  }, [token, projectId]);

  useEffect(() => {
    if (!token || !selectedBoard) return;
    const pid = typeof selectedBoard.project === 'object' ? selectedBoard.project._id : projectId;
    if (!pid) return;
    issuesApi.list({ page: 1, limit: 100, token, project: pid }).then((res) => {
      if (res.success && res.data) setBoardIssues(res.data.data);
    });
  }, [token, selectedBoard, projectId]);

  useEffect(() => {
    if (!token || boardIssues.length === 0) return;
    const ids = boardIssues.map((i) => i._id);
    issuesApi.getWatchingStatusBatch(ids, token).then((res) => {
      if (res.success && res.data) setWatchingStatus(res.data);
    });
  }, [token, boardIssues.map((i) => i._id).join(',')]);

  useEffect(() => {
    if (!token || !selectedBoard) return;
    const pid = typeof selectedBoard.project === 'object' ? selectedBoard.project._id : projectId;
    if (!pid) return;
    projectsApi.get(pid, token).then((res) => {
      if (res.success && res.data) setProject(res.data);
    });
  }, [token, selectedBoard, projectId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !projectId) return;
    setSubmitting(true);
    setSubmitError('');
    const res = await boardsApi.create(
      { name: form.name, type: form.type, project: projectId },
      token
    );
    setSubmitting(false);
    if (res.success) {
      setModal(false);
      setForm({ name: '', type: 'Kanban', project: projectId });
      boardsApi.list(1, 10, projectId, token).then((r) => {
        if (r.success && r.data) setBoards(r.data.data);
      });
    } else setSubmitError(res.message ?? 'Failed');
  }

  const defaultColumns: Board['columns'] = [
    { name: 'Backlog', statusId: 'Backlog', order: 0 },
    { name: 'Todo', statusId: 'Todo', order: 1 },
    { name: 'In Progress', statusId: 'In Progress', order: 2 },
    { name: 'Done', statusId: 'Done', order: 3 },
  ];

  const columns = selectedBoard?.columns?.length
    ? [...selectedBoard.columns].sort((a, b) => a.order - b.order)
    : defaultColumns;

  const boardDragIssue = boardDragId ? boardIssues.find((i) => i._id === boardDragId) : undefined;

  const getTypeMeta = (name: string) => project?.issueTypes?.find((t) => t.name === name);
  const getPriorityMeta = (name: string) => project?.priorities?.find((p) => p.name === name);
  const getStatusMeta = (name: string) => project?.statuses?.find((s) => s.name === name);

  const boardSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  async function handleToggleWatch(issueId: string) {
    if (!token) return;
    setWatchingLoadingId(issueId);
    const currentlyWatching = watchingStatus[issueId] ?? false;
    const res = currentlyWatching
      ? await issuesApi.unwatch(issueId, token)
      : await issuesApi.watch(issueId, token);
    setWatchingLoadingId(null);
    if (res.success) {
      setWatchingStatus((prev) => ({ ...prev, [issueId]: !currentlyWatching }));
    }
  }

  async function handleBoardDragEnd(ev: DragEndEvent) {
    const { active, over } = ev;
    setBoardError(null);
    if (!over || !token || active.id === over.id) return;
    const issueId = String(active.id);
    const targetStatusId = String(over.id);
    const issue = boardIssues.find((i) => i._id === issueId);
    if (!issue || issue.status === targetStatusId) return;
    setBoardUpdatingId(issueId);
    const res = await issuesApi.update(
      issueId,
      { status: targetStatusId, boardColumn: targetStatusId },
      token
    );
    setBoardUpdatingId(null);
    if (res.success && res.data) {
      setBoardIssues((prev) =>
        prev.map((i) =>
          i._id === issueId ? { ...i, status: targetStatusId, boardColumn: targetStatusId } : i
        )
      );
    } else {
      setBoardError(res.message || 'Failed to update status');
    }
  }

  function openConfigModal() {
    if (!selectedBoard) return;
    const baseColumns = selectedBoard.columns?.length
      ? [...selectedBoard.columns].sort((a, b) => a.order - b.order)
      : defaultColumns;
    setConfigColumns(
      baseColumns.map((col, index) => ({
        ...col,
        visibleStatuses:
          col.visibleStatuses && col.visibleStatuses.length > 0
            ? [...col.visibleStatuses]
            : [col.statusId],
        order: index,
      }))
    );
    setConfigError('');
    setConfigModal(true);
  }

  function updateConfigColumn(index: number, key: 'name' | 'statusId', value: string) {
    setConfigColumns((prev) =>
      prev.map((col, i) => (i === index ? { ...col, [key]: value, order: i } : col))
    );
  }

  function moveConfigColumn(index: number, direction: -1 | 1) {
    setConfigColumns((prev) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[nextIndex];
      copy[nextIndex] = temp;
      return copy.map((col, i) => ({ ...col, order: i }));
    });
  }

  function removeConfigColumn(index: number) {
    setConfigColumns((prev) => prev.filter((_, i) => i !== index).map((col, i) => ({ ...col, order: i })));
  }

  function addConfigColumn() {
    const fallbackStatus = project?.statuses?.[0]?.name ?? '';
    setConfigColumns((prev) => [
      ...prev,
      {
        name: `Column ${prev.length + 1}`,
        statusId: fallbackStatus,
        visibleStatuses: fallbackStatus ? [fallbackStatus] : [],
        order: prev.length,
      },
    ]);
  }

  function updateConfigVisibleStatuses(index: number, statuses: string[]) {
    setConfigColumns((prev) =>
      prev.map((col, i) =>
        i === index
          ? {
              ...col,
              statusId: statuses[0] ?? '',
              visibleStatuses: statuses,
              order: i,
            }
          : col
      )
    );
  }

  async function saveBoardConfiguration() {
    if (!selectedBoard || !token) return;
    const normalized = configColumns.map((col, index) => ({
      name: col.name.trim(),
      statusId: (col.visibleStatuses && col.visibleStatuses[0]) ? col.visibleStatuses[0].trim() : col.statusId.trim(),
      visibleStatuses:
        col.visibleStatuses && col.visibleStatuses.length > 0
          ? Array.from(new Set(col.visibleStatuses.map((s) => s.trim()).filter(Boolean)))
          : [col.statusId.trim()],
      order: index,
    }));
    if (normalized.length === 0) {
      setConfigError('Add at least one column.');
      return;
    }
    if (normalized.some((col) => !col.name || !col.statusId || !col.visibleStatuses.length)) {
      setConfigError('Column name and at least one status are required.');
      return;
    }

    const statusUsage = new Map<string, number>();
    for (const col of normalized) {
      for (const status of col.visibleStatuses) {
        statusUsage.set(status, (statusUsage.get(status) ?? 0) + 1);
      }
    }
    const duplicatedStatuses = Array.from(statusUsage.entries())
      .filter(([, count]) => count > 1)
      .map(([status]) => status);
    if (duplicatedStatuses.length > 0) {
      setConfigError('Each status can only be assigned to one column.');
      return;
    }

    setConfigSaving(true);
    setConfigError('');
    const res = await boardsApi.update(selectedBoard._id, { columns: normalized }, token);
    setConfigSaving(false);

    if (!res.success || !res.data) {
      setConfigError(res.message ?? 'Failed to save board configuration');
      return;
    }

    setSelectedBoard(res.data);
    setBoards((prev) => prev.map((board) => (board._id === res.data!._id ? res.data! : board)));
    setConfigModal(false);
  }

  return (
    <div className="p-8 animate-fade-in">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">Boards</h1>
          <button
            type="button"
            onClick={() => {
              setForm({ name: '', type: 'Kanban', project: projectId ?? '' });
              setSubmitError('');
              setModal(true);
            }}
            className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)] transition"
          >
            New board
          </button>
        </div>

        {selectedBoard ? (
          <div className="mb-6">
            <button
              type="button"
              onClick={() => setSelectedBoard(null)}
              className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
            >
              ← All boards
            </button>
            <div className="mt-2 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">{selectedBoard.name}</h2>
              <button
                type="button"
                onClick={openConfigModal}
                className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)] transition"
              >
                Configure board
              </button>
            </div>
          </div>
        ) : null}

        {selectedBoard ? (
          <div className="space-y-2">
            {boardError && (
              <p className="text-sm text-red-400" role="alert">
                {boardError}
              </p>
            )}
            <DndContext
              sensors={boardSensors}
              collisionDetection={pointerWithin}
              onDragStart={({ active }) => setBoardDragId(String(active.id))}
              onDragEnd={async (ev) => {
                setBoardDragId(null);
                await handleBoardDragEnd(ev);
              }}
              onDragCancel={() => setBoardDragId(null)}
            >
              <KanbanScrollArea>
                {columns.map((col) => {
                  const visibleStatuses =
                    col.visibleStatuses && col.visibleStatuses.length > 0
                      ? col.visibleStatuses
                      : [col.statusId];
                  const colIssues = boardIssues.filter((i) => visibleStatuses.includes(i.status));
                  return (
                    <BoardColumn
                      key={col.statusId}
                      statusId={col.statusId}
                      name={col.name}
                      count={colIssues.length}
                      getStatusMeta={getStatusMeta}
                    >
                      {colIssues.map((issue) => (
                        <BoardCard
                          key={issue._id}
                          issue={issue}
                          projectId={projectId!}
                          getIssueKeyFn={getIssueKey}
                          getTypeMeta={getTypeMeta}
                          getPriorityMeta={getPriorityMeta}
                          isUpdating={boardUpdatingId === issue._id}
                          watching={watchingStatus[issue._id]}
                          watchingLoading={watchingLoadingId === issue._id}
                          onToggleWatch={() => handleToggleWatch(issue._id)}
                        />
                      ))}
                    </BoardColumn>
                  );
                })}
              </KanbanScrollArea>
              <DragOverlay dropAnimation={null}>
                {boardDragIssue ? (
                  <KanbanDragPreview
                    issueKey={getIssueKey(boardDragIssue)}
                    title={boardDragIssue.title}
                  />
                ) : null}
              </DragOverlay>
            </DndContext>
          </div>
        ) : (
          <>
            {loading ? (
              <div className="text-[color:var(--text-muted)] text-sm animate-pulse">Loading…</div>
            ) : boards.length === 0 ? (
              <div className="text-center py-12 rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] text-sm">
                No boards in this project. Create one above.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {boards.map((b) => (
                  <button
                    key={b._id}
                    type="button"
                    onClick={() => setSelectedBoard(b)}
                    className="p-6 rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-elevated)] text-left transition animate-fade-in"
                  >
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full border border-[color:var(--border-subtle)] text-xs">
                      {b.type === 'Scrum' ? 'SP' : 'BD'}
                    </span>
                    <h3 className="font-semibold mt-2">{b.name}</h3>
                    <p className="text-[color:var(--text-muted)] text-xs mt-0.5">
                      {b.type} · {typeof b.project === 'object' ? b.project.name : ''}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {modal &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-4"
            onClick={() => setModal(false)}
          >
            <div
              className="w-full max-w-md bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl p-6 shadow-xl animate-scale-in"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mb-3">New board</h2>
              <form onSubmit={handleSubmit} className="space-y-3">
                {submitError && <p className="text-xs text-red-400">{submitError}</p>}
                <div>
                  <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">Name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    required
                    className="w-full px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-xs focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">Type</label>
                  <select
                    value={form.type}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, type: e.target.value as 'Kanban' | 'Scrum' }))
                    }
                    className="w-full px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-xs focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40"
                  >
                    <option value="Kanban">Kanban</option>
                    <option value="Scrum">Scrum</option>
                  </select>
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setModal(false)}
                    className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)] disabled:opacity-50"
                  >
                    {submitting ? 'Creating…' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {configModal &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-4"
            onClick={() => {
              if (configSaving) return;
              setConfigModal(false);
            }}
          >
            <div
              className="w-full max-w-2xl bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl p-6 shadow-xl animate-scale-in"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mb-3">
                Configure board columns
              </h2>
              {configError && <p className="text-xs text-red-400 mb-3">{configError}</p>}
              <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                {configColumns.map((col, index) => {
                  const allStatusNames = (project?.statuses ?? []).map((status) => status.name);
                  const selectedForThisColumn =
                    col.visibleStatuses && col.visibleStatuses.length > 0
                      ? col.visibleStatuses
                      : col.statusId
                      ? [col.statusId]
                      : [];

                  const usedInOtherColumns = new Set<string>();
                  configColumns.forEach((c, i) => {
                    if (i === index) return;
                    const vs =
                      c.visibleStatuses && c.visibleStatuses.length > 0
                        ? c.visibleStatuses
                        : c.statusId
                        ? [c.statusId]
                        : [];
                    vs.forEach((s) => usedInOtherColumns.add(s));
                  });

                  const optionsForThisColumn = allStatusNames.filter(
                    (name) => selectedForThisColumn.includes(name) || !usedInOtherColumns.has(name)
                  );

                  return (
                    <div
                      key={`${col.statusId}-${index}`}
                      className="grid grid-cols-12 gap-2 items-center rounded-lg border border-[color:var(--border-subtle)] p-2"
                    >
                      <div className="col-span-4">
                        <input
                          type="text"
                          value={col.name}
                          onChange={(e) => updateConfigColumn(index, 'name', e.target.value)}
                          className="w-full px-2 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-xs focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40"
                          placeholder="Column name"
                        />
                      </div>
                      <div className="col-span-5">
                        <StatusMultiSelect
                          selected={selectedForThisColumn}
                          options={optionsForThisColumn}
                          onChange={(values) => updateConfigVisibleStatuses(index, values)}
                        />
                      </div>
                      <div className="col-span-3 flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => moveConfigColumn(index, -1)}
                          disabled={index === 0}
                          className="px-2 py-1 rounded border border-[color:var(--border-subtle)] text-xs disabled:opacity-40"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveConfigColumn(index, 1)}
                          disabled={index === configColumns.length - 1}
                          className="px-2 py-1 rounded border border-[color:var(--border-subtle)] text-xs disabled:opacity-40"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => removeConfigColumn(index)}
                          className="px-2 py-1 rounded border border-red-500/40 text-xs text-red-300"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={addConfigColumn}
                  className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)]"
                >
                  Add column
                </button>
              </div>
              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setConfigModal(false)}
                  disabled={configSaving}
                  className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveBoardConfiguration}
                  disabled={configSaving}
                  className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)] disabled:opacity-50"
                >
                  {configSaving ? 'Saving…' : 'Save configuration'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
