import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FiArchive, FiChevronLeft, FiHome, FiPlus, FiSearch, FiSettings, FiSidebar, FiStar, FiTrash2 } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { ErrorBanner, LoadingBlock } from '../resources/resourceKit';
import { docsApi, type DocPage, type DocSpace, type DocTreeNode } from '../../lib/docsApi';
import PageTree from '../../components/docs/PageTree';
import PageView from '../../components/docs/PageView';
import PageEditor from '../../components/docs/PageEditor';
import { CreatePageModal, SpaceSettingsModal, TrashModal } from '../../components/docs/DocsModals';
import { SpaceBadge, errorText, pagePath } from '../../components/docs/docsUi';

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
  const [sidebar, setSidebar] = useState(true);
  const [createUnder, setCreateUnder] = useState<string | null | undefined>(undefined);
  const [settings, setSettings] = useState(false);
  const [trash, setTrash] = useState(false);

  const openId = pageId ?? space?.homePageId ?? undefined;

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

  useEffect(() => {
    if (page) document.title = `${page.title} · ${page.space?.name ?? 'Docs'}`;
  }, [page]);

  const setEditing = (on: boolean) => {
    const next = new URLSearchParams(params);
    if (on) next.set('edit', '1');
    else next.delete('edit');
    setParams(next, { replace: !on });
  };

  async function move(id: string, parentId: string | null, index: number) {
    if (!token) return;
    // Optimistic: reflect the move straight away, then reload the real order.
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

  return (
    <div className="flex min-h-[calc(100vh-4rem)] w-full">
      {space && sidebar && (
        <aside className="sticky top-0 hidden h-[calc(100vh-4rem)] w-72 shrink-0 flex-col border-r border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] md:flex">
          <div className="border-b border-[color:var(--border-subtle)] p-3">
            <Link to="/docs" className="mb-2 inline-flex items-center gap-1 text-[11px] text-[color:var(--text-muted)] hover:text-[color:var(--accent)]">
              <FiChevronLeft /> All spaces
            </Link>
            <div className="flex items-center gap-2.5">
              <SpaceBadge icon={space.icon} name={space.name} color={space.color} size={34} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-sm">{space.name}</p>
                <p className="text-[11px] text-[color:var(--text-muted)] font-mono">{space.key}</p>
              </div>
              <button type="button" onClick={toggleStar} className="p-1 text-[color:var(--text-muted)] hover:text-amber-400" title={space.starred ? 'Unstar space' : 'Star space'}>
                <FiStar className={space.starred ? 'fill-amber-400 text-amber-400' : ''} />
              </button>
              <button type="button" onClick={() => setSidebar(false)} className="p-1 text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]" title="Hide sidebar">
                <FiSidebar />
              </button>
            </div>
            {space.archived && (
              <p className="mt-2 inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-500">
                <FiArchive /> Archived — read only
              </p>
            )}
            <div className="relative mt-3">
              <FiSearch className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--text-muted)]" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter pages"
                className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] py-1.5 pl-8 pr-2 text-xs outline-none focus:border-[color:var(--accent)]"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {home && (
              <Link
                to={pagePath(space.key, home.id)}
                className={`mb-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] ${
                  openId === home.id ? 'bg-[color:var(--accent-subtle)] text-[color:var(--accent)] font-medium' : 'hover:bg-[color:var(--bg-elevated)]'
                }`}
              >
                <FiHome className="h-3.5 w-3.5" /> Overview
              </Link>
            )}
            <div className="mb-1 flex items-center justify-between px-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">Pages</p>
              {canEdit && (
                <button type="button" onClick={() => setCreateUnder(null)} className="rounded p-0.5 text-[color:var(--text-muted)] hover:text-[color:var(--accent)]" title="Create a page">
                  <FiPlus />
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

          <div className="flex items-center gap-1 border-t border-[color:var(--border-subtle)] p-2">
            {canEdit && (
              <button type="button" onClick={() => setCreateUnder(null)} className="btn-primary inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs">
                <FiPlus /> New page
              </button>
            )}
            {space.myRole !== 'viewer' && (
              <button type="button" onClick={() => setTrash(true)} className="rounded-lg p-2 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)]" title="Trash">
                <FiTrash2 />
              </button>
            )}
            {space.myRole === 'admin' && (
              <button type="button" onClick={() => setSettings(true)} className="rounded-lg p-2 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)]" title="Space settings">
                <FiSettings />
              </button>
            )}
          </div>
        </aside>
      )}

      <main className="min-w-0 flex-1 px-4 py-5 sm:px-8 lg:px-12">
        {space && !sidebar && (
          <button type="button" onClick={() => setSidebar(true)} className="mb-3 inline-flex items-center gap-1.5 text-xs text-[color:var(--text-muted)] hover:text-[color:var(--accent)]">
            <FiSidebar /> Show pages
          </button>
        )}
        {pageError ? (
          <ErrorBanner message={pageError} onRetry={loadPage} />
        ) : !openId ? (
          <div className="mx-auto mt-20 max-w-md text-center">
            <p className="text-lg font-semibold">This space has no pages yet</p>
            {canEdit && (
              <button type="button" onClick={() => setCreateUnder(null)} className="btn-primary mt-4 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm">
                <FiPlus /> Create the first page
              </button>
            )}
          </div>
        ) : !page ? (
          <LoadingBlock label="Loading page…" />
        ) : editing && page.canEdit ? (
          <PageEditor
            key={`${page.id}-${page.version}`}
            page={page}
            token={token}
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
          <TrashModal
            open={trash}
            onClose={() => setTrash(false)}
            token={token}
            spaceKey={space.key}
            isAdmin={space.myRole === 'admin'}
            onChanged={loadSpace}
          />
        </>
      )}
    </div>
  );
}
