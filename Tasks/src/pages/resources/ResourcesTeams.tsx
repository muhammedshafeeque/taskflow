import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiActivity, FiCheck, FiEdit2, FiFolder, FiPlus, FiSearch, FiStar, FiTrash2, FiUsers } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import ConfirmModal from '../../components/ConfirmModal';
import { resourcesApi, type ResourceTeamRow } from '../../lib/api';
import {
  Chip,
  EmptyState,
  ErrorBanner,
  Field,
  LoadingBlock,
  Modal,
  PageShell,
  Segmented,
  Stat,
  Toast,
  btnPrimary,
  btnSecondary,
  errorOf,
  inputCls,
  TeamChip,
  teamColor,
  useResourceOptions,
} from './resourceKit';

/** Chip colours offered in the editor; any CSS colour is accepted by the API. */
const SWATCHES = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6', '#64748b'];

function initials(name?: string) {
  return (name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
}

function AvatarStack({ people, max = 6 }: { people: Array<{ id: string; name?: string }>; max?: number }) {
  const shown = people.slice(0, max);
  return (
    <div className="flex -space-x-1.5">
      {shown.map((p) => (
        <span
          key={p.id}
          title={p.name}
          className="w-7 h-7 rounded-full ring-2 ring-[color:var(--bg-surface)] bg-[color:var(--accent-subtle)] text-[color:var(--accent)] text-[10px] font-semibold grid place-items-center"
        >
          {initials(p.name)}
        </span>
      ))}
      {people.length > max && (
        <span className="w-7 h-7 rounded-full ring-2 ring-[color:var(--bg-surface)] bg-[color:var(--bg-elevated)] text-[color:var(--text-muted)] text-[10px] font-semibold grid place-items-center">
          +{people.length - max}
        </span>
      )}
    </div>
  );
}

type ViewMode = 'teams' | 'projects';

export default function ResourcesTeams() {
  const { token, user } = useAuth();
  const workspaceKey = user?.activeOrganizationId ?? '';
  const canManage = canAny(user, 'taskflow.resources.team.manage');
  const { options } = useResourceOptions(token, workspaceKey);
  const [teams, setTeams] = useState<ResourceTeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState('');
  const [memberId, setMemberId] = useState('');
  const [mode, setMode] = useState<ViewMode>('teams');
  const [editing, setEditing] = useState<TeamDraft | null>(null);
  const [confirm, setConfirm] = useState<ResourceTeamRow | null>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(() => {
    if (!token) return;
    resourcesApi.listTeams(token).then((res) => {
      setLoading(false);
      if (res.success && res.data) {
        setTeams(res.data);
        setError('');
      } else setError(errorOf(res, 'Failed to load teams'));
    });
  }, [token]);

  useEffect(() => {
    load();
  }, [load, workspaceKey]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return teams.filter(
      (t) =>
        (!projectId || t.projects.some((p) => p.id === projectId)) &&
        (!memberId || t.members.some((m) => m.id === memberId)) &&
        (!q ||
          t.name.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          t.members.some((m) => m.name?.toLowerCase().includes(q)) ||
          t.projects.some((p) => `${p.key} ${p.name}`.toLowerCase().includes(q)))
    );
  }, [teams, search, projectId, memberId]);

  const coverage = useMemo(() => {
    return options.projects
      .map((p) => {
        const handling = teams.filter((t) => t.projects.some((x) => x.id === p.id));
        const people = new Set(handling.flatMap((t) => t.members.map((m) => m.id)));
        return { project: p, teams: handling, people: people.size };
      })
      .sort((a, b) => b.teams.length - a.teams.length || a.project.name.localeCompare(b.project.name));
  }, [options.projects, teams]);

  const stats = useMemo(() => {
    const inTeam = new Set(teams.flatMap((t) => t.members.map((m) => m.id)));
    return {
      people: inTeam.size,
      unassigned: options.users.filter((u) => !inTeam.has(u.id)).length,
      shared: coverage.filter((c) => c.teams.length > 1).length,
      uncovered: coverage.filter((c) => c.teams.length === 0).length,
    };
  }, [teams, options.users, coverage]);

  async function remove(t: ResourceTeamRow) {
    setConfirm(null);
    if (!token) return;
    const res = await resourcesApi.deleteTeam(t.id, token);
    setToast(res.success ? `Deleted ${t.name}.` : errorOf(res, 'Delete failed'));
    load();
  }

  return (
    <PageShell
      title="Teams"
      description="Internal teams and the projects they handle. A person can be in several teams, and a project can be shared by several teams."
      actions={
        canManage && (
          <button type="button" className={btnPrimary} onClick={() => setEditing(blankTeam())}>
            <FiPlus /> New team
          </button>
        )
      }
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Teams" value={teams.length} hint={`${stats.people} people in at least one team`} />
        <Stat label="Not in a team" value={stats.unassigned} hint="Active workspace members" tone={stats.unassigned ? 'warn' : undefined} />
        <Stat label="Shared projects" value={stats.shared} hint="Handled by more than one team" />
        <Stat label="Projects without a team" value={stats.uncovered} hint={`of ${options.projects.length} projects`} tone={stats.uncovered ? 'warn' : undefined} />
      </div>

      <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2.5 flex flex-wrap items-center gap-2">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'teams', label: 'Teams', count: teams.length },
            { value: 'projects', label: 'By project', count: options.projects.length },
          ]}
        />
        {mode === 'teams' && (
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <div className="relative">
              <FiSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] text-xs" />
              <input type="search" placeholder="Search teams, people, projects…" className={`${inputCls} pl-7 w-60`} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className={`${inputCls} w-auto max-w-[13rem]`} value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
              <option value="">All projects</option>
              {options.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.key} · {p.name}
                </option>
              ))}
            </select>
            <select className={`${inputCls} w-auto max-w-[13rem]`} value={memberId} onChange={(e) => setMemberId(e.target.value)} aria-label="Member">
              <option value="">Anyone</option>
              {options.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading ? (
        <LoadingBlock />
      ) : mode === 'projects' ? (
        <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-[color:var(--border-subtle)] text-xs text-[color:var(--text-muted)]">
                <th className="px-4 py-2.5 font-medium">Project</th>
                <th className="px-4 py-2.5 font-medium">Teams</th>
                <th className="px-4 py-2.5 font-medium text-right">People</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--border-subtle)]">
              {coverage.map(({ project, teams: handling, people }) => (
                <tr key={project.id}>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs text-[color:var(--text-muted)] mr-1.5">{project.key}</span>
                    {project.name}
                  </td>
                  <td className="px-4 py-2.5">
                    {handling.length === 0 ? (
                      <Chip tone="warn">No team</Chip>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {handling.map((t) => (
                          <TeamChip key={t.id} name={t.name} color={t.color} />
                        ))}
                        {handling.length > 1 && <Chip tone="info">shared</Chip>}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{people}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Link to={`/resources/engagement?project=${project.id}`} className="text-xs text-[color:var(--accent)] hover:underline">
                      Engagement →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState title={teams.length === 0 ? 'No teams yet' : 'No teams match these filters'}>
          {teams.length === 0
            ? canManage
              ? 'Create a team, add its people and pick the projects it handles.'
              : 'Ask someone with team management access to set up teams.'
            : null}
          {teams.length === 0 && canManage && (
            <div className="mt-3">
              <button type="button" className={btnPrimary} onClick={() => setEditing(blankTeam())}>
                <FiPlus /> New team
              </button>
            </div>
          )}
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((t) => (
            <article key={t.id} className="relative overflow-hidden rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] card-shadow p-4 flex flex-col gap-3">
              <span className="absolute inset-x-0 top-0 h-1" style={{ background: teamColor(t.color) }} />
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold truncate">{t.name}</h3>
                  {t.description && <p className="text-xs text-[color:var(--text-muted)] line-clamp-2">{t.description}</p>}
                </div>
                {canManage && (
                  <div className="flex text-[color:var(--text-muted)]">
                    <button type="button" className="p-1.5 rounded hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)]" title="Edit" aria-label={`Edit ${t.name}`} onClick={() => setEditing(draftFromTeam(t))}>
                      <FiEdit2 />
                    </button>
                    <button type="button" className="p-1.5 rounded hover:text-red-400 hover:bg-[color:var(--bg-elevated)]" title="Delete" aria-label={`Delete ${t.name}`} onClick={() => setConfirm(t)}>
                      <FiTrash2 />
                    </button>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                {t.members.length ? <AvatarStack people={t.members} /> : <span className="text-xs text-[color:var(--text-muted)]">No members</span>}
                <span className="text-xs text-[color:var(--text-muted)] inline-flex items-center gap-1">
                  <FiUsers /> {t.members.length}
                </span>
              </div>
              {t.lead && (
                <p className="text-xs text-[color:var(--text-muted)] inline-flex items-center gap-1">
                  <FiStar className="text-amber-400" /> Lead: <span className="text-[color:var(--text-primary)]">{t.lead.name}</span>
                </p>
              )}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[color:var(--text-muted)] mb-1 inline-flex items-center gap-1">
                  <FiFolder /> Projects
                </p>
                {t.projects.length === 0 ? (
                  <p className="text-xs text-[color:var(--text-muted)]">Not assigned to any project</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {t.projects.map((p) => {
                      const sharedWith = teams.filter((o) => o.id !== t.id && o.projects.some((x) => x.id === p.id));
                      return (
                        <Chip key={p.id} tone={sharedWith.length ? 'info' : 'neutral'} title={sharedWith.length ? `Shared with ${sharedWith.map((o) => o.name).join(', ')}` : p.name}>
                          {p.key ?? p.name}
                          {sharedWith.length > 0 && <span className="opacity-70">+{sharedWith.length}</span>}
                        </Chip>
                      );
                    })}
                  </div>
                )}
              </div>
              <Link to={`/resources/engagement?teams=${t.id}`} className="mt-auto pt-2 border-t border-[color:var(--border-subtle)] text-xs text-[color:var(--accent)] hover:underline inline-flex items-center gap-1">
                <FiActivity /> View team engagement
              </Link>
            </article>
          ))}
        </div>
      )}

      {token && (
        <TeamModal
          draft={editing}
          users={options.users}
          projects={options.projects}
          teams={teams}
          token={token}
          onClose={() => setEditing(null)}
          onSaved={(m) => {
            setEditing(null);
            setToast(m);
            load();
          }}
        />
      )}
      <ConfirmModal
        open={!!confirm}
        title="Delete team?"
        message={confirm ? `“${confirm.name}” will be removed. People and projects are not affected.` : ''}
        confirmLabel="Delete"
        onConfirm={() => confirm && void remove(confirm)}
        onCancel={() => setConfirm(null)}
      />
      <Toast message={toast} onDone={() => setToast('')} />
    </PageShell>
  );
}

/* ─── Editor ─────────────────────────────────────────────────────────────── */

interface TeamDraft {
  id?: string;
  name: string;
  description: string;
  color: string;
  leadId: string;
  memberIds: string[];
  projectIds: string[];
}

function blankTeam(): TeamDraft {
  return { name: '', description: '', color: SWATCHES[0], leadId: '', memberIds: [], projectIds: [] };
}

function draftFromTeam(t: ResourceTeamRow): TeamDraft {
  return {
    id: t.id,
    name: t.name,
    description: t.description ?? '',
    color: t.color ?? '',
    leadId: t.lead?.id ?? '',
    memberIds: t.members.map((m) => m.id),
    projectIds: t.projects.map((p) => p.id),
  };
}

function TeamModal({
  draft,
  users,
  projects,
  teams,
  token,
  onClose,
  onSaved,
}: {
  draft: TeamDraft | null;
  users: Array<{ id: string; name: string; email: string; department?: string }>;
  projects: Array<{ id: string; name: string; key: string }>;
  teams: ResourceTeamRow[];
  token: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState<TeamDraft>(blankTeam());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [openFor, setOpenFor] = useState<TeamDraft | null>(null);
  // Reset the form whenever a new draft is opened.
  if (draft && draft !== openFor) {
    setOpenFor(draft);
    setForm(draft);
    setError('');
  }

  const set = <K extends keyof TeamDraft>(k: K, v: TeamDraft[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const body = {
      name: form.name,
      description: form.description,
      color: form.color,
      leadId: form.leadId || null,
      memberIds: form.memberIds,
      projectIds: form.projectIds,
    };
    const res = form.id ? await resourcesApi.updateTeam(form.id, body, token) : await resourcesApi.createTeam(body, token);
    setSaving(false);
    if (!res.success) {
      setError(errorOf(res, 'Failed to save team'));
      return;
    }
    onSaved(form.id ? `Saved ${form.name}.` : `Created ${form.name}.`);
  }

  const leadOptions = users.filter((u) => form.memberIds.includes(u.id));

  return (
    <Modal open={!!draft} onClose={onClose} width="max-w-2xl" title={form.id ? `Edit ${draft?.name ?? 'team'}` : 'New team'} subtitle="People and projects can belong to several teams.">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Name">
            <input required maxLength={80} value={form.name} onChange={(e) => set('name', e.target.value)} className={inputCls} placeholder="e.g. Mobile squad" autoFocus />
          </Field>
          <Field label="Colour">
            <div className="flex items-center gap-1 h-[34px]">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => set('color', c)}
                  aria-label={`Colour ${c}`}
                  className="w-5 h-5 rounded-full grid place-items-center text-white text-[10px]"
                  style={{ background: c, outline: form.color === c ? `2px solid ${c}` : undefined, outlineOffset: 2 }}
                >
                  {form.color === c && <FiCheck />}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <Field label="Description (optional)">
          <input value={form.description} onChange={(e) => set('description', e.target.value)} className={inputCls} placeholder="What this team owns" />
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <MultiPicker
            label="Members"
            items={users.map((u) => ({
              id: u.id,
              label: u.name,
              sub: [u.department, teams.filter((t) => t.id !== form.id && t.members.some((m) => m.id === u.id)).map((t) => t.name).join(', ')]
                .filter(Boolean)
                .join(' · '),
            }))}
            selected={form.memberIds}
            onChange={(ids) => setForm((f) => ({ ...f, memberIds: ids, leadId: ids.includes(f.leadId) ? f.leadId : '' }))}
          />
          <MultiPicker
            label="Projects handled"
            items={projects.map((p) => {
              const others = teams.filter((t) => t.id !== form.id && t.projects.some((x) => x.id === p.id));
              return { id: p.id, label: `${p.key} · ${p.name}`, sub: others.length ? `also ${others.map((t) => t.name).join(', ')}` : '' };
            })}
            selected={form.projectIds}
            onChange={(ids) => set('projectIds', ids)}
          />
        </div>

        <Field label="Team lead (optional)" hint="Pick from the members above.">
          <select value={form.leadId} onChange={(e) => set('leadId', e.target.value)} className={inputCls}>
            <option value="">No lead</option>
            {leadOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={saving} className={`${btnPrimary} px-4 py-2`}>
            {saving ? 'Saving…' : form.id ? 'Save team' : 'Create team'}
          </button>
          <button type="button" className={`${btnSecondary} px-4 py-2`} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Searchable checklist with the selection count; used for members and projects. */
function MultiPicker({
  label,
  items,
  selected,
  onChange,
}: {
  label: string;
  items: Array<{ id: string; label: string; sub?: string }>;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const chosen = new Set(selected);
  const shown = items
    .filter((i) => !q || `${i.label} ${i.sub ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    // Selected first, so it's easy to review what's picked.
    .sort((a, b) => Number(chosen.has(b.id)) - Number(chosen.has(a.id)) || a.label.localeCompare(b.label));
  const toggle = (id: string) => onChange(chosen.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="text-xs space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[color:var(--text-muted)] font-medium">{label}</span>
        <span className="text-[color:var(--text-muted)]">
          {selected.length} selected
          {selected.length > 0 && (
            <button type="button" className="ml-2 text-[color:var(--accent)] hover:underline" onClick={() => onChange([])}>
              Clear
            </button>
          )}
        </span>
      </div>
      <div className="rounded-lg border border-[color:var(--border-subtle)] overflow-hidden">
        <div className="relative border-b border-[color:var(--border-subtle)]">
          <FiSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-full bg-transparent pl-7 pr-2 py-1.5 text-xs focus:outline-none" />
        </div>
        <ul className="max-h-56 overflow-y-auto">
          {shown.length === 0 && <li className="px-3 py-2 text-[color:var(--text-muted)]">Nothing found</li>}
          {shown.map((i) => (
            <li key={i.id}>
              <label className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-[color:var(--bg-elevated)]">
                <input type="checkbox" checked={chosen.has(i.id)} onChange={() => toggle(i.id)} />
                <span className="min-w-0">
                  <span className="block truncate text-[color:var(--text-primary)]">{i.label}</span>
                  {i.sub && <span className="block truncate text-[10px] text-[color:var(--text-muted)]">{i.sub}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
