import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { projectTemplatesApi, type ProjectTemplate, type ProjectTemplateVersion } from '../lib/api';
import ConfirmModal from '../components/ConfirmModal';
import { EditIcon, TrashIcon } from '../components/icons/NavigationIcons';
import { userHasPermission } from '../utils/permissions';
import { TASK_FLOW_PERMISSIONS } from '@shared/constants/permissions';

function countSummary(t: ProjectTemplate) {
  const s = t.statuses?.length ?? 0;
  const it = t.issueTypes?.length ?? 0;
  const p = t.priorities?.length ?? 0;
  const cf = t.customFields?.length ?? 0;
  const fs = t.fieldSchemes?.length ?? 0;
  const extra = cf > 0 || fs > 0 ? ` · ${cf} fields · ${fs} schemes` : '';
  return `${s} statuses · ${it} types · ${p} priorities${extra}`;
}

export default function ProjectTemplates() {
  const { token, user } = useAuth();
  const activeOrgId = user?.activeOrganizationId;
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editTemplate, setEditTemplate] = useState<ProjectTemplate | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [editLibrary, setEditLibrary] = useState(false);
  const [versionsTemplate, setVersionsTemplate] = useState<ProjectTemplate | null>(null);
  const [versions, setVersions] = useState<ProjectTemplateVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState('');
  const [restoreVersion, setRestoreVersion] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);

  const canManage = userHasPermission(user?.permissions ?? [], TASK_FLOW_PERMISSIONS.PROJECT.PROJECT.CREATE);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError('');
    projectTemplatesApi.list(token).then((res) => {
      setLoading(false);
      if (res.success && res.data) setTemplates(Array.isArray(res.data) ? res.data : []);
      else setError(res.message ?? 'Failed to load templates');
    });
  }, [token, activeOrgId]);

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
    setEditLibrary(!!t.isLibrary);
    setEditError('');
  }

  async function openVersions(t: ProjectTemplate) {
    if (!token) return;
    setVersionsTemplate(t);
    setVersions([]);
    setVersionsError('');
    setVersionsLoading(true);
    const res = await projectTemplatesApi.listVersions(t._id, token);
    setVersionsLoading(false);
    if (res.success && res.data) setVersions(Array.isArray(res.data) ? res.data : []);
    else setVersionsError(res.message ?? 'Failed to load versions');
  }

  async function handleRestore(version: number) {
    if (!token || !versionsTemplate) return;
    setRestoring(true);
    const res = await projectTemplatesApi.restoreVersion(versionsTemplate._id, version, token);
    setRestoring(false);
    setRestoreVersion(null);
    if (res.success && res.data) {
      const updated = res.data as ProjectTemplate;
      setTemplates((prev) => prev.map((x) => (x._id === versionsTemplate._id ? { ...x, ...updated } : x)));
      setVersionsTemplate(null);
    } else setVersionsError(res.message ?? 'Restore failed');
  }

  async function toggleLibrary(t: ProjectTemplate, publish: boolean) {
    if (!token) return;
    const res = await projectTemplatesApi.patch(
      t._id,
      { isLibrary: publish, changelog: publish ? 'Published to library' : 'Removed from library' },
      token
    );
    if (res.success && res.data) {
      const updated = res.data as ProjectTemplate;
      setTemplates((prev) => prev.map((x) => (x._id === t._id ? { ...x, ...updated } : x)));
    } else setError(res.message ?? 'Update failed');
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !editTemplate || !editName.trim()) return;
    setEditSaving(true);
    setEditError('');
    const res = await projectTemplatesApi.patch(
      editTemplate._id,
      {
        name: editName.trim(),
        description: editDescription.trim() || undefined,
        isLibrary: editLibrary,
        changelog: 'Metadata update',
      },
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
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">Project templates</h1>
          <p className="text-sm text-[color:var(--text-muted)] mt-1">
            Saved workflow presets (statuses, issue types, priorities, custom fields, field schemes). Use them when{' '}
            <Link to="/projects" className="text-[color:var(--accent)] hover:underline">
              creating or editing a project
            </Link>
            , or save a new one from any project&apos;s settings.
          </p>
          <p className="text-xs text-[color:var(--text-muted)] mt-2">
            Custom templates are scoped to your active workspace (header). The built-in default is available in every workspace.
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
                      {!isBuiltIn && t.isLibrary && (
                        <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-md bg-[color:var(--accent)]/10 border border-[color:var(--accent)]/30 text-[color:var(--accent)]">
                          Library
                        </span>
                      )}
                      {!isBuiltIn && t.currentVersion != null && t.currentVersion > 0 && (
                        <span className="text-[10px] text-[color:var(--text-muted)]">v{t.currentVersion}</span>
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
                        title={t.isLibrary ? 'Remove from library' : 'Publish to library'}
                        onClick={() => toggleLibrary(t, !t.isLibrary)}
                        className="px-2 py-1 rounded-lg text-[10px] border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
                      >
                        {t.isLibrary ? 'Unpublish' : 'Publish'}
                      </button>
                      <button
                        type="button"
                        title="Version history"
                        onClick={() => openVersions(t)}
                        className="px-2 py-1 rounded-lg text-[10px] border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
                      >
                        Versions
                      </button>
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
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editLibrary}
                    onChange={(e) => setEditLibrary(e.target.checked)}
                    className="rounded border-[color:var(--border-subtle)]"
                  />
                  <span className="text-xs text-[color:var(--text-primary)]">Show in org template library</span>
                </label>
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

      {versionsTemplate &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => !restoring && setVersionsTemplate(null)}
          >
            <div
              className="w-full max-w-lg rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-xl p-6 max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">
                Version history — {versionsTemplate.name}
              </h2>
              <p className="text-xs text-[color:var(--text-muted)] mt-1">
                Restore reverts workflow, custom fields, and field schemes to a saved snapshot.
              </p>
              {versionsError && <p className="text-xs text-red-500 mt-2">{versionsError}</p>}
              {versionsLoading ? (
                <p className="text-xs text-[color:var(--text-muted)] mt-4">Loading…</p>
              ) : versions.length === 0 ? (
                <p className="text-xs text-[color:var(--text-muted)] mt-4">No versions yet.</p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {versions.map((v) => (
                    <li
                      key={v._id}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]"
                    >
                      <div>
                        <span className="text-xs font-medium text-[color:var(--text-primary)]">v{v.version}</span>
                        {v.changelog ? (
                          <span className="text-[11px] text-[color:var(--text-muted)] ml-2">{v.changelog}</span>
                        ) : null}
                        <p className="text-[10px] text-[color:var(--text-muted)] mt-0.5">
                          {v.createdAt ? new Date(v.createdAt).toLocaleString() : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={restoring}
                        onClick={() => setRestoreVersion(v.version)}
                        className="text-[11px] px-2 py-1 rounded border border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-page)] disabled:opacity-50"
                      >
                        Restore
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex justify-end mt-4">
                <button
                  type="button"
                  onClick={() => setVersionsTemplate(null)}
                  className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-muted)]"
                >
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      <ConfirmModal
        open={restoreVersion !== null}
        title="Restore template version"
        message={`Restore ${versionsTemplate?.name ?? 'template'} to version ${restoreVersion}? Current settings will be snapshotted first.`}
        confirmLabel="Restore"
        variant="danger"
        onConfirm={() => restoreVersion != null && handleRestore(restoreVersion)}
        onCancel={() => setRestoreVersion(null)}
      />
    </div>
  );
}
