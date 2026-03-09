import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  DndContext,
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
  const [project, setProject] = useState<Project | null>(null);
  const [watchingStatus, setWatchingStatus] = useState<Record<string, boolean>>({});
  const [watchingLoadingId, setWatchingLoadingId] = useState<string | null>(null);

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

  const columns = selectedBoard?.columns?.length
    ? selectedBoard.columns.sort((a, b) => a.order - b.order)
    : [
        { name: 'Backlog', statusId: 'Backlog', order: 0 },
        { name: 'Todo', statusId: 'Todo', order: 1 },
        { name: 'In Progress', statusId: 'In Progress', order: 2 },
        { name: 'Done', statusId: 'Done', order: 3 },
      ];

  const issuesByStatus = columns.reduce<Record<string, Issue[]>>((acc, col) => {
    acc[col.statusId] = boardIssues.filter((i) => i.status === col.statusId);
    return acc;
  }, {});

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
            <h2 className="text-lg font-semibold text-[color:var(--text-primary)] mt-2">{selectedBoard.name}</h2>
          </div>
        ) : null}

        {selectedBoard ? (
          <div className="space-y-2">
            {boardError && (
              <p className="text-sm text-red-400" role="alert">
                {boardError}
              </p>
            )}
            <DndContext sensors={boardSensors} onDragEnd={handleBoardDragEnd}>
              <div className="flex gap-4 overflow-x-auto pb-4">
                {columns.map((col) => {
                  const colIssues = issuesByStatus[col.statusId] ?? [];
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
              </div>
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
    </div>
  );
}
