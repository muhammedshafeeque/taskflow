import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FiChevronRight,
  FiClock,
  FiCopy,
  FiEdit2,
  FiFolder,
  FiHash,
  FiHome,
  FiLink2,
  FiLock,
  FiMoreHorizontal,
  FiMove,
  FiPlus,
  FiStar,
  FiTrash2,
  FiUnlock,
} from 'react-icons/fi';
import ConfirmModal from '../ConfirmModal';
import { btnPrimary, btnSecondary } from '../../pages/resources/resourceKit';
import { docsApi, type DocIssueRef, type DocPage } from '../../lib/docsApi';
import PageComments from './PageComments';
import { HistoryDrawer, MovePageModal } from './DocsModals';
import { DocContent, PageGlyph, PersonLine, SpaceBadge, errorText, pagePath, preparePageHtml } from './docsUi';

function IssueRow({ issue }: { issue: DocIssueRef }) {
  const href = issue.projectId && issue.key ? `/projects/${issue.projectId}/issues/${encodeURIComponent(issue.key)}` : undefined;
  const body = (
    <>
      <span className="shrink-0 font-mono text-[11px] text-[color:var(--accent)]">{issue.key}</span>
      <span className="min-w-0 flex-1 truncate">{issue.hidden ? <span className="italic text-[color:var(--text-muted)]">Not on this project</span> : issue.title}</span>
      {issue.status && <span className="shrink-0 rounded bg-[color:var(--bg-elevated)] px-1.5 text-[10px] text-[color:var(--text-muted)]">{issue.status}</span>}
    </>
  );
  return href && !issue.hidden ? (
    <Link to={href} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-[color:var(--bg-elevated)]">
      {body}
    </Link>
  ) : (
    <div className="flex items-center gap-2 px-2 py-1.5 text-xs">{body}</div>
  );
}

