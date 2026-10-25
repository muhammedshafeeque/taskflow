import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { FiCheck, FiLayers, FiX } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { projectsApi, projectTemplatesApi, usersApi, type Project, type ProjectTemplate, type User } from '../../lib/api';
import { PersonSelect, toPeople } from '../people';

/** Suggest a key from a name: initials of up to four words, else the first letters ("Mobile Banking App" → MBA). */
function suggestKey(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '';
  const key = words.length === 1 ? words[0].slice(0, 4) : words.slice(0, 4).map((w) => w[0]).join('');
  return key.replace(/^[0-9]+/, '').slice(0, 10);
}

const inputCls =
  'w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm text-[color:var(--text-primary)] outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/20';

/** Create or edit a project. `project` set = edit mode. */
export default function ProjectFormModal({
  project,
  onClose,
  onSaved,
}: {
  project: Project | null;
  onClose: () => void;
  onSaved: (p: Project) => void;
}) {
  const { token, user } = useAuth();
  const editing = Boolean(project);
  const [name, setName] = useState(project?.name ?? '');
  const [key, setKey] = useState(project?.key ?? '');
  const [keyTouched, setKeyTouched] = useState(editing);
  const [description, setDescription] = useState(project?.description ?? '');
  const [lead, setLead] = useState(project?.lead?._id ?? user?.id ?? '');
  const [templateId, setTemplateId] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    void usersApi.list(1, 100, token).then((res) => res.success && res.data && setUsers(res.data.data));
    void Promise.all([projectTemplatesApi.list(token), projectTemplatesApi.listLibrary(token)]).then(([all, lib]) => {
      const byId = new Map<string, ProjectTemplate>();
      for (const t of Array.isArray(all.data) ? all.data : []) byId.set(t._id, t);
      for (const t of Array.isArray(lib.data) ? lib.data : []) if (!byId.has(t._id)) byId.set(t._id, t);
      setTemplates([...byId.values()].filter((t) => t._id !== 'default'));
    });
  }, [token]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const keyOk = /^[A-Z][A-Z0-9]{1,9}$/.test(key);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (!keyOk) {
      setError('Key must be 2–10 letters or digits and start with a letter.');
      return;
    }
    if (!lead) {
      setError('Choose a project lead.');
      return;
    }
    setSaving(true);
    setError('');
    const res = project
      ? await projectsApi.update(
          project._id,
          { name, key, description, lead, ...(templateId ? { templateId } : {}) },
          token
        )
      : await projectsApi.create({ name, key, description: description || undefined, lead, templateId: templateId || undefined }, token);
    setSaving(false);
    if (res.success && res.data) onSaved(res.data as Project);
    else setError(res.message ?? 'Could not save the project');
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-2xl animate-scale-in"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[color:var(--border-subtle)] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold">{editing ? 'Edit project' : 'New project'}</h2>
            <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">
              {editing ? 'Rename, re-key or hand the project to a new lead.' : 'A project holds issues, boards, sprints and docs for one piece of work.'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)] hover:text-[color:var(--text-primary)]" aria-label="Close">
            <FiX />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
            <label className="block">
              <span className="mb-1 block text-xs font-medium">Name</span>
              <input
                className={inputCls}
                value={name}
                autoFocus
                required
                placeholder="e.g. Mobile banking app"
                onChange={(e) => {
                  setName(e.target.value);
                  if (!keyTouched) setKey(suggestKey(e.target.value));
                }}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium">Key</span>
              <input
                className={`${inputCls} font-mono uppercase tracking-wider ${key && !keyOk ? 'border-red-500/60' : ''}`}
                value={key}
                required
                maxLength={10}
                onChange={(e) => {
                  setKeyTouched(true);
                  setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                }}
              />
            </label>
          </div>
          <p className="-mt-2 text-[11px] text-[color:var(--text-muted)]">
            {key ? (
              <>
                Issues will be numbered <span className="font-mono text-[color:var(--text-primary)]">{key}-1</span>,{' '}
                <span className="font-mono text-[color:var(--text-primary)]">{key}-2</span>…
                {editing && project?.key !== key && <span className="text-amber-500"> Existing issues keep their {project?.key} keys; only new issues use {key}.</span>}
              </>
            ) : (
              'The key prefixes every issue in this project.'
            )}
          </p>

          <label className="block">
            <span className="mb-1 block text-xs font-medium">Description</span>
            <textarea className={inputCls} rows={2} value={description} placeholder="What is this project for?" onChange={(e) => setDescription(e.target.value)} />
          </label>

          <div>
            <span className="mb-1 block text-xs font-medium">Lead</span>
            <PersonSelect value={lead} onChange={setLead} people={toPeople(users)} placeholder="Choose project lead…" aria-label="Lead" />
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-xs font-medium">{editing ? 'Replace workflow from a template' : 'Workflow'}</span>
              <Link to="/project-templates" className="text-[11px] text-[color:var(--accent)] hover:underline">
                Manage templates
              </Link>
            </div>
            <div className="grid max-h-52 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              <TemplateCard
                active={!templateId}
                title={editing ? 'Keep current workflow' : 'Default workflow'}
                body={editing ? 'Statuses, types and priorities stay as they are.' : 'Backlog → Todo → In Progress → Done'}
                onClick={() => setTemplateId('')}
              />
              {templates.map((t) => (
                <TemplateCard
                  key={t._id}
                  active={templateId === t._id}
                  title={t.name}
                  body={
                    t.statuses?.length
                      ? t.statuses
                          .slice()
                          .sort((a, b) => a.order - b.order)
                          .map((s) => s.name)
                          .join(' → ')
                      : t.isLibrary
                        ? 'From the template library'
                        : 'Workspace template'
                  }
                  onClick={() => setTemplateId(t._id)}
                />
              ))}
            </div>
            {editing && templateId && (
              <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                Applying a template replaces this project’s statuses, issue types and priorities. Existing issues keep their values — check boards and filters afterwards.
              </p>
            )}
          </div>

          {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-[color:var(--border-subtle)] px-6 py-3.5">
          <button type="button" onClick={onClose} className="rounded-lg border border-[color:var(--border-subtle)] px-4 py-2 text-sm hover:bg-[color:var(--bg-page)]">
            Cancel
          </button>
          <button type="submit" disabled={saving || !name.trim()} className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50">
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create project'}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

function TemplateCard({ active, title, body, onClick }: { active: boolean; title: string; body: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded-xl border p-3 text-left transition ${
        active
          ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/[0.07] ring-1 ring-[color:var(--accent)]/30'
          : 'border-[color:var(--border-subtle)] hover:border-[color:var(--accent)]/40'
      }`}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <FiLayers className="shrink-0 text-[color:var(--text-muted)]" />
        <span className="truncate">{title}</span>
      </span>
      <span className="mt-1 block truncate text-[11px] text-[color:var(--text-muted)]">{body}</span>
      {active && <FiCheck className="absolute right-2.5 top-2.5 text-[color:var(--accent)]" />}
    </button>
  );
}
