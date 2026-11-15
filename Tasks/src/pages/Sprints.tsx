import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  sprintsApi,
  boardsApi,
  type Sprint,
  type Board,
} from '../lib/api';
import ConfirmModal from '../components/ConfirmModal';

export default function Sprints() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: '', project: '', board: '' });
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');
  const [movingId, setMovingId] = useState<string | null>(null);
  const [completeModal, setCompleteModal] = useState<{ sprint: Sprint; incompleteCount: number; incompleteIssues: { _id: string; key?: string; title: string }[] } | null>(null);

  useEffect(() => {
    if (!projectId) {
      navigate('/projects', { replace: true });
      return;
    }
  }, [projectId, navigate]);

  // Sprints only run on Scrum boards.
  const scrumBoards = boards.filter((b) => b.type === 'Scrum');

  function loadBoards() {
    if (!token || !projectId) return;
    boardsApi.list(1, 100, projectId, token).then((res) => {
      if (res.success && res.data) setBoards(res.data.data);
    });
  }

  function loadSprints(p = page) {
    if (!token || !projectId) return;
    sprintsApi.list(p, 10, projectId, undefined, token).then((res) => {
      setLoading(false);
      if (res.success && res.data) {
        setSprints(res.data.data);
        setTotal(res.data.total);
      } else setPageError(res.message ?? 'Could not load sprints');
    });
  }

  useEffect(loadBoards, [token, projectId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => loadSprints(page), [token, projectId, page]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !projectId) return;
    setSubmitting(true);
    setSubmitError('');
    // No board chosen → the server uses the project's Scrum board, creating one if there is none.
    const res = await sprintsApi.create(
      { name: form.name, project: projectId, board: form.board || undefined },
      token
    );
    setSubmitting(false);
    if (res.success) {
      setModal(false);
      setForm({ name: '', project: projectId, board: '' });
      if (res.data?.boardCreated) {
        setNotice(`Created the Scrum board "${res.data.board?.name ?? ''}" for this sprint.`);
        loadBoards();
      }
      setPage(1);
      loadSprints(1);
    } else setSubmitError(res.message ?? 'Failed');
  }

  async function startSprint(id: string) {
    if (!token) return;
    setPageError('');
    const res = await sprintsApi.start(id, token);
    // Starting may complete the board's previous active sprint, so reload rather than patch one row.
    if (res.success) {
      loadSprints();
      loadBoards();
    } else setPageError(res.message ?? 'Could not start the sprint');
  }

  async function moveSprint(sprint: Sprint, boardId: string) {
    if (!token || !boardId || boardId === sprint.board?._id) return;
    setPageError('');
    setMovingId(sprint._id);
    const res = await sprintsApi.update(sprint._id, { board: boardId }, token);
    setMovingId(null);
    if (res.success && res.data) {
      setSprints((prev) => prev.map((s) => (s._id === sprint._id ? res.data! : s)));
      loadBoards();
    } else setPageError(res.message ?? 'Could not move the sprint');
  }

  async function openCompleteModal(sprint: Sprint) {
    if (!token || !projectId) return;
    setPageError('');
    const res = await sprintsApi.getCompletionPreview(sprint._id, projectId, token);
    if (!res.success) setPageError(res.message ?? 'Could not complete the sprint');
    if (res.success && res.data) {
      setCompleteModal({
        sprint,
        incompleteCount: res.data.incompleteCount,
        incompleteIssues: res.data.incompleteIssues ?? [],
      });
    }
  }

  async function confirmCompleteSprint() {
    if (!token || !completeModal) return;
    const id = completeModal.sprint._id;
    const res = await sprintsApi.complete(id, token);
    setCompleteModal(null);
    if (res.success && res.data) {
      setSprints((prev) => prev.map((s) => (s._id === id ? res.data! : s)));
      loadBoards();
    } else setPageError(res.message ?? 'Could not complete the sprint');
  }

  const limit = 10;
  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div className="p-8 animate-fade-in">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">Sprints</h1>
          <button
            type="button"
            onClick={() => {
              setForm({ name: '', project: projectId ?? '', board: scrumBoards[0]?._id ?? '' });
              setSubmitError('');
              setModal(true);
            }}
            className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)] transition"
          >
            New sprint
          </button>
        </div>
        {pageError && (
          <p className="mb-4 text-xs text-red-400" role="alert">
            {pageError}
          </p>
        )}
        {notice && <p className="mb-4 text-xs text-[color:var(--text-muted)]">{notice}</p>}
        {scrumBoards.length === 0 && (
          <p className="mb-4 text-xs text-[color:var(--text-muted)]">
            Sprints run on a Scrum board. This project has none yet — one is created with the project’s status columns when you add the first sprint.
          </p>
        )}

        {loading ? (
          <div className="text-[color:var(--text-muted)] text-sm animate-pulse">Loading…</div>
        ) : sprints.length === 0 ? (
          <div className="text-center py-12 rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] text-sm">
            No sprints in this project. Create one to get started.
          </div>
        ) : (
          <ul className="space-y-3">
            {sprints.map((s) => (
              <li
                key={s._id}
                className="flex items-center justify-between p-4 rounded-xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-elevated)] transition"
              >
                <div>
                  <span className="font-medium text-[color:var(--text-primary)] text-sm">{s.name}</span>
                  <p className="text-[color:var(--text-muted)] text-xs mt-0.5">
                    {typeof s.project === 'object' ? s.project.name : ''} ·{' '}
                    {s.board && typeof s.board === 'object' ? (
                      <Link to={`/projects/${projectId}/boards?board=${s.board._id}`} className="hover:text-[color:var(--text-primary)] underline-offset-2 hover:underline">
                        {s.board.name}
                      </Link>
                    ) : (
                      <span className="text-amber-400">no board</span>
                    )}
                    {s.startDate || s.endDate ? (
                      <>
                        {' · '}
                        {s.startDate ? new Date(s.startDate).toLocaleDateString() : '…'} – {s.endDate ? new Date(s.endDate).toLocaleDateString() : '…'}
                      </>
                    ) : null}
                  </p>
                  <span
                    className="inline-block mt-1 px-2 py-0.5 rounded text-[11px] bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)]"
                  >
                    {s.status}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {s.status !== 'completed' && scrumBoards.length > 1 && (
                    <select
                      aria-label={`Board for ${s.name}`}
                      value={s.board?._id ?? ''}
                      disabled={movingId === s._id}
                      onChange={(e) => moveSprint(s, e.target.value)}
                      className="px-2 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)]"
                    >
                      {scrumBoards.map((b) => (
                        <option key={b._id} value={b._id}>{b.name}</option>
                      ))}
                    </select>
                  )}
                  {s.status === 'active' && s.board?._id && (
                    <Link
                      to={`/projects/${projectId}/boards?board=${s.board._id}`}
                      className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)]"
                    >
                      Open board
                    </Link>
                  )}
                  <Link
                    to={`/projects/${projectId}/sprints/${s._id}/report`}
                    className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)]"
                  >
                    View report
                  </Link>
                  {s.status === 'planned' && (
                    <button
                      type="button"
                      onClick={() => startSprint(s._id)}
                      className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)]"
                    >
                      Start
                    </button>
                  )}
                  {s.status === 'active' && (
                    <button
                      type="button"
                      onClick={() => openCompleteModal(s)}
                      className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)]"
                    >
                      Complete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {totalPages > 1 && (
          <div className="mt-6 flex justify-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)] disabled:opacity-50"
            >
              Previous
            </button>
            <span className="px-3 py-1.5 text-[color:var(--text-muted)] text-xs">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)] disabled:opacity-50"
            >
              Next
            </button>
          </div>
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
              <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mb-3">New sprint</h2>
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
                  <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">Scrum board</label>
                  {scrumBoards.length > 0 ? (
                    <select
                      value={form.board}
                      onChange={(e) => setForm((f) => ({ ...f, board: e.target.value }))}
                      className="w-full px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-xs focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40"
                    >
                      {scrumBoards.map((b) => (
                        <option key={b._id} value={b._id}>
                          {b.name}
                          {b.activeSprint ? ` (running: ${b.activeSprint.name})` : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs text-[color:var(--text-muted)]">
                      A Scrum board will be created for this project.
                    </p>
                  )}
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

      <ConfirmModal
        open={!!completeModal}
        title="Complete sprint"
        message={
          completeModal ? (
            <span>
              Complete <strong>{completeModal.sprint.name}</strong>?
              {completeModal.incompleteCount > 0 ? (
                <>
                  {' '}
                  <span className="text-amber-500">
                    {completeModal.incompleteCount} incomplete issue{completeModal.incompleteCount !== 1 ? 's' : ''} will be moved back to the backlog.
                  </span>
                  {completeModal.incompleteIssues.length > 0 && (
                    <ul className="mt-2 text-xs text-[color:var(--text-muted)] max-h-24 overflow-y-auto list-disc list-inside">
                      {completeModal.incompleteIssues.slice(0, 10).map((i) => (
                        <li key={i._id}>
                          {i.key ?? i._id}: {i.title}
                        </li>
                      ))}
                      {completeModal.incompleteCount > 10 && (
                        <li>…and {completeModal.incompleteCount - 10} more</li>
                      )}
                    </ul>
                  )}
                </>
              ) : (
                ' All issues are done.'
              )}
            </span>
          ) : (
            ''
          )
        }
        confirmLabel="Complete sprint"
        variant="default"
        onConfirm={confirmCompleteSprint}
        onCancel={() => setCompleteModal(null)}
      />
    </div>
  );
}
