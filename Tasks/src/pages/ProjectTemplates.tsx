import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { projectTemplatesApi, type ProjectTemplate } from '../lib/api';
import ConfirmModal from '../components/ConfirmModal';
import { EditIcon, TrashIcon } from '../components/icons/NavigationIcons';

function countSummary(t: ProjectTemplate) {
  const s = t.statuses?.length ?? 0;
  const it = t.issueTypes?.length ?? 0;
  const p = t.priorities?.length ?? 0;
  return `${s} statuses · ${it} types · ${p} priorities`;
}

export default function ProjectTemplates() {
  const { token, user } = useAuth();
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editTemplate, setEditTemplate] = useState<ProjectTemplate | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const canManage = Boolean(user?.permissions?.includes('projects:create'));

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError('');
    projectTemplatesApi.list(token).then((res) => {
      setLoading(false);
      if (res.success && res.data) setTemplates(Array.isArray(res.data) ? res.data : []);
      else setError(res.message ?? 'Failed to load templates');
    });
  }, [token]);

  async function handleDelete(id: string) {
    if (!token) return;
    const res = await projectTemplatesApi.delete(id, token);
    if (res.success) {
      setTemplates((prev) => prev.filter((t) => t._id !== id));
      setDeleteId(null);
    } else setError(res.message ?? 'Delete failed');
  }

  function openEdit(t: ProjectTemplate) {
    setEditTemplate(t);
    setEditName(t.name);
    setEditDescription(t.description ?? '');
    setEditError('');
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !editTemplate || !editName.trim()) return;
    setEditSaving(true);
    setEditError('');
    const res = await projectTemplatesApi.patch(
      editTemplate._id,
      { name: editName.trim(), description: editDescription.trim() || undefined },
      token
    );
    setEditSaving(false);
    if (res.success && res.data) {
      const updated = res.data as ProjectTemplate;
      setTemplates((prev) => prev.map((x) => (x._id === editTemplate._id ? { ...x, ...updated } : x)));
      setEditTemplate(null);
    } else setEditError(res.message ?? 'Save failed');
  }

  return (
    <div className="p-8 animate-fade-in">
      <div className="w-full px-4 sm:px-6 lg:px-8 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">Project templates</h1>
          <p className="text-sm text-[color:var(--text-muted)] mt-1">
            Saved workflow presets (statuses, issue types, priorities). Use them when{' '}
            <Link to="/projects" className="text-[color:var(--accent)] hover:underline">
              creating or editing a project
            </Link>
            , or save a new one from any project&apos;s settings.
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-[color:var(--text-muted)] animate-pulse">Loading…</div>
        ) : (
          <ul className="space-y-3">
            {templates.every((t) => t._id === 'default') && (
              <li className="p-4 rounded-xl border border-dashed border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]/50 text-[color:var(--text-muted)] text-sm">
                You only have the built-in default so far. Open any project →{' '}
                <strong className="text-[color:var(--text-primary)]">Settings</strong> →{' '}
                <strong className="text-[color:var(--text-primary)]">Save workflow as template</strong> to add reusable
                presets.
              </li>
            )}
            {templates.map((t) => {
              const isBuiltIn = t._id === 'default';
              return (
                <li
                  key={t._id}
                  className="flex items-start justify-between gap-4 p-4 rounded-xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-[color:var(--text-primary)]">{t.name}</span>
                      {isBuiltIn && (
                        <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-muted)]">
                          Built-in
                        </span>
                      )}
                    </div>
                    {t.description ? (
                      <p className="text-xs text-[color:var(--text-muted)] mt-1">{t.description}</p>
                    ) : null}
                    <p className="text-[11px] text-[color:var(--text-muted)] mt-2 font-mono">
                      {countSummary(t)}
                    </p>
                  </div>
                  {canManage && !isBuiltIn && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        title="Edit template"
                        onClick={() => openEdit(t)}
                        className="p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] transition"
                      >
                        <EditIcon className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        title="Delete template"
                        onClick={() => setDeleteId(t._id)}
                        className="p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-red-500 hover:bg-red-500/10 transition"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ConfirmModal
        open={deleteId !== null}
        title="Delete template"
        message="Remove this template? Projects already created are not affected."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => deleteId && handleDelete(deleteId)}
        onCancel={() => setDeleteId(null)}
      />

      {editTemplate &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => !editSaving && setEditTemplate(null)}
          >
            <div
              className="w-full max-w-md rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-xl p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">Edit template</h2>
              <p className="text-xs text-[color:var(--text-muted)] mt-1">Rename or update the description. Workflow rows are unchanged.</p>
              <form onSubmit={handleSaveEdit} className="mt-4 space-y-3">
                {editError && <p className="text-xs text-red-500">{editError}</p>}
                <div>
                  <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    required
                    className="w-full px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">Description</label>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-xs resize-y"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    disabled={editSaving}
                    onClick={() => setEditTemplate(null)}
                    className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)] disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={editSaving || !editName.trim()}
                    className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs font-medium text-[color:var(--text-primary)] disabled:opacity-50"
                  >
                    {editSaving ? 'Saving…' : 'Save'}
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
