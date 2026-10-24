import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FiArchive, FiChevronLeft, FiHome, FiPlus, FiSearch, FiSettings, FiSidebar, FiStar, FiTrash2, FiUsers, FiX } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { ErrorBanner, LoadingBlock } from '../resources/resourceKit';
import { docsApi, type DocPage, type DocSpace, type DocTreeNode } from '../../lib/docsApi';
import PageTree from '../../components/docs/PageTree';
import PageView from '../../components/docs/PageView';
import PageEditor from '../../components/docs/PageEditor';
import { CreatePageModal, SpaceSettingsModal, TrashModal } from '../../components/docs/DocsModals';
import { ROLE_LABEL, SpaceBadge, errorText, pagePath } from '../../components/docs/docsUi';

const SIDEBAR_KEY = 'docs.sidebar.open';

function readSidebar() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== '0';
  } catch {
    return true;
  }
}

const AUDIENCE_LABEL = { workspace: 'Everyone in the workspace', project: 'Project members', restricted: 'Invited members only' } as const;

export default function DocsSpace() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const { spaceKey = '', pageId } = useParams<{ spaceKey: string; pageId?: string }>();
  const [params, setParams] = useSearchParams();
  const editing = params.get('edit') === '1';
  const [space, setSpace] = useState<DocSpace | null>(null);
  const [nodes, setNodes] = useState<DocTreeNode[]>([]);
  const [page, setPage] = useState<DocPage | null>(null);
  const [error, setError] = useState('');
  const [pageError, setPageError] = useState('');
  const [filter, setFilter] = useState('');
  const [sidebar, setSidebarState] = useState(readSidebar);
  const [mobileNav, setMobileNav] = useState(false);
  const [createUnder, setCreateUnder] = useState<string | null | undefined>(undefined);
  const [settings, setSettings] = useState(false);
  const [trash, setTrash] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const openId = pageId ?? space?.homePageId ?? undefined;

  const setSidebar = (open: boolean) => {
    setSidebarState(open);
    try {
      localStorage.setItem(SIDEBAR_KEY, open ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  };

  const loadSpace = useCallback(async () => {
    if (!token) return;
    const [s, t] = await Promise.all([docsApi.getSpace(spaceKey, token), docsApi.tree(spaceKey, token)]);
    if (!s.success || !s.data) {
      setError(errorText(s, 'Space not found'));
      return;
    }
    setError('');
    setSpace(s.data);
    setNodes(t.data ?? []);
  }, [spaceKey, token]);

  const loadPage = useCallback(async () => {
    if (!token || !openId) return setPage(null);
    const r = await docsApi.getPage(openId, token);
    if (!r.success || !r.data) {
      setPage(null);
      setPageError(errorText(r, 'Page not found'));
      return;
    }
    setPageError('');
    setPage(r.data);
    // Links built without a space key (e.g. "_") are corrected to the page's real space.
    if (r.data.space && r.data.space.key !== spaceKey && pageId) navigate(pagePath(r.data.space.key, r.data.id, editing), { replace: true });
  }, [openId, token, spaceKey, pageId, navigate, editing]);

  useEffect(() => {
    if (spaceKey === '_') return;
    void loadSpace();
  }, [loadSpace, spaceKey]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  // New page → start at the top, and close the mobile drawer.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setMobileNav(false);
  }, [openId, editing]);

  useEffect(() => {
    if (page) document.title = `${page.title} · ${page.space?.name ?? 'Docs'}`;
  }, [page]);

  const setEditing = useCallback(
    (on: boolean) => {
      const next = new URLSearchParams(params);
      if (on) next.set('edit', '1');
      else next.delete('edit');
      setParams(next, { replace: !on });
    },
    [params, setParams]
  );

  async function move(id: string, parentId: string | null, index: number) {
    if (!token) return;
    setNodes((cur) => cur.map((n) => (n.id === id ? { ...n, parentId, position: index - 0.5 } : n)));
    await docsApi.movePage(id, { parentId, index }, token);
    void loadSpace();
    if (id === page?.id) void loadPage();
  }

  async function toggleStar() {
    if (!token || !space) return;
    const next = !space.starred;
    setSpace({ ...space, starred: next });
    await docsApi.starSpace(space.key, next, token);
  }

  if (!token) return null;
  if (error) {
    return (
      <div className="p-8 space-y-3">
        <ErrorBanner message={error} onRetry={loadSpace} />
        <Link to="/docs" className="text-sm text-[color:var(--accent)]">
          ← All spaces
        </Link>
      </div>
    );
  }
  if (!space && spaceKey !== '_') return <LoadingBlock label="Opening space…" />;

  const canEdit = space ? space.myRole !== 'viewer' && !space.archived : false;
  const home = space?.homePageId ? nodes.find((n) => n.id === space.homePageId) : undefined;
  const pageCount = nodes.filter((n) => n.id !== space?.homePageId).length;

  const sidebarBody = space && (
    <div className="flex h-full flex-col">
      {/* Space header */}
      <div className="relative overflow-hidden border-b border-[color:var(--border-subtle)] px-3 pb-3 pt-3">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{ background: `radial-gradient(ellipse 90% 100% at 0% 0%, color-mix(in srgb, ${space.color || 'var(--accent)'} 22%, transparent), transparent 70%)` }}
        />
        <div className="relative">
          <div className="mb-3 flex items-center justify-between">
            <Link to="/docs" className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] font-medium text-[color:var(--text-muted)] hover:text-[color:var(--accent)]">
              <FiChevronLeft /> All spaces
            </Link>
            <button type="button" onClick={() => (setSidebar(false), setMobileNav(false))} className="rounded-md p-1 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)]" title="Hide sidebar">
              <FiSidebar className="hidden md:block" />
              <FiX className="md:hidden" />
            </button>
          </div>
          <div className="flex items-center gap-3">
            <SpaceBadge icon={space.icon} name={space.name} color={space.color} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold leading-tight">{space.name}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[color:var(--text-muted)]">
                <span className="font-mono">{space.key}</span>·<span>{ROLE_LABEL[space.myRole]}</span>
              </p>
            </div>
            <button type="button" onClick={toggleStar} className="rounded-md p-1.5 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-amber-400" title={space.starred ? 'Unstar space' : 'Star space'}>
              <FiStar className={space.starred ? 'fill-amber-400 text-amber-400' : ''} />
            </button>
          </div>
          {space.archived && (
            <p className="mt-2 inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-500">
              <FiArchive /> Archived — read only
            </p>
          )}
        </div>
      </div>

      <div className="px-3 pt-3">
        <div className="relative">
          <FiSearch className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--text-muted)]" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find a page…"
            className="h-8 w-full rounded-lg border border-transparent bg-[color:var(--bg-elevated)] pl-8 pr-2 text-[13px] outline-none transition focus:border-[color:var(--accent)] focus:bg-[color:var(--bg-page)]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {home && (
          <Link
            to={pagePath(space.key, home.id)}
            className={`mb-1 flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition ${
              openId === home.id ? 'bg-[color:var(--accent-subtle)] font-semibold text-[color:var(--accent)]' : 'text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)]'
            }`}
          >
            <FiHome className="h-4 w-4" /> Overview
          </Link>
        )}
        <div className="mb-1 mt-3 flex items-center justify-between px-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
            Pages <span className="ml-1 font-medium">{pageCount}</span>
          </p>
          {canEdit && (
            <button type="button" onClick={() => setCreateUnder(null)} className="grid h-5 w-5 place-items-center rounded text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--accent)]" title="Create a page">
              <FiPlus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <PageTree
          spaceKey={space.key}
          nodes={nodes}
          activeId={openId}
          canEdit={canEdit}
          homePageId={space.homePageId}
          filter={filter}
          onAddChild={(parentId) => setCreateUnder(parentId)}
          onMove={move}
        />
      </div>

      <div className="space-y-2 border-t border-[color:var(--border-subtle)] p-3">
        <p className="flex items-center gap-1.5 px-1 text-[11px] text-[color:var(--text-muted)]">
          <FiUsers className="h-3 w-3" /> {AUDIENCE_LABEL[space.audience]}
        </p>
        <div className="flex items-center gap-1">
          {canEdit && (
            <button type="button" onClick={() => setCreateUnder(null)} className="btn-primary inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-medium">
              <FiPlus /> New page
            </button>
          )}
          {space.myRole !== 'viewer' && (
            <button type="button" onClick={() => setTrash(true)} className="grid h-8 w-8 place-items-center rounded-lg text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)]" title="Trash">
              <FiTrash2 />
            </button>
          )}
          {space.myRole === 'admin' && (
            <button type="button" onClick={() => setSettings(true)} className="grid h-8 w-8 place-items-center rounded-lg text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)]" title="Space settings">
              <FiSettings />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const openNav = (
    <button
      type="button"
      onClick={() => (window.matchMedia('(min-width: 768px)').matches ? setSidebar(true) : setMobileNav(true))}
      className={`mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)] ${sidebar ? 'md:hidden' : ''}`}
      title="Show pages"
    >
      <FiSidebar />
    </button>
  );

  return (
    <div className="flex min-h-0 w-full flex-1">
      {space && sidebar && <aside className="hidden w-[280px] shrink-0 border-r border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] md:block">{sidebarBody}</aside>}

      {space && mobileNav && (
        <div className="fixed inset-0 z-40 flex bg-black/50 backdrop-blur-[2px] md:hidden" onClick={() => setMobileNav(false)}>
          <aside className="h-full w-[86%] max-w-[320px] bg-[color:var(--bg-surface)] shadow-2xl animate-fade-in" onClick={(e) => e.stopPropagation()}>
            {sidebarBody}
          </aside>
        </div>
      )}

      <main ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
        {pageError ? (
          <div className="p-8">
            <ErrorBanner message={pageError} onRetry={loadPage} />
          </div>
        ) : !openId ? (
          <div className="grid min-h-full place-items-center p-8">
            <div className="max-w-sm text-center">
              <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-[color:var(--accent-subtle)] text-3xl">📝</div>
              <p className="text-lg font-semibold">This space has no pages yet</p>
              <p className="mt-1 text-sm text-[color:var(--text-muted)]">Start with a template — meeting notes, a spec, a how-to…</p>
              {canEdit && (
                <button type="button" onClick={() => setCreateUnder(null)} className="btn-primary mt-5 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm">
                  <FiPlus /> Create the first page
                </button>
              )}
            </div>
          </div>
        ) : !page ? (
          <LoadingBlock label="Loading page…" />
        ) : editing && page.canEdit ? (
          <PageEditor
            key={`${page.id}-${page.version}`}
            page={page}
            token={token}
            spaceColor={space?.color}
            onCancel={() => setEditing(false)}
            onSaved={(p) => {
              setPage(p);
              setEditing(false);
              void loadSpace();
            }}
          />
        ) : (
          <PageView
            page={page}
            token={token}
            spaceColor={space?.color}
            leading={space ? openNav : undefined}
            onEdit={() => setEditing(true)}
            onChanged={() => {
              void loadPage();
              void loadSpace();
            }}
            onAddChild={(id) => setCreateUnder(id)}
            onTrashed={() => {
              void loadSpace();
              navigate(page.parentId ? pagePath(space?.key, page.parentId) : `/docs/${space?.key ?? ''}`);
            }}
          />
        )}
      </main>

      {space && (
        <>
          <CreatePageModal
            open={createUnder !== undefined}
            onClose={() => setCreateUnder(undefined)}
            token={token}
            spaceId={space.id}
            parentId={createUnder ?? null}
            projectIds={space.projects.length === 1 ? [space.projects[0].id] : undefined}
            onCreated={loadSpace}
          />
          <SpaceSettingsModal
            open={settings}
            onClose={() => setSettings(false)}
            token={token}
            space={space}
            onSaved={(s) => {
              setSpace(s);
              if (s.key !== spaceKey) navigate(`/docs/${s.key}${pageId ? `/pages/${pageId}` : ''}`, { replace: true });
            }}
            onDeleted={() => navigate('/docs')}
          />
          <TrashModal open={trash} onClose={() => setTrash(false)} token={token} spaceKey={space.key} isAdmin={space.myRole === 'admin'} onChanged={loadSpace} />
        </>
      )}
    </div>
  );
}
