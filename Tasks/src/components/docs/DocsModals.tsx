import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { FiClock, FiRotateCcw, FiSearch, FiTrash2, FiX } from 'react-icons/fi';
import { Field, Modal, btnPrimary, btnSecondary, inputCls } from '../../pages/resources/resourceKit';
import { PersonSelect, toPeople } from '../people';
import ConfirmModal from '../ConfirmModal';
import { RelativeDate } from '../issues/issueUi';
import {
  docsApi,
  type DocIssueRef,
  type DocSpace,
  type DocSpaceAudience,
  type DocSpaceInput,
  type DocSpaceRole,
  type DocTrashItem,
  type DocVersion,
} from '../../lib/docsApi';
import { docTemplates } from './docTemplates';
import { DocContent, PersonLine, ROLE_LABEL, SPACE_COLORS, buildTree, errorText, pagePath, useDocsOptions, type TreeItem } from './docsUi';

// ── Create page ─────────────────────────────────────────────────────────────

export function CreatePageModal({
  open,
  onClose,
  token,
  spaceId,
  parentId,
  issueIds,
  projectIds,
  defaultTitle,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  token: string;
  /** Fixed space; when absent the user picks one. */
  spaceId?: string;
  parentId?: string | null;
  issueIds?: string[];
  projectIds?: string[];
  defaultTitle?: string;
  onCreated?: () => void;
}) {
  const navigate = useNavigate();
  const templates = useMemo(() => docTemplates(), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const [spaces, setSpaces] = useState<DocSpace[]>([]);
  const [space, setSpace] = useState(spaceId ?? '');
  const [templateId, setTemplateId] = useState('blank');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setTemplateId('blank');
    setError('');
    setSpace(spaceId ?? '');
    if (spaceId) return;
    docsApi.listSpaces(token, projectIds?.length === 1 ? { projectId: projectIds[0] } : {}).then(async (r) => {
      let list = (r.data ?? []).filter((s) => s.myRole !== 'viewer');
      // Fall back to every editable space when the project has none of its own.
      if (!list.length && projectIds?.length) list = ((await docsApi.listSpaces(token)).data ?? []).filter((s) => s.myRole !== 'viewer');
      setSpaces(list);
      setSpace((cur) => cur || list[0]?.id || '');
    });
  }, [open, spaceId, token, projectIds]);

  async function create() {
    const t = templates.find((x) => x.id === templateId)!;
    if (!space) return setError('Choose a space');
    setBusy(true);
    const res = await docsApi.createPage(
      {
        spaceId: space,
        parentId: parentId ?? null,
        title: defaultTitle && t.id === 'blank' ? defaultTitle : t.title.trim() || 'Untitled',
        emoji: t.emoji || undefined,
        content: t.content,
        labels: t.labels,
        issueIds,
        projectIds,
        status: 'draft',
      },
      token
    );
    setBusy(false);
    if (!res.success || !res.data) return setError(errorText(res, 'Could not create the page'));
    onCreated?.();
    onClose();
    navigate(pagePath(res.data.space?.key, res.data.id, true));
  }

  return (
    <Modal open={open} onClose={onClose} title="Create a page" subtitle="Pick a template. New pages start as a draft only you can see until you publish." width="max-w-3xl">
      {!spaceId && (
        <Field label="Space" className="mb-4">
          {spaces.length ? (
            <select className={inputCls} value={space} onChange={(e) => setSpace(e.target.value)}>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.icon ? `${s.icon} ` : ''}
                  {s.name} ({s.key})
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-[color:var(--text-muted)]">You don’t have edit access to any space yet. Ask a docs admin to create one or add you.</p>
          )}
        </Field>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 max-h-[52vh] overflow-y-auto pr-1">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTemplateId(t.id)}
            onDoubleClick={() => {
              setTemplateId(t.id);
              void create();
            }}
            className={`text-left rounded-xl border p-3 transition ${
              templateId === t.id
                ? 'border-[color:var(--accent)] bg-[color:var(--accent-subtle)]'
                : 'border-[color:var(--border-subtle)] hover:border-[color:var(--accent)]/50'
            }`}
          >
            <div className="text-xl h-7">{t.emoji || '📄'}</div>
            <p className="font-medium text-sm mt-1">{t.name}</p>
            <p className="text-xs text-[color:var(--text-muted)] mt-0.5">{t.description}</p>
          </button>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={btnPrimary} disabled={busy || !space} onClick={create}>
          {busy ? 'Creating…' : 'Create'}
        </button>
      </div>
    </Modal>
  );
}