export default function PageView({
  page,
  token,
  onEdit,
  onChanged,
  onAddChild,
  onTrashed,
}: {
  page: DocPage;
  token: string;
  onEdit: () => void;
  /** Reload the page (and tree) after a change made from here. */
  onChanged: () => void;
  onAddChild: (parentId: string) => void;
  onTrashed: () => void;
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

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  // Highlight the outline entry for the section being read.
  useEffect(() => {
    if (!outline.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveHeading(visible[0].target.id);
      },
      { rootMargin: '0px 0px -70% 0px' }
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

  const hasRail = outline.length > 1 || page.issues.length > 0 || page.mentionedIssues.length > 0 || page.projects.length > 0;

  return (
    <div className="pb-16">
      {/* Breadcrumbs + actions */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-xs text-[color:var(--text-muted)]">
          {page.space && (
            <Link to={`/docs/${page.space.key}`} className="inline-flex items-center gap-1.5 hover:text-[color:var(--accent)]">
              <SpaceBadge icon={page.space.icon} name={page.space.name} color={page.space.color} size={16} />
              {page.space.name}
            </Link>
          )}
          {page.breadcrumbs.map((b) => (
            <span key={b.id} className="inline-flex items-center gap-1">
              <FiChevronRight className="h-3 w-3" />
              <Link to={pagePath(page.space?.key, b.id)} className="max-w-[180px] truncate hover:text-[color:var(--accent)]">
                {b.emoji ? `${b.emoji} ` : ''}
                {b.title}
              </Link>
            </span>
          ))}
        </nav>
        <div className="flex items-center gap-1.5">
          {notice && <span className="mr-2 text-xs text-[color:var(--text-muted)] animate-fade-in">{notice}</span>}
          <button type="button" onClick={star} className={`${btnSecondary} !px-2`} title={starred ? 'Unstar' : 'Star'}>
            <FiStar className={starred ? 'fill-amber-400 text-amber-400' : ''} />
          </button>
          <button type="button" onClick={copyLink} className={`${btnSecondary} !px-2`} title="Copy link">
            <FiLink2 />
          </button>
          {page.canEdit && (
            <button type="button" onClick={onEdit} className={btnPrimary}>
              <FiEdit2 /> Edit
            </button>
          )}
          <div className="relative" ref={menuRef}>
            <button type="button" onClick={() => setMenu((v) => !v)} className={`${btnSecondary} !px-2`} aria-label="More actions">
              <FiMoreHorizontal />
            </button>
            {menu && (
              <div className="absolute right-0 top-10 z-30 w-56 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-modal)] p-1 shadow-xl text-sm">
                <MenuItem icon={<FiClock />} label="Page history" onClick={() => (setMenu(false), setHistory(true))} />
                <MenuItem icon={<FiCopy />} label="Copy link" onClick={copyLink} />
                {canEditSpace && <MenuItem icon={<FiPlus />} label="Add child page" onClick={() => (setMenu(false), onAddChild(page.id))} />}
                {page.canEdit && !page.isHome && <MenuItem icon={<FiMove />} label="Move" onClick={() => (setMenu(false), setMove(true))} />}
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
        </div>
      </div>

      <div className={`grid gap-10 ${hasRail ? 'xl:grid-cols-[minmax(0,1fr)_240px]' : ''}`}>
        <article className="min-w-0 max-w-4xl">
          <header className="mb-6">
            {page.emoji && <div className="mb-2 text-5xl leading-none">{page.emoji}</div>}
            <h1 className="text-3xl font-bold tracking-tight">{page.title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <PersonLine person={page.createdBy} prefix="Created by" />
              <PersonLine person={page.updatedBy} prefix="Last updated by" at={page.updatedAt} />
              <button type="button" className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--accent)]" onClick={() => setHistory(true)}>
                v{page.version}
              </button>
              {page.status === 'draft' && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-500">Draft · only you can see this</span>}
              {page.locked && (
                <span className="inline-flex items-center gap-1 rounded bg-[color:var(--bg-elevated)] px-1.5 py-0.5 text-[11px] text-[color:var(--text-muted)]">
                  <FiLock className="h-3 w-3" /> Locked
                </span>
              )}
              {page.commentCount > 0 && (
                <a href="#comments" className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--accent)]">
                  {page.commentCount} comment{page.commentCount === 1 ? '' : 's'}
                </a>
              )}
            </div>
            {page.labels.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {page.labels.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => navigate(`/docs?label=${encodeURIComponent(l)}`)}
                    className="inline-flex items-center gap-0.5 rounded-full bg-[color:var(--bg-elevated)] px-2 py-0.5 text-[11px] text-[color:var(--text-muted)] hover:text-[color:var(--accent)]"
                  >
                    <FiHash className="h-3 w-3" />
                    {l}
                  </button>
                ))}
              </div>
            )}
          </header>

          {page.content.trim() ? (
            <DocContent html={html} />
          ) : (
            <div className="rounded-2xl border border-dashed border-[color:var(--border-subtle)] p-10 text-center text-sm text-[color:var(--text-muted)]">
              This page is empty.
              {page.canEdit && (
                <button type="button" onClick={onEdit} className="ml-1 text-[color:var(--accent)] hover:underline">
                  Start writing
                </button>
              )}
            </div>
          )}

          {page.children.length > 0 && (
            <section className="mt-10">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">Child pages</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {page.children.map((c) => (
                  <Link
                    key={c.id}
                    to={pagePath(page.space?.key, c.id)}
                    className="flex items-center gap-2 rounded-xl border border-[color:var(--border-subtle)] px-3 py-2.5 text-sm hover:border-[color:var(--accent)]/50 hover-elevated"
                  >
                    <PageGlyph emoji={c.emoji} />
                    <span className="truncate">{c.title}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <PageComments pageId={page.id} token={token} canModerate={isAdmin} />
        </article>

        {hasRail && (
          <aside className="hidden xl:block">
            <div className="sticky top-4 space-y-6">
              {outline.length > 1 && (
                <section>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">On this page</p>
                  <ul className="space-y-0.5 border-l border-[color:var(--border-subtle)]">
                    {outline.map((o) => (
                      <li key={o.id}>
                        <a
                          href={`#${o.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            document.getElementById(o.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          }}
                          className={`-ml-px block border-l py-0.5 text-xs transition ${
                            activeHeading === o.id
                              ? 'border-[color:var(--accent)] text-[color:var(--accent)]'
                              : 'border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
                          }`}
                          style={{ paddingLeft: 10 + (o.level - 1) * 10 }}
                        >
                          {o.text}
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {page.issues.length > 0 && (
                <section>
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                    <FiLink2 /> Linked issues
                  </p>
                  {page.issues.map((i) => (
                    <IssueRow key={i.id} issue={i} />
                  ))}
                </section>
              )}
              {page.mentionedIssues.length > 0 && (
                <section>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">Mentioned issues</p>
                  {page.mentionedIssues.map((i) => (
                    <IssueRow key={i.id} issue={i} />
                  ))}
                </section>
              )}
              {page.projects.length > 0 && (
                <section>
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                    <FiFolder /> Projects
                  </p>
                  {page.projects.map((p) => (
                    <Link key={p.id} to={`/projects/${p.id}/docs`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-[color:var(--bg-elevated)]">
                      <span className="font-mono text-[11px] text-[color:var(--accent)]">{p.key}</span>
                      <span className="truncate">{p.name}</span>
                    </Link>
                  ))}
                </section>
              )}
            </div>
          </aside>
        )}
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
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-[color:var(--bg-elevated)] ${danger ? 'text-red-400' : ''}`}
    >
      <span className="text-[color:var(--text-muted)]">{icon}</span>
      {label}
    </button>
  );
}
