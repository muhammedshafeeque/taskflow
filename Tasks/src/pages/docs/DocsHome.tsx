import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FiArchive, FiEdit3, FiFileText, FiPlus, FiSearch, FiStar, FiUsers, FiX } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { EmptyState, ErrorBanner, LoadingBlock, PageShell, Segmented, btnPrimary, btnSecondary } from '../resources/resourceKit';
import { docsApi, type DocPageCard, type DocSpace } from '../../lib/docsApi';
import { CreatePageModal, SpaceSettingsModal } from '../../components/docs/DocsModals';
import { PageCardRow, SpaceBadge, errorText, useDocsMe } from '../../components/docs/docsUi';
import { RelativeDate } from '../../components/issues/issueUi';

type Tab = 'recent' | 'starred' | 'drafts' | 'mine';

const AUDIENCE_LABEL = { workspace: 'Everyone', project: 'Project members', restricted: 'Restricted' } as const;

function SpaceCard({ space }: { space: DocSpace }) {
  return (
    <Link
      to={`/docs/${space.key}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 card-shadow hover-elevated"
    >
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: space.color || 'var(--accent)' }} />
      <div className="flex items-start gap-3">
        <SpaceBadge icon={space.icon} name={space.name} color={space.color} size={40} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate font-semibold group-hover:text-[color:var(--accent)]">
            {space.name}
            {space.starred && <FiStar className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />}
          </p>
          <p className="font-mono text-[11px] text-[color:var(--text-muted)]">{space.key}</p>
        </div>
      </div>
      {space.description && <p className="mt-3 line-clamp-2 text-xs text-[color:var(--text-muted)]">{space.description}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-4 text-[11px] text-[color:var(--text-muted)]">
        <span className="inline-flex items-center gap-1">
          <FiFileText /> {space.pageCount} page{space.pageCount === 1 ? '' : 's'}
        </span>
        <span className="inline-flex items-center gap-1">
          <FiUsers /> {AUDIENCE_LABEL[space.audience]}
        </span>
        {space.projects.slice(0, 3).map((p) => (
          <span key={p.id} className="rounded bg-[color:var(--bg-elevated)] px-1.5 font-mono">
            {p.key}
          </span>
        ))}
        {space.archived && (
          <span className="inline-flex items-center gap-1 text-amber-500">
            <FiArchive /> Archived
          </span>
        )}
        <span className="ml-auto">
          <RelativeDate value={space.updatedAt} />
        </span>
      </div>
    </Link>
  );
}

export default function DocsHome() {
  const { token, user } = useAuth();
  const me = useDocsMe(token);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const label = params.get('label') ?? '';
  const [spaces, setSpaces] = useState<DocSpace[]>([]);
  const [overview, setOverview] = useState<{ recent: DocPageCard[]; starred: DocPageCard[]; drafts: DocPageCard[]; editedByMe: DocPageCard[] } | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('recent');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<DocPageCard[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [creatingSpace, setCreatingSpace] = useState(false);
  const [creatingPage, setCreatingPage] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const [s, o] = await Promise.all([docsApi.listSpaces(token, { archived: true }), docsApi.overview(token)]);
    if (!s.success) return setError(errorText(s, 'Could not load docs'));
    setError('');
    setSpaces(s.data ?? []);
    setOverview(o.data ?? null);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load, user?.activeOrganizationId]);

  // Search across every visible page (debounced); a label filter from a page's label chip works the same way.
  useEffect(() => {
    if (!token) return;
    if (!q.trim() && !label) return setResults(null);
    const t = window.setTimeout(() => {
      docsApi.search({ q: q.trim() || undefined, label: label || undefined }, token).then((r) => setResults(r.data?.pages ?? []));
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, label, token]);

  const visibleSpaces = useMemo(
    () => spaces.filter((s) => showArchived || !s.archived).sort((a, b) => Number(b.starred) - Number(a.starred) || a.name.localeCompare(b.name)),
    [spaces, showArchived]
  );
  const archivedCount = spaces.filter((s) => s.archived).length;
  const canWriteSomewhere = spaces.some((s) => s.myRole !== 'viewer' && !s.archived);

  const list = overview ? { recent: overview.recent, starred: overview.starred, drafts: overview.drafts, mine: overview.editedByMe }[tab] : [];

  if (!token) return null;

  return (
    <PageShell
      eyebrow="Docs"
      title="Knowledge spaces"
      description="Write specs, meeting notes, how-tos and decisions. Link pages to projects and issues — mention an issue key like ABC-12 and it links itself."
      actions={
        <>
          {canWriteSomewhere && (
            <button type="button" className={btnSecondary} onClick={() => setCreatingPage(true)}>
              <FiEdit3 /> New page
            </button>
          )}
          {me.canCreateSpace && (
            <button type="button" className={btnPrimary} onClick={() => setCreatingSpace(true)}>
              <FiPlus /> Create space
            </button>
          )}
        </>
      }
    >
      {error && <ErrorBanner message={error} onRetry={load} />}

      <div className="relative">
        <FiSearch className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--text-muted)]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search all pages by title, text, label or issue key…"
          className="w-full rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] py-3 pl-11 pr-4 text-sm outline-none focus:border-[color:var(--accent)] card-shadow"
        />
      </div>

      {results !== null ? (
        <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-2">
          <div className="flex items-center justify-between px-3 py-2">
            <p className="text-xs text-[color:var(--text-muted)]">
              {results.length} result{results.length === 1 ? '' : 's'}
              {label && (
                <button
                  type="button"
                  className="ml-2 inline-flex items-center gap-1 rounded-full bg-[color:var(--accent-subtle)] px-2 py-0.5 text-[color:var(--accent)]"
                  onClick={() => {
                    params.delete('label');
                    setParams(params);
                  }}
                >
                  #{label} <FiX />
                </button>
              )}
            </p>
          </div>
          {results.length ? results.map((p) => <PageCardRow key={p.id} page={p} />) : <p className="px-3 pb-4 text-sm text-[color:var(--text-muted)]">Nothing matches.</p>}
        </section>
      ) : !overview ? (
        <LoadingBlock />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Spaces</h2>
              {archivedCount > 0 && (
                <button type="button" className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--accent)]" onClick={() => setShowArchived((v) => !v)}>
                  {showArchived ? 'Hide' : 'Show'} {archivedCount} archived
                </button>
              )}
            </div>
            {visibleSpaces.length ? (
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {visibleSpaces.map((s) => (
                  <SpaceCard key={s.id} space={s} />
                ))}
              </div>
            ) : (
              <EmptyState title="No spaces yet">
                {me.canCreateSpace ? 'Create a space for a team, a project or a topic to start writing.' : 'Ask a docs admin to create a space or add you to one.'}
              </EmptyState>
            )}
          </section>

          <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-3 self-start">
            <div className="mb-2 px-1">
              <Segmented<Tab>
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'recent', label: 'Recent' },
                  { value: 'starred', label: `Starred${overview.starred.length ? ` ${overview.starred.length}` : ''}` },
                  { value: 'drafts', label: `Drafts${overview.drafts.length ? ` ${overview.drafts.length}` : ''}` },
                  { value: 'mine', label: 'By me' },
                ]}
              />
            </div>
            {list.length ? (
              list.map((p) => <PageCardRow key={p.id} page={p} />)
            ) : (
              <p className="px-3 py-8 text-center text-sm text-[color:var(--text-muted)]">
                {tab === 'starred' ? 'Star pages to keep them here.' : tab === 'drafts' ? 'No drafts — new pages start here until you publish.' : 'Nothing yet.'}
              </p>
            )}
          </section>
        </div>
      )}

      <SpaceSettingsModal open={creatingSpace} onClose={() => setCreatingSpace(false)} token={token} onSaved={(s) => navigate(`/docs/${s.key}`)} />
      <CreatePageModal open={creatingPage} onClose={() => setCreatingPage(false)} token={token} />
    </PageShell>
  );
}
