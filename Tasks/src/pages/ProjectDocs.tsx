import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FiArrowRight, FiEdit3, FiPlus } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import { EmptyState, ErrorBanner, LoadingBlock, PageShell, btnPrimary, btnSecondary } from './resources/resourceKit';
import { docsApi, type DocLinkedSpace, type DocPageCard } from '../lib/docsApi';
import { projectsApi, type Project } from '../lib/api';
import { CreatePageModal, SpaceSettingsModal } from '../components/docs/DocsModals';
import { PageCardRow, SpaceBadge, errorText, pagePath, useDocsMe } from '../components/docs/docsUi';

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
    <PageShell
      eyebrow={project ? `${project.key} · Docs` : 'Docs'}
      title="Project docs"
      description="Spaces that belong to this project, and pages from any space that are linked to it."
      actions={
        <>
          {(canWrite || spaces.length === 0) && (
            <button type="button" className={btnSecondary} onClick={() => setCreatingPage(true)}>
              <FiEdit3 /> New page
            </button>
          )}
          {me.canCreateSpace && (
            <button type="button" className={btnPrimary} onClick={() => setCreatingSpace(true)}>
              <FiPlus /> Create project space
            </button>
          )}
        </>
      }
    >
      {error && <ErrorBanner message={error} onRetry={load} />}
      {pages === null ? (
        <LoadingBlock />
      ) : (
        <>
          <section>
            <h2 className="mb-3 text-sm font-semibold">Spaces</h2>
            {spaces.length ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {spaces.map((s) => (
                  <Link
                    key={s.id}
                    to={s.homePageId ? pagePath(s.key, s.homePageId) : `/docs/${s.key}`}
                    className="group flex items-start gap-3 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 card-shadow hover-elevated"
                  >
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

          <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-2">
            <h2 className="px-3 py-2 text-sm font-semibold">Linked pages</h2>
            {pages.length ? (
              pages.map((p) => <PageCardRow key={p.id} page={p} />)
            ) : (
              <p className="px-3 pb-4 text-sm text-[color:var(--text-muted)]">No pages are linked to this project yet. Link one from a page’s editor, or create a page here.</p>
            )}
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
      <CreatePageModal open={creatingPage} onClose={() => setCreatingPage(false)} token={token} projectIds={projectIds} onCreated={load} />
    </PageShell>
  );
}
