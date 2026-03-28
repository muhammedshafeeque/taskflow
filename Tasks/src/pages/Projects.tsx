import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { EditIcon, TrashIcon } from '../components/icons/NavigationIcons';
import { projectsApi, usersApi, projectTemplatesApi, type Project, type User, type ProjectTemplate } from '../lib/api';
import ConfirmModal from '../components/ConfirmModal';

export default function Projects() {
  const { token, user } = useAuth();
  const location = useLocation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState({
    name: '',
    key: '',
    description: '',
    lead: '',
    templateId: '',
    applyTemplateId: '',
  });
  const [editId, setEditId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);

  const limit = 10;

  useEffect(() => {
    if (!token || location.pathname !== '/projects') return;
    setLoading(true);
    projectsApi.list(page, limit, token).then((res) => {
      setLoading(false);
      if (res.success && res.data) {
        setProjects(res.data.data);
        setTotal(res.data.total);
      }
    });
  }, [token, page, location.pathname]);

  useEffect(() => {
    if (!token || !modal) return;
    usersApi.list(1, 100, token).then((res) => {
      if (res.success && res.data) setUsers(res.data.data);
    });
  }, [token, modal]);

  useEffect(() => {
    if (!token || !modal) return;
    projectTemplatesApi.list(token).then((res) => {
      if (res.success && res.data) setTemplates(Array.isArray(res.data) ? res.data : []);
    });
  }, [token, modal]);

  function openCreate() {
    setForm({ name: '', key: '', description: '', lead: user?.id ?? '', templateId: '', applyTemplateId: '' });
    setEditId(null);
    setSubmitError('');
    setModal('create');
  }

  function openEdit(p: Project) {
    setForm({
      name: p.name,
      key: p.key,
      description: p.description ?? '',
      lead: typeof p.lead === 'object' && p.lead ? p.lead._id : '',
      templateId: '',
      applyTemplateId: '',
    });
    setEditId(p._id);
    setSubmitError('');
    setModal('edit');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setSubmitError('');
    if (modal === 'create') {
      const res = await projectsApi.create(
        { name: form.name, key: form.key.toUpperCase(), description: form.description || undefined, lead: form.lead, templateId: form.templateId || undefined },
        token
      );
      if (res.success) {
        setModal(null);
        setPage(1);
        projectsApi.list(1, limit, token).then((r) => {
          if (r.success && r.data) {
            setProjects(r.data.data);
            setTotal(r.data.total);
          }
        });
      } else setSubmitError(res.message ?? 'Failed');
    } else if (editId) {
      const body: Parameters<typeof projectsApi.update>[1] = {
        name: form.name,
        key: form.key.toUpperCase(),
        description: form.description,
        lead: form.lead,
      };
      if (form.applyTemplateId.trim()) body.templateId = form.applyTemplateId.trim();
      const res = await projectsApi.update(editId, body, token);
      if (res.success) {
        setModal(null);
        projectsApi.list(page, limit, token).then((r) => {
          if (r.success && r.data) {
            setProjects(r.data.data);
            setTotal(r.data.total);
          }
        });
      } else setSubmitError(res.message ?? 'Failed');
    }
    setSubmitting(false);
  }

  async function handleDelete(id: string) {
    if (!token) return;
    const res = await projectsApi.delete(id, token);
    if (res.success) {
      setProjects((prev) => prev.filter((p) => p._id !== id));
      setTotal((t) => Math.max(0, t - 1));
      setDeleteConfirmId(null);
    }
  }

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div className="p-8 animate-fade-in">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold">Projects</h1>
          {!user?.mustChangePassword &&
            Array.isArray(user?.permissions) &&
            user.permissions.includes('projects:create') && (
              <button
                type="button"
                onClick={openCreate}
                className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)] transition"
              >
                New project
              </button>
            )}
        </div>

        {loading ? (
          <div className="text-[color:var(--text-muted)] animate-pulse">Loading…</div>
        ) : projects.length === 0 ? (
          <div className="text-center py-12 rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] text-[color:var(--text-muted)]">
            No projects yet. Create one to get started.
          </div>
        ) : (
          <ul className="space-y-3">
            {projects.map((p) => (
              <li
                key={p._id}
                className="flex items-center justify-between p-4 rounded-xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-elevated)] transition group"
              >
                <Link
                  to={`/projects/${p._id}/dashboard`}
                  className="flex-1 min-w-0 block hover:opacity-90"
                >
                  <span className="font-medium text-sm">{p.name}</span>
                  <span className="ml-2 text-[12px] text-[color:var(--text-muted)]">({p.key})</span>
                  {p.description && (
                    <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">
                      {p.description}
                    </p>
                  )}
                </Link>
                <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <Link
                    to={`/projects/${p._id}/dashboard`}
                    className="px-3 py-1.5 rounded-md text-xs border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)]"
                  >
                    Open
                  </Link>
                  {p.canEdit && (
                    <button
                      type="button"
                      onClick={() => openEdit(p)}
                      title="Edit"
                      className="p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-button-secondary)] transition"
                    >
                      <EditIcon className="w-4 h-4" />
                    </button>
                  )}
                  {p.canDelete && (
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmId(p._id)}
                      title="Delete"
                      className="p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition"
                    >
                      <TrashIcon className="w-4 h-4" />
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
              className="px-3 py-1.5 rounded-lg btn-secondary border text-[color:var(--text-primary)] disabled:opacity-50"
            >
              Previous
            </button>
            <span className="px-3 py-1.5 text-[color:var(--text-muted)] text-sm">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 rounded-lg btn-secondary border text-[color:var(--text-primary)] disabled:opacity-50"
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
            onClick={() => setModal(null)}
          >
            <div
              className="w-full max-w-md bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl p-6 shadow-xl animate-scale-in"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mb-3">
                {modal === 'create' ? 'New project' : 'Edit project'}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-3">
                {submitError && (
                  <p className="text-xs text-red-400">{submitError}</p>
                )}
                {modal === 'create' && (
                  <div>
                    <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">
                      Workflow template
                    </label>
                    <select
                      value={form.templateId}
                      onChange={(e) => setForm((f) => ({ ...f, templateId: e.target.value }))}
                      className="w-full px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-xs focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40"
                    >
                      <option value="">Server default (same as built-in)</option>
                      {templates
                        .filter((t) => t._id !== 'default')
                        .map((t) => (
                          <option key={t._id} value={t._id}>
                            {t.name}
                          </option>
                        ))}
                    </select>
                    <p className="text-[11px] text-[color:var(--text-muted)] mt-1">
                      Statuses, issue types, and priorities for the new project.{' '}
                      <Link to="/project-templates" className="text-[color:var(--accent)] hover:underline">
                        Manage templates
                      </Link>
                    </p>
                  </div>
                )}
                {modal === 'edit' && (
                  <div>
                    <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">
                      Replace workflow from template
                    </label>
                    <select
                      value={form.applyTemplateId}
                      onChange={(e) => setForm((f) => ({ ...f, applyTemplateId: e.target.value }))}
                      className="w-full px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-xs focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40"
                    >
                      <option value="">Do not change statuses / types / priorities</option>
                      {templates.map((t) => (
                        <option key={t._id} value={t._id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-amber-600 dark:text-amber-400/90 mt-1">
                      Applying a template overwrites this project&apos;s statuses, issue types, and priorities. Existing
                      issues keep their current values; validate boards and filters afterward.
                    </p>
                  </div>
                )}
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
                  <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">Key</label>
                  <input
                    type="text"
                    value={form.key}
                    onChange={(e) => setForm((f) => ({ ...f, key: e.target.value.toUpperCase() }))}
                    required
                    maxLength={10}
                    className="w-full px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-xs focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">Description</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    rows={2}
                    className="w-full px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-xs focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">Lead</label>
                  <select
                    value={form.lead}
                    onChange={(e) => setForm((f) => ({ ...f, lead: e.target.value }))}
                    className="w-full px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-xs focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40"
                  >
                    {users.map((u) => (
                      <option key={u._id} value={u._id}>{u.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)] disabled:opacity-50"
                  >
                    {submitting ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      <ConfirmModal
        open={deleteConfirmId !== null}
        title="Delete project"
        message="Delete this project? This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => deleteConfirmId && handleDelete(deleteConfirmId)}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  );
}