// ── Space settings ──────────────────────────────────────────────────────────

const AUDIENCE: Array<{ value: DocSpaceAudience; label: string; hint: string }> = [
  { value: 'workspace', label: 'Everyone in the workspace', hint: 'Good for company-wide knowledge.' },
  { value: 'project', label: 'Members of linked projects', hint: 'Follows project membership automatically.' },
  { value: 'restricted', label: 'Only people listed below', hint: 'Private to the members you add.' },
];

function suggestKey(name: string) {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  const key = words.length > 1 ? words.map((w) => w[0]).join('') : words[0] ?? '';
  return key.replace(/^[0-9]+/, '').slice(0, 10);
}

export function SpaceSettingsModal({
  open,
  onClose,
  token,
  space,
  defaults,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  token: string;
  /** Existing space to edit; omit to create one. */
  space?: DocSpace | null;
  defaults?: Partial<DocSpaceInput>;
  onSaved: (s: DocSpace) => void;
  onDeleted?: () => void;
}) {
  const options = useDocsOptions(token);
  const [form, setForm] = useState<Required<Pick<DocSpaceInput, 'key' | 'name' | 'description' | 'icon' | 'color' | 'audience' | 'audienceRole'>> & {
    projectIds: string[];
    members: Array<{ userId: string; role: DocSpaceRole }>;
  }>(blank());
  const [keyTouched, setKeyTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addPerson, setAddPerson] = useState('');

  function blank() {
    return {
      key: '',
      name: '',
      description: '',
      icon: '',
      color: SPACE_COLORS[0],
      audience: 'workspace' as DocSpaceAudience,
      audienceRole: 'editor' as const,
      projectIds: [] as string[],
      members: [] as Array<{ userId: string; role: DocSpaceRole }>,
    };
  }

  useEffect(() => {
    if (!open) return;
    setError('');
    setKeyTouched(Boolean(space));
    if (space) {
      setForm({
        key: space.key,
        name: space.name,
        description: space.description ?? '',
        icon: space.icon ?? '',
        color: space.color ?? SPACE_COLORS[0],
        audience: space.audience,
        audienceRole: space.audienceRole,
        projectIds: space.projects.map((p) => p.id),
        members: space.members.map((m) => ({ userId: m.id, role: m.role })),
      });
    } else {
      setForm({ ...blank(), ...(defaults as object), projectIds: defaults?.projectIds ?? [], members: [] });
      if (defaults?.key) setKeyTouched(true);
    }
  }, [open, space, defaults]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const peopleById = useMemo(() => new Map(options.people.map((p) => [p.id, p])), [options.people]);

  async function save() {
    setBusy(true);
    setError('');
    const body: DocSpaceInput = { ...form };
    const res = space ? await docsApi.updateSpace(space.key, body, token) : await docsApi.createSpace(body, token);
    setBusy(false);
    if (!res.success || !res.data) return setError(errorText(res, 'Could not save the space'));
    onSaved(res.data);
    onClose();
  }

  async function toggleArchive() {
    if (!space) return;
    const res = await docsApi.updateSpace(space.key, { archived: !space.archived }, token);
    if (res.success && res.data) {
      onSaved(res.data);
      onClose();
    } else setError(errorText(res));
  }

  async function remove() {
    if (!space) return;
    setConfirmDelete(false);
    const res = await docsApi.deleteSpace(space.key, token);
    if (res.success) {
      onClose();
      onDeleted?.();
    } else setError(errorText(res));
  }

  return (
    <Modal open={open} onClose={onClose} title={space ? 'Space settings' : 'Create a space'} subtitle={space ? `${space.name} · ${space.key}` : 'A space holds a tree of pages for a team, project or topic.'} width="max-w-2xl">
      <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
        <div className="flex gap-3">
          <Field label="Icon" className="w-20">
            <input className={`${inputCls} text-center`} maxLength={4} placeholder="📚" value={form.icon} onChange={(e) => set('icon', e.target.value)} />
          </Field>
          <Field label="Name" className="flex-1">
            <input
              className={inputCls}
              autoFocus
              value={form.name}
              onChange={(e) => {
                set('name', e.target.value);
                if (!keyTouched) set('key', suggestKey(e.target.value));
              }}
              placeholder="Engineering handbook"
            />
          </Field>
          <Field label="Key" className="w-32" hint="Used in links">
            <input
              className={`${inputCls} font-mono uppercase`}
              value={form.key}
              maxLength={10}
              onChange={(e) => {
                setKeyTouched(true);
                set('key', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
              }}
            />
          </Field>
        </div>
        <Field label="Description">
          <textarea className={inputCls} rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="What lives in this space?" />
        </Field>
        <Field label="Colour">
          <div className="flex flex-wrap gap-1.5">
            {SPACE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => set('color', c)}
                className={`h-7 w-7 rounded-lg ring-offset-2 ring-offset-[color:var(--bg-modal)] ${form.color === c ? 'ring-2 ring-[color:var(--accent)]' : ''}`}
                style={{ background: c }}
                aria-label={c}
              />
            ))}
          </div>
        </Field>
        <Field label="Linked projects" hint="Pages in this space show up on these projects’ Docs tab.">
          <div className="flex flex-wrap gap-1.5">
            {options.projects.map((p) => {
              const on = form.projectIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => set('projectIds', on ? form.projectIds.filter((x) => x !== p.id) : [...form.projectIds, p.id])}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${
                    on ? 'border-[color:var(--accent)] bg-[color:var(--accent-subtle)] text-[color:var(--accent)]' : 'border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:border-[color:var(--accent)]/50'
                  }`}
                >
                  <span className="font-mono">{p.key}</span> {p.name}
                </button>
              );
            })}
            {!options.projects.length && <span className="text-xs text-[color:var(--text-muted)]">No projects available.</span>}
          </div>
        </Field>
        <div className="rounded-xl border border-[color:var(--border-subtle)] p-3 space-y-3">
          <p className="text-xs font-semibold">Who can open this space</p>
          <div className="space-y-1.5">
            {AUDIENCE.map((a) => (
              <label key={a.value} className="flex items-start gap-2 text-sm cursor-pointer">
                <input type="radio" className="mt-1" checked={form.audience === a.value} onChange={() => set('audience', a.value)} />
                <span>
                  {a.label}
                  <span className="block text-[11px] text-[color:var(--text-muted)]">{a.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {form.audience !== 'restricted' && (
            <Field label="They can">
              <select className={inputCls} value={form.audienceRole} onChange={(e) => set('audienceRole', e.target.value as 'editor' | 'viewer')}>
                <option value="editor">Create and edit pages</option>
                <option value="viewer">Only read pages</option>
              </select>
            </Field>
          )}
          <div>
            <p className="text-xs text-[color:var(--text-muted)] font-medium mb-1.5">Members</p>
            <ul className="space-y-1.5">
              {form.members.map((m) => (
                <li key={m.userId} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">{peopleById.get(m.userId)?.name ?? 'Former member'}</span>
                  <select
                    className={`${inputCls} !w-36 !py-1`}
                    value={m.role}
                    onChange={(e) => set('members', form.members.map((x) => (x.userId === m.userId ? { ...x, role: e.target.value as DocSpaceRole } : x)))}
                  >
                    {(['admin', 'editor', 'viewer'] as const).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="p-1 text-[color:var(--text-muted)] hover:text-red-400" onClick={() => set('members', form.members.filter((x) => x.userId !== m.userId))} aria-label="Remove">
                    <FiX />
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2">
              <PersonSelect
                value={addPerson}
                people={toPeople(options.people.filter((p) => !form.members.some((m) => m.userId === p.id)))}
                placeholder="Add a person…"
                onChange={(v) => {
                  if (v) set('members', [...form.members, { userId: v, role: 'editor' }]);
                  setAddPerson('');
                }}
              />
            </div>
            {!space && <p className="mt-1.5 text-[11px] text-[color:var(--text-muted)]">You’ll be added as an admin.</p>}
          </div>
        </div>
        {space && (
          <div className="flex flex-wrap gap-2 border-t border-[color:var(--border-subtle)] pt-4">
            <button type="button" className={btnSecondary} onClick={toggleArchive}>
              {space.archived ? 'Restore space' : 'Archive space'}
            </button>
            <button type="button" className={`${btnSecondary} !text-red-400 hover:!border-red-400/60`} onClick={() => setConfirmDelete(true)}>
              <FiTrash2 /> Delete space
            </button>
          </div>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={btnPrimary} disabled={busy || !form.name.trim() || form.key.length < 2} onClick={save}>
          {busy ? 'Saving…' : space ? 'Save' : 'Create space'}
        </button>
      </div>
      <ConfirmModal
        open={confirmDelete}
        title="Delete this space?"
        message={`All pages, history and comments in ${space?.name ?? 'the space'} will be removed for good.`}
        confirmLabel="Delete space"
        variant="danger"
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </Modal>
  );
}

// ── Move page ───────────────────────────────────────────────────────────────

export function MovePageModal({
  open,
  onClose,
  token,
  pageId,
  pageTitle,
  currentSpaceKey,
  onMoved,
}: {
  open: boolean;
  onClose: () => void;
  token: string;
  pageId: string;
  pageTitle: string;
  currentSpaceKey: string;
  onMoved: (spaceKey: string) => void;
}) {
  const [spaces, setSpaces] = useState<DocSpace[]>([]);
  const [spaceKey, setSpaceKey] = useState(currentSpaceKey);
  const [tree, setTree] = useState<TreeItem[]>([]);
  const [parentId, setParentId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setSpaceKey(currentSpaceKey);
    setParentId(null);
    setError('');
    docsApi.listSpaces(token).then((r) => setSpaces((r.data ?? []).filter((s) => s.myRole !== 'viewer')));
  }, [open, token, currentSpaceKey]);

  useEffect(() => {
    if (!open || !spaceKey) return;
    docsApi.tree(spaceKey, token).then((r) => setTree(buildTree(r.data ?? [])));
  }, [open, spaceKey, token]);

  async function move() {
    const space = spaces.find((s) => s.key === spaceKey);
    const res = await docsApi.movePage(pageId, { parentId, spaceId: space?.id }, token);
    if (!res.success) return setError(errorText(res, 'Could not move the page'));
    onMoved(spaceKey);
    onClose();
  }

  const renderNodes = (nodes: TreeItem[], depth: number): ReactElement[] =>
    nodes
      .filter((n) => n.id !== pageId)
      .flatMap((n) => [
        <button
          key={n.id}
          type="button"
          onClick={() => setParentId(n.id)}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm ${parentId === n.id ? 'bg-[color:var(--accent-subtle)] text-[color:var(--accent)]' : 'hover:bg-[color:var(--bg-elevated)]'}`}
          style={{ paddingLeft: 8 + depth * 16 }}
        >
          <span className="w-4 text-center">{n.emoji || '·'}</span>
          <span className="truncate">{n.title}</span>
        </button>,
        ...renderNodes(n.children, depth + 1),
      ]);

  return (
    <Modal open={open} onClose={onClose} title="Move page" subtitle={`“${pageTitle}” and its child pages`}>
      <Field label="Space">
        <select className={inputCls} value={spaceKey} onChange={(e) => (setSpaceKey(e.target.value), setParentId(null))}>
          {spaces.map((s) => (
            <option key={s.id} value={s.key}>
              {s.name} ({s.key})
            </option>
          ))}
        </select>
      </Field>
      <p className="mt-4 mb-1.5 text-xs font-medium text-[color:var(--text-muted)]">Place under</p>
      <div className="max-h-72 overflow-y-auto rounded-xl border border-[color:var(--border-subtle)] p-1.5">
        <button
          type="button"
          onClick={() => setParentId(null)}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm ${parentId === null ? 'bg-[color:var(--accent-subtle)] text-[color:var(--accent)]' : 'hover:bg-[color:var(--bg-elevated)]'}`}
        >
          Top level of the space
        </button>
        {renderNodes(tree, 0)}
      </div>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={btnPrimary} onClick={move}>
          Move
        </button>
      </div>
    </Modal>
  );
}

// ── History drawer ──────────────────────────────────────────────────────────

export function HistoryDrawer({
  open,
  onClose,
  token,
  pageId,
  currentVersion,
  canRestore,
  onRestored,
}: {
  open: boolean;
  onClose: () => void;
  token: string;
  pageId: string;
  currentVersion: number;
  canRestore: boolean;
  onRestored: () => void;
}) {
  const [versions, setVersions] = useState<DocVersion[]>([]);
  const [selected, setSelected] = useState<DocVersion | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setError('');
    docsApi.versions(pageId, token).then((r) => setVersions(r.data ?? []));
  }, [open, pageId, token, currentVersion]);

  async function pick(v: DocVersion) {
    const r = await docsApi.version(pageId, v.version, token);
    if (r.success && r.data) setSelected(r.data);
  }

  async function restore(v: number) {
    const r = await docsApi.restoreVersion(pageId, v, token);
    if (!r.success) return setError(errorText(r, 'Could not restore'));
    onRestored();
    onClose();
  }

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[2px]" onClick={onClose}>
      <aside className="flex h-full w-full max-w-4xl bg-[color:var(--bg-modal)] border-l border-[color:var(--border-subtle)] shadow-2xl animate-fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="w-72 shrink-0 border-r border-[color:var(--border-subtle)] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--border-subtle)]">
            <p className="font-semibold text-sm inline-flex items-center gap-2">
              <FiClock /> Page history
            </p>
            <button type="button" onClick={onClose} className="p-1 text-[color:var(--text-muted)]" aria-label="Close">
              <FiX />
            </button>
          </div>
          <ul className="flex-1 overflow-y-auto p-2 space-y-1">
            {versions.map((v) => (
              <li key={v.version}>
                <button
                  type="button"
                  onClick={() => pick(v)}
                  className={`w-full rounded-lg px-3 py-2 text-left ${selected?.version === v.version ? 'bg-[color:var(--accent-subtle)]' : 'hover:bg-[color:var(--bg-elevated)]'}`}
                >
                  <p className="text-sm font-medium">
                    v{v.version}
                    {v.version === currentVersion && <span className="ml-2 rounded bg-emerald-500/15 px-1.5 text-[10px] text-emerald-500">current</span>}
                  </p>
                  <p className="text-[11px] text-[color:var(--text-muted)]">
                    {v.author.name ?? 'Someone'} · <RelativeDate value={v.createdAt} />
                  </p>
                  {v.message && <p className="mt-0.5 text-[11px] italic text-[color:var(--text-muted)] line-clamp-2">{v.message}</p>}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          {selected ? (
            <>
              <div className="flex items-center justify-between gap-3 px-6 py-3 border-b border-[color:var(--border-subtle)]">
                <PersonLine person={selected.author} prefix={`Version ${selected.version} by`} at={selected.createdAt} />
                {canRestore && selected.version !== currentVersion && (
                  <button type="button" className={btnPrimary} onClick={() => restore(selected.version)}>
                    <FiRotateCcw /> Restore this version
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto px-8 py-6">
                <h1 className="text-2xl font-bold mb-4">{selected.title}</h1>
                <DocContent html={selected.content ?? ''} />
              </div>
            </>
          ) : (
            <div className="flex-1 grid place-items-center text-sm text-[color:var(--text-muted)]">Pick a version to preview it.</div>
          )}
          {error && <p className="px-6 pb-3 text-sm text-red-400">{error}</p>}
        </div>
      </aside>
    </div>,
    document.body
  );
}

// ── Trash ───────────────────────────────────────────────────────────────────

export function TrashModal({
  open,
  onClose,
  token,
  spaceKey,
  isAdmin,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  token: string;
  spaceKey: string;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<DocTrashItem[]>([]);
  const [error, setError] = useState('');
  const load = () => docsApi.trash(spaceKey, token).then((r) => setItems(r.data ?? []));
  useEffect(() => {
    if (open) void load();
  }, [open, spaceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(id: string, kind: 'restore' | 'purge') {
    const r = kind === 'restore' ? await docsApi.restorePage(id, token) : await docsApi.purgePage(id, token);
    if (!r.success) return setError(errorText(r));
    setError('');
    await load();
    onChanged();
  }

  return (
    <Modal open={open} onClose={onClose} title="Trash" subtitle="Deleted pages stay here until a space admin removes them for good." width="max-w-xl">
      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-[color:var(--text-muted)]">The trash is empty.</p>
      ) : (
        <ul className="divide-y divide-[color:var(--border-subtle)]">
          {items.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2.5">
              <span className="w-5 text-center">{p.emoji || '📄'}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.title}</p>
                <p className="text-[11px] text-[color:var(--text-muted)]">
                  {p.deletedBy?.name ?? 'Someone'} · <RelativeDate value={p.deletedAt} />
                  {p.childCount > 0 && ` · with ${p.childCount} child page${p.childCount === 1 ? '' : 's'}`}
                </p>
              </div>
              <button type="button" className={btnSecondary} onClick={() => act(p.id, 'restore')}>
                <FiRotateCcw /> Restore
              </button>
              {isAdmin && (
                <button type="button" className="p-2 text-[color:var(--text-muted)] hover:text-red-400" title="Delete for good" onClick={() => act(p.id, 'purge')}>
                  <FiTrash2 />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </Modal>
  );
}

// ── Issue picker ────────────────────────────────────────────────────────────

/** Search-as-you-type picker for linking issues to a page. */
export function IssuePicker({ token, exclude, onPick }: { token: string; exclude: string[]; onPick: (issue: DocIssueRef) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<DocIssueRef[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      docsApi.lookupIssues({ q }, token).then((r) => setResults(r.data ?? []));
    }, 200);
    return () => window.clearTimeout(t);
  }, [q, open, token]);
  const shown = results.filter((r) => !exclude.includes(r.id));
  return (
    <div className="relative">
      <div className="relative">
        <FiSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[color:var(--text-muted)]" />
        <input
          className={`${inputCls} !pl-8 !py-1.5`}
          placeholder="Link an issue by key or title…"
          value={q}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {open && shown.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-modal)] p-1 shadow-xl">
          {shown.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(i);
                  setQ('');
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[color:var(--bg-elevated)]"
              >
                <span className="shrink-0 font-mono text-xs text-[color:var(--accent)]">{i.key}</span>
                <span className="min-w-0 flex-1 truncate">{i.title}</span>
                {i.status && <span className="shrink-0 text-[11px] text-[color:var(--text-muted)]">{i.status}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

