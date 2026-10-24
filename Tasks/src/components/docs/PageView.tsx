import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FiMaximize2,
  FiMinimize2,
  FiChevronRight,
  FiClock,
  FiCopy,
  FiEdit2,
  FiFileText,
  FiFolder,
  FiHash,
  FiHome,
  FiLink2,
  FiLock,
  FiMessageSquare,
  FiMoreHorizontal,
  FiMove,
  FiPlus,
  FiStar,
  FiTrash2,
  FiUnlock,
} from 'react-icons/fi';
import ConfirmModal from '../ConfirmModal';
import { Avatar, RelativeDate } from '../issues/issueUi';
import { docsApi, type DocPage } from '../../lib/docsApi';
import PageComments from './PageComments';
import { HistoryDrawer, MovePageModal } from './DocsModals';
import { DocContent, IssueChip, PageCover, PageGlyph, SpaceBadge, docLayout, errorText, pagePath, preparePageHtml } from './docsUi';

const ICON_BTN =
  'inline-grid h-8 w-8 place-items-center rounded-lg text-[color:var(--text-muted)] transition hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)]';

function readingMinutes(html: string) {
  const words = html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

export default function PageView({
  page,
  token,
  spaceColor,
  onEdit,
  onChanged,
  onAddChild,
  onTrashed,
  leading,
}: {
  page: DocPage;
  token: string;
  spaceColor?: string;
  onEdit: () => void;
  onChanged: () => void;
  onAddChild: (parentId: string) => void;
  onTrashed: () => void;
  /** Rendered at the start of the top bar (e.g. the "show sidebar" button). */
  leading?: ReactNode;
}) {
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [history, setHistory] = useState(false);
  const [move, setMove] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [starred, setStarred] = useState(page.starred);
  const [notice, setNotice] = useState('');
  const [activeHeading, setActiveHeading] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const isAdmin = page.myRole === 'admin';
  const canEditSpace = page.myRole !== 'viewer';

  useEffect(() => setStarred(page.starred), [page.starred]);

  const { html, outline } = useMemo(() => preparePageHtml(page.content, [...page.issues, ...page.mentionedIssues]), [page.content, page.issues, page.mentionedIssues]);
  const minutes = useMemo(() => readingMinutes(page.content), [page.content]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  useEffect(() => {
    if (!outline.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveHeading(visible[0].target.id);
      },
      { rootMargin: '-60px 0px -70% 0px' }
    );
    outline.forEach((o) => {
      const el = document.getElementById(o.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [outline, html]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(''), 2500);
    return () => window.clearTimeout(t);
  }, [notice]);

  // "e" opens the editor, like Confluence.
  useEffect(() => {
    if (!page.canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== 'e' || e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      onEdit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page.canEdit, onEdit]);

  async function star() {
    const next = !starred;
    setStarred(next);
    const r = await docsApi.starPage(page.id, next, token);
    if (!r.success) setStarred(!next);
  }

  async function act(p: Promise<{ success: boolean; message?: string }>, ok: string) {
    setMenu(false);
    const r = await p;
    setNotice(r.success ? ok : errorText(r));
    if (r.success) onChanged();
  }

  async function trash() {
    setConfirmTrash(false);
    const r = await docsApi.trashPage(page.id, token);
    if (!r.success) return setNotice(errorText(r));
    onTrashed();
  }

  function copyLink() {
    setMenu(false);
    void navigator.clipboard?.writeText(window.location.origin + pagePath(page.space?.key, page.id)).then(() => setNotice('Link copied'));
  }

  const linkedIssues = [...page.issues, ...page.mentionedIssues];
  const layout = docLayout(page.narrow);
  const hasLinks = linkedIssues.length > 0 || page.projects.length > 0;

  return (
    <div className="relative min-h-full">
      {/* Top bar */}
      <div className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/85 px-4 backdrop-blur-md sm:px-6">
        {leading}
        <nav className="flex min-w-0 flex-1 items-center gap-1 text-[13px] text-[color:var(--text-muted)]">
          {page.space && (
            <Link to={`/docs/${page.space.key}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)]">
              <SpaceBadge icon={page.space.icon} name={page.space.name} color={page.space.color} size={18} />
              <span className="hidden sm:inline">{page.space.name}</span>
            </Link>
          )}
          {page.breadcrumbs.map((b) => (
            <span key={b.id} className="inline-flex min-w-0 items-center gap-1">
              <FiChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" />
              <Link to={pagePath(page.space?.key, b.id)} className="max-w-[160px] truncate rounded-md px-1.5 py-1 hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)]">
                {b.emoji ? `${b.emoji} ` : ''}
                {b.title}
              </Link>
            </span>
          ))}
          <span className="inline-flex min-w-0 items-center gap-1">
            <FiChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" />
            <span className="truncate px-1.5 text-[color:var(--text-primary)]">{page.title}</span>
          </span>
        </nav>
        {notice && <span className="hidden text-xs text-[color:var(--text-muted)] animate-fade-in sm:inline">{notice}</span>}
        {page.status === 'draft' && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-500">Draft</span>}
        <button type="button" onClick={star} className={ICON_BTN} title={starred ? 'Unstar' : 'Star'}>
          <FiStar className={`h-4 w-4 ${starred ? 'fill-amber-400 text-amber-400' : ''}`} />
        </button>
        <button type="button" onClick={() => setHistory(true)} className={ICON_BTN} title="Page history">
          <FiClock className="h-4 w-4" />
        </button>
        <button type="button" onClick={copyLink} className={ICON_BTN} title="Copy link">
          <FiLink2 className="h-4 w-4" />
        </button>
        <div className="relative" ref={menuRef}>
          <button type="button" onClick={() => setMenu((v) => !v)} className={ICON_BTN} aria-label="More actions">
            <FiMoreHorizontal className="h-4 w-4" />
          </button>
          {menu && (
            <div className="absolute right-0 top-10 z-30 w-60 overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-modal)] p-1 text-sm shadow-2xl animate-scale-in">
              <MenuItem icon={<FiClock />} label="Page history" onClick={() => (setMenu(false), setHistory(true))} />
              <MenuItem icon={<FiCopy />} label="Copy link" onClick={copyLink} />
              {canEditSpace && <MenuItem icon={<FiPlus />} label="Add child page" onClick={() => (setMenu(false), onAddChild(page.id))} />}
              {page.canEdit && (
                <MenuItem
                  icon={page.narrow ? <FiMaximize2 /> : <FiMinimize2 />}
                  label={page.narrow ? 'Full width' : 'Narrow width'}
                  onClick={() => act(docsApi.updatePage(page.id, { narrow: !page.narrow }, token), page.narrow ? 'Full width' : 'Narrow width')}
                />
              )}
              {page.canEdit && !page.isHome && <MenuItem icon={<FiMove />} label="Move…" onClick={() => (setMenu(false), setMove(true))} />}
              {isAdmin && (
                <MenuItem
                  icon={page.locked ? <FiUnlock /> : <FiLock />}
                  label={page.locked ? 'Unlock editing' : 'Lock editing'}
                  onClick={() => act(docsApi.updatePage(page.id, { locked: !page.locked }, token), page.locked ? 'Page unlocked' : 'Only space admins can edit now')}
                />
              )}
              {isAdmin && !page.isHome && page.status === 'published' && page.space && (
                <MenuItem icon={<FiHome />} label="Make space home" onClick={() => act(docsApi.updateSpace(page.space!.key, { homePageId: page.id }, token), 'Set as space home')} />
              )}
              {page.canEdit && !page.isHome && (
                <>
                  <div className="my-1 h-px bg-[color:var(--border-subtle)]" />
                  <MenuItem icon={<FiTrash2 />} label="Move to trash" danger onClick={() => (setMenu(false), setConfirmTrash(true))} />
                </>
              )}
            </div>
          )}
        </div>
        {page.canEdit && (
          <button type="button" onClick={onEdit} className="btn-primary ml-1 inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm" title="Edit (E)">
            <FiEdit2 className="h-3.5 w-3.5" /> Edit
          </button>
        )}
      </div>

      <PageCover color={spaceColor ?? page.space?.color} compact={!page.emoji} />

      <div className={layout.shell}>
      <div className={layout.grid}>
        <article className={layout.column}>
          {/* Title block — z-index keeps it above the cover gradient; padding avoids ascender clip */}
          <header className={`relative z-[1] ${page.emoji ? '-mt-10' : '-mt-3'}`}>
            {page.emoji && (
              <div className="relative mb-3 grid h-20 w-20 place-items-center rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] text-5xl shadow-lg">
                {page.emoji}
              </div>
            )}
            <h1 className="break-words py-1 text-[2.4rem] font-extrabold leading-[1.2] tracking-tight text-[color:var(--text-primary)]">
              {page.title}
            </h1>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-[color:var(--text-muted)]">
              <span className="inline-flex items-center gap-2">
                <span className="flex -space-x-1.5">
                  <Avatar name={page.createdBy.name ?? page.createdBy.email} size={24} />
                  {page.updatedBy.id !== page.createdBy.id && <Avatar name={page.updatedBy.name ?? page.updatedBy.email} size={24} />}
                </span>
                <span>
                  By <span className="font-medium text-[color:var(--text-primary)]">{page.createdBy.name ?? 'Someone'}</span>
                  {page.updatedBy.id !== page.createdBy.id && (
                    <>
                      {' '}
                      · edited by <span className="font-medium text-[color:var(--text-primary)]">{page.updatedBy.name ?? 'Someone'}</span>
                    </>
                  )}
                </span>
              </span>
              <span className="inline-flex items-center gap-1">
                <FiClock className="h-3.5 w-3.5" /> <RelativeDate value={page.updatedAt} />
              </span>
              <span className="inline-flex items-center gap-1">
                <FiFileText className="h-3.5 w-3.5" /> {minutes} min read
              </span>
              <button type="button" onClick={() => setHistory(true)} className="rounded-md bg-[color:var(--bg-elevated)] px-1.5 py-0.5 text-[11px] font-medium hover:text-[color:var(--accent)]">
                v{page.version}
              </button>
              {page.commentCount > 0 && (
                <a href="#comments" className="inline-flex items-center gap-1 hover:text-[color:var(--accent)]">
                  <FiMessageSquare className="h-3.5 w-3.5" /> {page.commentCount}
                </a>
              )}
              {page.locked && (
                <span className="inline-flex items-center gap-1 text-amber-500">
                  <FiLock className="h-3.5 w-3.5" /> Locked
                </span>
              )}
            </div>
            {page.labels.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {page.labels.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => navigate(`/docs?label=${encodeURIComponent(l)}`)}
                    className="inline-flex items-center gap-0.5 rounded-full border border-[color:var(--border-subtle)] px-2.5 py-0.5 text-[11px] text-[color:var(--text-muted)] transition hover:border-[color:var(--accent)]/50 hover:text-[color:var(--accent)]"
                  >
                    <FiHash className="h-3 w-3" />
                    {l}
                  </button>
                ))}
              </div>
            )}
          </header>

          {page.status === 'draft' && (
            <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-[13px] text-amber-600 dark:text-amber-400">
              This is a draft — only you can see it.{' '}
              {page.canEdit && (
                <button type="button" onClick={onEdit} className="font-semibold underline-offset-2 hover:underline">
                  Open the editor to publish
                </button>
              )}
            </div>
          )}

          {hasLinks && (
            <section className="mt-6 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]/60 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                <FiLink2 /> Linked work
              </p>
              <div className="flex flex-wrap gap-1.5">
                {page.projects.map((p) => (
                  <Link
                    key={p.id}
                    to={`/projects/${p.id}/docs`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-2 py-1 text-[12px] transition hover:border-[color:var(--accent)]/50"
                  >
                    <FiFolder className="h-3.5 w-3.5 text-[color:var(--text-muted)]" />
                    <span className="font-mono text-[11px] font-semibold">{p.key}</span>
                    <span className="max-w-[160px] truncate">{p.name}</span>
                  </Link>
                ))}
                {linkedIssues.map((i) => (
                  <IssueChip key={i.id} issue={i} />
                ))}
              </div>
            </section>
          )}

          <div className="mt-8">
            {page.content.trim() ? (
              <DocContent html={html} />
            ) : (
              <button
                type="button"
                disabled={!page.canEdit}
                onClick={onEdit}
                className="w-full rounded-2xl border-2 border-dashed border-[color:var(--border-subtle)] px-6 py-14 text-center transition enabled:hover:border-[color:var(--accent)]/50 enabled:hover:bg-[color:var(--accent-subtle)]"
              >
                <FiEdit2 className="mx-auto h-6 w-6 text-[color:var(--text-muted)]" />
                <p className="mt-2 font-medium">This page is empty</p>
                {page.canEdit && <p className="mt-1 text-sm text-[color:var(--text-muted)]">Click to start writing, or press E</p>}
              </button>
            )}
          </div>

          {(page.children.length > 0 || canEditSpace) && (
            <section className="mt-14">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                  Child pages {page.children.length > 0 && <span className="ml-1 font-normal">{page.children.length}</span>}
                </h2>
                {canEditSpace && (
                  <button type="button" onClick={() => onAddChild(page.id)} className="inline-flex items-center gap-1 text-xs text-[color:var(--text-muted)] hover:text-[color:var(--accent)]">
                    <FiPlus /> Add
                  </button>
                )}
              </div>
              {page.children.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {page.children.map((c) => (
                    <Link
                      key={c.id}
                      to={pagePath(page.space?.key, c.id)}
                      className="group flex items-center gap-3 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3.5 py-3 transition hover:-translate-y-px hover:border-[color:var(--accent)]/40 hover:shadow-md"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[color:var(--bg-elevated)]">
                        <PageGlyph emoji={c.emoji} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium group-hover:text-[color:var(--accent)]">{c.title}</span>
                        <span className="text-[11px] text-[color:var(--text-muted)]">
                          <RelativeDate value={c.updatedAt} />
                        </span>
                      </span>
                      <FiChevronRight className="text-[color:var(--text-muted)] opacity-0 transition group-hover:opacity-100" />
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[color:var(--text-muted)]">No child pages yet.</p>
              )}
            </section>
          )}

          <PageComments pageId={page.id} token={token} canModerate={isAdmin} />
        </article>

        <aside className={layout.rail}>
          <div className="sticky top-20 space-y-6 pt-10">
            {outline.length > 1 && (
              <section>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">On this page</p>
                <ul className="space-y-0.5 border-l-2 border-[color:var(--border-subtle)]">
                  {outline.map((o) => (
                    <li key={o.id}>
                      <a
                        href={`#${o.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          document.getElementById(o.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }}
                        className={`-ml-0.5 block truncate border-l-2 py-1 text-[12px] transition ${
                          activeHeading === o.id
                            ? 'border-[color:var(--accent)] font-medium text-[color:var(--accent)]'
                            : 'border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
                        }`}
                        style={{ paddingLeft: 12 + (o.level - 1) * 12 }}
                        title={o.text}
                      >
                        {o.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className="rounded-xl border border-[color:var(--border-subtle)] p-3 text-[12px] text-[color:var(--text-muted)] space-y-1.5">
              <p className="flex justify-between">
                <span>Created</span>
                <RelativeDate value={page.createdAt} />
              </p>
              <p className="flex justify-between">
                <span>Updated</span>
                <RelativeDate value={page.updatedAt} />
              </p>
              <p className="flex justify-between">
                <span>Version</span>
                <span className="text-[color:var(--text-primary)]">{page.version}</span>
              </p>
              <p className="flex justify-between">
                <span>Your access</span>
                <span className="text-[color:var(--text-primary)]">{page.canEdit ? 'Can edit' : 'Can view'}</span>
              </p>
            </section>
          </div>
        </aside>
      </div>
      </div>

      <HistoryDrawer open={history} onClose={() => setHistory(false)} token={token} pageId={page.id} currentVersion={page.version} canRestore={page.canEdit} onRestored={onChanged} />
      {page.space && (
        <MovePageModal
          open={move}
          onClose={() => setMove(false)}
          token={token}
          pageId={page.id}
          pageTitle={page.title}
          currentSpaceKey={page.space.key}
          onMoved={(key) => {
            if (key !== page.space?.key) navigate(pagePath(key, page.id));
            onChanged();
          }}
        />
      )}
      <ConfirmModal
        open={confirmTrash}
        title="Move this page to the trash?"
        message={page.children.length ? 'Its child pages go to the trash with it. You can restore them from the space trash.' : 'You can restore it from the space trash.'}
        confirmLabel="Move to trash"
        variant="danger"
        onConfirm={trash}
        onCancel={() => setConfirmTrash(false)}
      />
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-[color:var(--bg-elevated)] ${danger ? 'text-red-400' : ''}`}
    >
      <span className={danger ? '' : 'text-[color:var(--text-muted)]'}>{icon}</span>
      {label}
    </button>
  );
}
