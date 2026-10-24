import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FiArrowRight, FiEdit3, FiPlus } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import { EmptyState, ErrorBanner, LoadingBlock } from './resources/resourceKit';
import { docsApi, type DocLinkedSpace, type DocPageCard } from '../lib/docsApi';
import { projectsApi, type Project } from '../lib/api';
import { CreatePageModal, SpaceSettingsModal } from '../components/docs/DocsModals';
import { DOCS_INDEX, PageCardRow, SpaceBadge, errorText, pagePath, useDocsMe } from '../components/docs/docsUi';

/** Project → Docs tab: spaces bound to the project and pages linked to it. */
export default function ProjectDocs() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const { token } = useAuth();
  const navigate = useNavigate();
  const me = useDocsMe(token);
  const [project, setProject] = useState<Project | null>(null);
  const [spaces, setSpaces] = useState<DocLinkedSpace[]>([]);
  const [pages, setPages] = useState<DocPageCard[] | null>(null);
  const [error, setError] = useState('');
  const [creatingSpace, setCreatingSpace] = useState(false);
  const [creatingPage, setCreatingPage] = useState(false);

  const load = useCallback(async () => {
    if (!token || !projectId) return;
    const r = await docsApi.links({ projectId }, token);
    if (!r.success || !r.data) return setError(errorText(r, 'Could not load project docs'));
    setError('');
    setSpaces(r.data.spaces);
    setPages(r.data.pages);
  }, [token, projectId]);

  useEffect(() => {
    void load();
    if (token && projectId) projectsApi.get(projectId, token).then((r) => r.success && r.data && setProject(r.data));
  }, [load, token, projectId]);

  const spaceDefaults = useMemo(
    () => (project ? { name: `${project.name} docs`, key: project.key.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 10), projectIds: [projectId], audience: 'project' as const } : undefined),
    [project, projectId]
  );
  const projectIds = useMemo(() => [projectId], [projectId]);
  const canWrite = spaces.some((s) => s.myRole !== 'viewer');

  if (!token) return null;

  return (
    <div className="w-full animate-fade-in">
      <div className="relative overflow-hidden border-b border-[color:var(--border-subtle)]">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(ellipse 55% 120% at 10% 0%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 60%)' }}
        />
        <div className={`relative ${DOCS_INDEX} flex flex-wrap items-end justify-between gap-4 py-7`}>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[color:var(--accent)]">{project ? `${project.key} · Docs` : 'Docs'}</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">{project?.name ?? 'Project'} docs</h1>
            <p className="mt-1 max-w-xl text-sm text-[color:var(--text-muted)]">Spaces that belong to this project, and pages from any space that are linked to it.</p>
          </div>
          <div className="flex items-center gap-2">
            {(canWrite || spaces.length === 0) && (
              <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3.5 text-sm font-medium hover:border-[color:var(--accent)]/50" onClick={() => setCreatingPage(true)}>
                <FiEdit3 /> New page
              </button>
            )}
            {me.canCreateSpace && (
              <button type="button" className="btn-primary inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium" onClick={() => setCreatingSpace(true)}>
                <FiPlus /> Create project space
              </button>
            )}
          </div>
        </div>
      </div>
      <div className={`${DOCS_INDEX} space-y-8 py-8`}>
      {error && <ErrorBanner message={error} onRetry={load} />}
      {pages === null ? (
        <LoadingBlock />
      ) : (
        <>
          <section>
            <h2 className="mb-3 text-sm font-semibold">Spaces</h2>
            {spaces.length ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {spaces.map((s) => (
                  <Link
                    key={s.id}
                    to={s.homePageId ? pagePath(s.key, s.homePageId) : `/docs/${s.key}`}
                    className="group relative flex items-start gap-3 overflow-hidden rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 transition hover:-translate-y-0.5 hover:border-[color:var(--accent)]/40 hover:shadow-lg"
                  >
                    <span className="absolute inset-y-0 left-0 w-1" style={{ background: s.color || 'var(--accent)' }} />
                    <SpaceBadge icon={s.icon} name={s.name} color={s.color} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold group-hover:text-[color:var(--accent)]">{s.name}</p>
                      <p className="font-mono text-[11px] text-[color:var(--text-muted)]">{s.key}</p>
                      {s.description && <p className="mt-1.5 line-clamp-2 text-xs text-[color:var(--text-muted)]">{s.description}</p>}
                    </div>
                    <FiArrowRight className="mt-1 text-[color:var(--text-muted)] group-hover:text-[color:var(--accent)]" />
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState title="No space for this project yet">
                {me.canCreateSpace ? 'Create a project space — project members get access automatically.' : 'Ask a docs admin to create a space for this project.'}
              </EmptyState>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold">Linked pages</h2>
            <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-1.5">
            {pages.length ? (
              pages.map((p) => <PageCardRow key={p.id} page={p} />)
            ) : (
              <p className="px-3 py-8 text-center text-sm text-[color:var(--text-muted)]">No pages are linked to this project yet. Link one from a page’s editor, or create a page here.</p>
            )}
            </div>
          </section>
        </>
      )}

      <SpaceSettingsModal
        open={creatingSpace}
        onClose={() => setCreatingSpace(false)}
        token={token}
        defaults={spaceDefaults}
        onSaved={(s) => navigate(`/docs/${s.key}`)}
      />
      </div>
      <CreatePageModal open={creatingPage} onClose={() => setCreatingPage(false)} token={token} projectIds={projectIds} onCreated={load} />
    </div>
  );
}
