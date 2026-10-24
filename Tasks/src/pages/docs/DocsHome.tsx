import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FiArchive, FiArrowRight, FiClock, FiEdit3, FiFileText, FiFolder, FiPlus, FiSearch, FiStar, FiUsers, FiX } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { ErrorBanner, LoadingBlock } from '../resources/resourceKit';
import { Avatar, RelativeDate } from '../../components/issues/issueUi';
import { docsApi, type DocPageCard, type DocSpace } from '../../lib/docsApi';
import { CreatePageModal, SpaceSettingsModal } from '../../components/docs/DocsModals';
import { docTemplates } from '../../components/docs/docTemplates';
import { DOCS_INDEX, PageCardRow, PageGlyph, SpaceBadge, errorText, pagePath, useDocsMe } from '../../components/docs/docsUi';

type Tab = 'starred' | 'drafts' | 'mine';

const AUDIENCE = {
  workspace: { label: 'Everyone', icon: FiUsers },
  project: { label: 'Project', icon: FiFolder },
  restricted: { label: 'Private', icon: FiUsers },
} as const;

const QUICK = ['blank', 'meeting', 'requirements', 'tech-design', 'how-to'];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function RecentCard({ page }: { page: DocPageCard }) {
  const tint = page.space?.color || 'var(--accent)';
  return (
    <Link
      to={pagePath(page.space?.key, page.id)}
      className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] transition hover:-translate-y-0.5 hover:border-[color:var(--accent)]/40 hover:shadow-lg"
    >
      <div className="h-14 w-full" style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${tint} 35%, transparent), color-mix(in srgb, ${tint} 8%, transparent))` }} />
      <div className="-mt-6 flex flex-1 flex-col px-4 pb-4">
        <span className="mb-2 grid h-11 w-11 place-items-center rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] text-2xl shadow-sm">
          {page.emoji || <FiFileText className="h-5 w-5 text-[color:var(--text-muted)]" />}
        </span>
        <p className="line-clamp-2 font-semibold leading-snug group-hover:text-[color:var(--accent)]">{page.title}</p>
        {page.excerpt && <p className="mt-1 line-clamp-2 text-xs text-[color:var(--text-muted)]">{page.excerpt}</p>}
        <div className="mt-auto flex items-center gap-2 pt-4 text-[11px] text-[color:var(--text-muted)]">
          {page.space && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <SpaceBadge icon={page.space.icon} name={page.space.name} color={page.space.color} size={14} />
              <span className="truncate">{page.space.name}</span>
            </span>
          )}
          <span className="ml-auto inline-flex shrink-0 items-center gap-1">
            {page.updatedBy?.name && <Avatar name={page.updatedBy.name} size={16} />}
            <RelativeDate value={page.updatedAt} />
          </span>
        </div>
      </div>
    </Link>
  );
}

function SpaceCard({ space }: { space: DocSpace }) {
  const tint = space.color || 'var(--accent)';
  const Aud = AUDIENCE[space.audience];
  return (
    <Link
      to={`/docs/${space.key}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] transition hover:-translate-y-0.5 hover:border-[color:var(--accent)]/40 hover:shadow-lg"
    >
      <div
        className="relative h-20"
        style={{
          background: `radial-gradient(ellipse 70% 140% at 0% 0%, color-mix(in srgb, ${tint} 60%, transparent), transparent 70%), linear-gradient(135deg, color-mix(in srgb, ${tint} 28%, var(--bg-surface)), var(--bg-surface))`,
        }}
      >
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)', backgroundSize: '14px 14px', color: tint }} />
        {space.starred && <FiStar className="absolute right-3 top-3 h-4 w-4 fill-amber-400 text-amber-400 drop-shadow" />}
        {space.archived && (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-[10px] text-white backdrop-blur">
            <FiArchive /> Archived
          </span>
        )}
      </div>
      <div className="-mt-7 flex flex-1 flex-col px-4 pb-4">
        <div className="rounded-xl ring-4 ring-[color:var(--bg-surface)] w-fit">
          <SpaceBadge icon={space.icon} name={space.name} color={space.color} size={48} />
        </div>
        <p className="mt-2.5 truncate text-[15px] font-bold group-hover:text-[color:var(--accent)]">{space.name}</p>
        <p className="font-mono text-[11px] text-[color:var(--text-muted)]">{space.key}</p>
        <p className="mt-2 line-clamp-2 min-h-[2.5em] text-xs text-[color:var(--text-muted)]">{space.description || 'No description yet.'}</p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-4 text-[11px]">
          <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--bg-elevated)] px-2 py-0.5 text-[color:var(--text-muted)]">
            <FiFileText className="h-3 w-3" /> {space.pageCount}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--bg-elevated)] px-2 py-0.5 text-[color:var(--text-muted)]">
            <Aud.icon className="h-3 w-3" /> {Aud.label}
          </span>
          {space.projects.slice(0, 2).map((p) => (
            <span key={p.id} className="rounded-full border border-[color:var(--border-subtle)] px-2 py-0.5 font-mono text-[10px] text-[color:var(--text-muted)]">
              {p.key}
            </span>
          ))}
          {space.projects.length > 2 && <span className="text-[color:var(--text-muted)]">+{space.projects.length - 2}</span>}
        </div>
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
  const [tab, setTab] = useState<Tab>('starred');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ pages: DocPageCard[]; spaces: Array<{ id: string; key: string; name: string; icon?: string }> } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [creatingSpace, setCreatingSpace] = useState(false);
  const [creatingPage, setCreatingPage] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const templates = useMemo(() => docTemplates().filter((t) => QUICK.includes(t.id)), []);

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

  useEffect(() => {
    if (!token) return;
    if (!q.trim() && !label) return setResults(null);
    const t = window.setTimeout(() => {
      docsApi.search({ q: q.trim() || undefined, label: label || undefined }, token).then((r) => setResults(r.data ?? { pages: [], spaces: [] }));
    }, 220);
    return () => window.clearTimeout(t);
  }, [q, label, token]);

  // "/" focuses search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !t.closest('input, textarea, [contenteditable="true"]')) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const visibleSpaces = useMemo(
    () => spaces.filter((s) => showArchived || !s.archived).sort((a, b) => Number(b.starred) - Number(a.starred) || a.name.localeCompare(b.name)),
    [spaces, showArchived]
  );
  const archivedCount = spaces.filter((s) => s.archived).length;
  const canWriteSomewhere = spaces.some((s) => s.myRole !== 'viewer' && !s.archived);
  const firstName = (user?.name ?? '').split(' ')[0];
  const side = overview ? { starred: overview.starred, drafts: overview.drafts, mine: overview.editedByMe }[tab] : [];
  const searching = results !== null;

  if (!token) return null;

  return (
    <div className="w-full animate-fade-in">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-[color:var(--border-subtle)]">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 55% 120% at 10% 0%, color-mix(in srgb, var(--accent) 18%, transparent), transparent 60%), radial-gradient(ellipse 40% 100% at 95% 100%, color-mix(in srgb, #0ea5e9 14%, transparent), transparent 60%)',
          }}
        />
        <div className={`relative ${DOCS_INDEX} pb-8 pt-8`}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[color:var(--accent)]">Docs</p>
              <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-[2.1rem]">
                {greeting()}
                {firstName ? `, ${firstName}` : ''}
              </h1>
              <p className="mt-1 max-w-xl text-sm text-[color:var(--text-muted)]">Your team’s knowledge — specs, notes, how-tos and decisions, linked to the projects and issues they’re about.</p>
            </div>
            <div className="flex items-center gap-2">
              {canWriteSomewhere && (
                <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3.5 text-sm font-medium transition hover:border-[color:var(--accent)]/50" onClick={() => setCreatingPage('blank')}>
                  <FiEdit3 /> New page
                </button>
              )}
              {me.canCreateSpace && (
                <button type="button" className="btn-primary inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium" onClick={() => setCreatingSpace(true)}>
                  <FiPlus /> Create space
                </button>
              )}
            </div>
          </div>

          <div className="relative mt-6 max-w-3xl">
            <FiSearch className="absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[color:var(--text-muted)]" />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQ('')}
              placeholder="Search pages, spaces, labels or issue keys…"
              className="h-12 w-full rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] pl-11 pr-16 text-[15px] shadow-sm outline-none transition focus:border-[color:var(--accent)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_15%,transparent)]"
            />
            {q ? (
              <button type="button" onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]" aria-label="Clear search">
                <FiX />
              </button>
            ) : (
              <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] px-2 py-0.5 text-[11px] text-[color:var(--text-muted)]">/</kbd>
            )}
          </div>

          {canWriteSomewhere && !searching && (
            <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setCreatingPage(t.id)}
                  className="group flex shrink-0 items-center gap-2.5 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]/80 py-2 pl-2 pr-4 text-left backdrop-blur transition hover:border-[color:var(--accent)]/50 hover:shadow-md"
                >
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-[color:var(--bg-elevated)] text-lg transition group-hover:scale-110">
                    {t.emoji || <FiPlus className="text-[color:var(--accent)]" />}
                  </span>
                  <span>
                    <span className="block text-[13px] font-semibold">{t.name}</span>
                    <span className="block text-[11px] text-[color:var(--text-muted)]">Template</span>
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCreatingPage('blank')}
                className="inline-flex shrink-0 items-center gap-1 rounded-xl px-3 text-[13px] text-[color:var(--text-muted)] hover:text-[color:var(--accent)]"
              >
                More templates <FiArrowRight />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className={`${DOCS_INDEX} space-y-10 py-8`}>
        {error && <ErrorBanner message={error} onRetry={load} />}

        {searching ? (
          <section>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">
                {results.pages.length} page{results.pages.length === 1 ? '' : 's'}
                {q && (
                  <span className="font-normal text-[color:var(--text-muted)]">
                    {' '}
                    for “{q}”
                  </span>
                )}
              </h2>
              {label && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full bg-[color:var(--accent-subtle)] px-2.5 py-0.5 text-xs text-[color:var(--accent)]"
                  onClick={() => {
                    params.delete('label');
                    setParams(params);
                  }}
                >
                  #{label} <FiX />
                </button>
              )}
            </div>
            {results.spaces.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {results.spaces.map((s) => (
                  <Link key={s.id} to={`/docs/${s.key}`} className="inline-flex items-center gap-2 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-1.5 text-sm hover:border-[color:var(--accent)]/50">
                    <SpaceBadge icon={s.icon} name={s.name} size={20} /> {s.name}
                  </Link>
                ))}
              </div>
            )}
            <div className="overflow-hidden rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-1.5">
              {results.pages.length ? (
                results.pages.map((p) => <PageCardRow key={p.id} page={p} />)
              ) : (
                <div className="py-14 text-center">
                  <FiSearch className="mx-auto h-6 w-6 text-[color:var(--text-muted)]" />
                  <p className="mt-2 font-medium">No pages found</p>
                  <p className="text-sm text-[color:var(--text-muted)]">Try another word, or an issue key like ABC-12.</p>
                </div>
              )}
            </div>
          </section>
        ) : !overview ? (
          <LoadingBlock />
        ) : (
          <>
            {overview.recent.length > 0 && (
              <section>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <FiClock className="text-[color:var(--text-muted)]" /> Recently updated
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6">
                  {overview.recent.slice(0, 8).map((p) => (
                    <RecentCard key={p.id} page={p} />
                  ))}
                </div>
              </section>
            )}

            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold">
                    Spaces <span className="ml-1 font-normal text-[color:var(--text-muted)]">{visibleSpaces.length}</span>
                  </h2>
                  {archivedCount > 0 && (
                    <button type="button" className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--accent)]" onClick={() => setShowArchived((v) => !v)}>
                      {showArchived ? 'Hide' : 'Show'} {archivedCount} archived
                    </button>
                  )}
                </div>
                {visibleSpaces.length ? (
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {visibleSpaces.map((s) => (
                      <SpaceCard key={s.id} space={s} />
                    ))}
                    {me.canCreateSpace && (
                      <button
                        type="button"
                        onClick={() => setCreatingSpace(true)}
                        className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[color:var(--border-subtle)] text-[color:var(--text-muted)] transition hover:border-[color:var(--accent)]/50 hover:bg-[color:var(--accent-subtle)] hover:text-[color:var(--accent)]"
                      >
                        <FiPlus className="h-6 w-6" />
                        <span className="text-sm font-medium">New space</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="rounded-2xl border-2 border-dashed border-[color:var(--border-subtle)] px-6 py-16 text-center">
                    <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-[color:var(--accent-subtle)] text-2xl">📚</div>
                    <p className="font-semibold">No spaces yet</p>
                    <p className="mx-auto mt-1 max-w-sm text-sm text-[color:var(--text-muted)]">
                      {me.canCreateSpace ? 'Create a space for a team, a project or a topic, then start adding pages.' : 'Ask a docs admin to create a space or add you to one.'}
                    </p>
                    {me.canCreateSpace && (
                      <button type="button" className="btn-primary mt-5 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm" onClick={() => setCreatingSpace(true)}>
                        <FiPlus /> Create your first space
                      </button>
                    )}
                  </div>
                )}
              </section>

              <aside className="self-start lg:sticky lg:top-4">
                <div className="overflow-hidden rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]">
                  <div className="flex border-b border-[color:var(--border-subtle)]">
                    {(
                      [
                        { id: 'starred', label: 'Starred', n: overview.starred.length },
                        { id: 'drafts', label: 'Drafts', n: overview.drafts.length },
                        { id: 'mine', label: 'Edited by me', n: 0 },
                      ] as const
                    ).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTab(t.id)}
                        className={`relative flex-1 px-3 py-3 text-[13px] font-medium transition ${tab === t.id ? 'text-[color:var(--text-primary)]' : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'}`}
                      >
                        {t.label}
                        {t.n > 0 && <span className="ml-1.5 rounded-full bg-[color:var(--bg-elevated)] px-1.5 text-[10px]">{t.n}</span>}
                        {tab === t.id && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[color:var(--accent)]" />}
                      </button>
                    ))}
                  </div>
                  <div className="max-h-[520px] overflow-y-auto p-1.5">
                    {side.length ? (
                      side.map((p) => (
                        <Link key={p.id} to={pagePath(p.space?.key, p.id)} className="group flex items-center gap-3 rounded-xl px-2.5 py-2 transition hover:bg-[color:var(--bg-elevated)]">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color:var(--bg-elevated)] group-hover:bg-[color:var(--bg-surface)]">
                            <PageGlyph emoji={p.emoji} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium group-hover:text-[color:var(--accent)]">{p.title}</span>
                            <span className="block truncate text-[11px] text-[color:var(--text-muted)]">
                              {p.space?.name} · <RelativeDate value={p.updatedAt} />
                            </span>
                          </span>
                        </Link>
                      ))
                    ) : (
                      <div className="px-4 py-10 text-center">
                        <div className="mx-auto mb-2 text-2xl">{tab === 'starred' ? '⭐' : tab === 'drafts' ? '📝' : '✍️'}</div>
                        <p className="text-[13px] text-[color:var(--text-muted)]">
                          {tab === 'starred' ? 'Star pages to keep them close.' : tab === 'drafts' ? 'New pages wait here until you publish them.' : 'Pages you edit will show up here.'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </aside>
            </div>
          </>
        )}
      </div>

      <SpaceSettingsModal open={creatingSpace} onClose={() => setCreatingSpace(false)} token={token} onSaved={(s) => navigate(`/docs/${s.key}`)} />
      <CreatePageModal open={creatingPage !== null} onClose={() => setCreatingPage(null)} token={token} initialTemplate={creatingPage ?? undefined} />
    </div>
  );
}
