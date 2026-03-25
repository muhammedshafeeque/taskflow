import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { useAuth } from '../contexts/AuthContext';
import { projectsApi, issuesApi, type Project, type ProjectVersion, type Issue, getIssueKey } from '../lib/api';
import { EditIcon, TrashIcon, WarningIcon, PackageIcon } from '../components/icons/NavigationIcons';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const inputClass =
  'w-full px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-xs placeholder-[color:var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40 transition';
const labelClass = 'block text-xs font-medium text-[color:var(--text-primary)] mb-1.5';

function StatusBadge({ status }: { status: ProjectVersion['status'] }) {
  const styles = {
    unreleased: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    released: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    archived: 'bg-[color:var(--bg-button-secondary)]/50 text-[color:var(--text-muted)] border-[color:var(--border-subtle)]/50',
  };
  const labels = { unreleased: 'Not released', released: 'Released', archived: 'Archived' };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

/** Strip legacy "set to status" line from stored release notes for display */
function sanitizeReleaseNotesForDisplay(notes: string): string {
  if (!notes || typeof notes !== 'string') return '';
  return notes
    .replace(/\*?Issues in this release have been set to status:[^\n]*\n?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Issue key pattern e.g. S20-1, PROJ-123 */
const ISSUE_KEY_REGEX = /^[A-Z][A-Z0-9]*-\d+$/;

function ReleaseNotesContent({ notes, projectId, contentRef }: { notes: string; projectId: string; contentRef?: React.RefObject<HTMLDivElement | null> }) {
  const sanitized = sanitizeReleaseNotesForDisplay(notes);
  return (
    <div ref={contentRef} className="release-notes-markdown text-[color:var(--text-primary)] text-[14px] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-lg font-semibold text-[color:var(--text-primary)] mt-6 mb-2 first:mt-0 border-b border-[color:var(--border-subtle)] pb-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mt-5 mb-2">{children}</h2>,
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          table: ({ children }) => (
            <div className="overflow-x-auto my-4 rounded-xl border border-[color:var(--border-subtle)]">
              <table className="w-full border-collapse text-left text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-[color:var(--bg-surface)] text-[color:var(--text-primary)] font-medium">{children}</thead>,
          tbody: ({ children }) => <tbody className="divide-y divide-[color:var(--border-subtle)]/70">{children}</tbody>,
          tr: ({ children }) => <tr className="hover:bg-[color:var(--bg-surface)] transition">{children}</tr>,
          th: ({ children }) => (
            <th className="px-4 py-3 text-[color:var(--text-primary)] font-semibold whitespace-nowrap">{children}</th>
          ),
          td: ({ children }) => (
            <td className="px-4 py-3 text-[color:var(--text-primary)] align-top max-w-md">{children}</td>
          ),
          ul: ({ children }) => <ul className="list-none space-y-2 my-3">{children}</ul>,
          li: ({ children }) => (
          <li className="flex items-baseline gap-2 pl-0">
            <span className="text-[color:var(--text-muted)] shrink-0">–</span>
            <span className="min-w-0">{children}</span>
          </li>
        ),
        strong: ({ children }) => {
          const raw = Array.isArray(children) ? children : [children];
          const text = raw.every((c) => typeof c === 'string') ? raw.join('').trim() : (typeof children === 'string' ? children : null);
          if (text && ISSUE_KEY_REGEX.test(text)) {
            return (
              <Link
                to={`/projects/${projectId}/issues/${encodeURIComponent(text)}`}
                className="font-semibold text-[color:var(--text-primary)] underline underline-offset-2"
                onClick={(e) => e.stopPropagation()}
              >
                {text}
              </Link>
            );
          }
          return <strong className="font-semibold text-[color:var(--text-primary)]">{children}</strong>;
        },
      }}
    >
      {sanitized}
    </ReactMarkdown>
    </div>
  );
}

export default function Versions() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [versionEdit, setVersionEdit] = useState<ProjectVersion | null>(null);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [versionForm, setVersionForm] = useState({
    name: '',
    description: '',
    releaseDate: '',
    status: 'unreleased' as ProjectVersion['status'],
    mappedEnvironmentIds: [] as string[],
  });
  const [loading, setLoading] = useState(true);
  const [, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [releaseNotesModal, setReleaseNotesModal] = useState<{ versionName: string; envName: string; notes: string; updatedCount: number } | null>(null);

  const [releaseModalVersion, setReleaseModalVersion] = useState<ProjectVersion | null>(null);
  const [releaseModalIssues, setReleaseModalIssues] = useState<Issue[]>([]);
  const [releaseModalLoading, setReleaseModalLoading] = useState(false);
  const [releaseModalSelectedEnvId, setReleaseModalSelectedEnvId] = useState('');
  const [releaseModalCheckedIds, setReleaseModalCheckedIds] = useState<Set<string>>(new Set());
  const [releaseModalSubmitting, setReleaseModalSubmitting] = useState(false);

  const releaseNotesContentRef = useRef<HTMLDivElement>(null);
  const releaseNotesExportRef = useRef<HTMLDivElement>(null);
  const environments = project?.environments ?? [];

  useEffect(() => {
    if (!projectId) {
      navigate('/projects', { replace: true });
      return;
    }
  }, [projectId, navigate]);

  useEffect(() => {
    if (!token || !projectId) return;
    setLoading(true);
    projectsApi.get(projectId, token).then((res) => {
      setLoading(false);
      if (res.success && res.data) {
        setProject(res.data);
        setVersions(res.data.versions ?? []);
      } else setProject(null);
    });
  }, [token, projectId]);

  // Lock body scroll when any modal is open to prevent overflow/scroll issues
  useEffect(() => {
    const open = versionModalOpen || !!releaseNotesModal || !!releaseModalVersion;
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [versionModalOpen, releaseNotesModal, releaseModalVersion]);

  function showSaved() {
    setSaved(true);
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }

  function addVersion() {
    const name = versionForm.name.trim();
    if (!name) return;
    const next = [
      ...versions,
      {
        id: generateId(),
        name,
        description: versionForm.description.trim() || undefined,
        releaseDate: versionForm.releaseDate || undefined,
        status: versionForm.status,
        mappedEnvironmentIds: versionForm.mappedEnvironmentIds.length ? versionForm.mappedEnvironmentIds : undefined,
        order: versions.length,
      },
    ];
    setVersions(next);
    setVersionForm({ name: '', description: '', releaseDate: '', status: 'unreleased', mappedEnvironmentIds: [] });
    setVersionModalOpen(false);
    persistVersions(next);
  }

  function updateVersionItem() {
    if (!versionEdit) return;
    const name = versionForm.name.trim();
    if (!name) return;
    const next = versions.map((v) =>
      v.id === versionEdit.id
        ? {
            ...v,
            name,
            description: versionForm.description.trim() || undefined,
            releaseDate: versionForm.releaseDate || undefined,
            status: versionEdit.status,
            mappedEnvironmentIds: versionForm.mappedEnvironmentIds.length ? versionForm.mappedEnvironmentIds : undefined,
          }
        : v
    );
    setVersions(next);
    setVersionEdit(null);
    setVersionForm({ name: '', description: '', releaseDate: '', status: 'unreleased', mappedEnvironmentIds: [] });
    setVersionModalOpen(false);
    persistVersions(next);
  }

  function removeVersion(id: string) {
    const next = versions.filter((v) => v.id !== id).map((v, i) => ({ ...v, order: i }));
    setVersions(next);
    if (versionEdit?.id === id) {
      setVersionEdit(null);
      setVersionModalOpen(false);
      setVersionForm({ name: '', description: '', releaseDate: '', status: 'unreleased', mappedEnvironmentIds: [] });
    }
    persistVersions(next);
  }

  async function persistVersions(next: ProjectVersion[]) {
    if (!token || !projectId) return;
    setSaving(true);
    setError('');
    const res = await projectsApi.update(projectId, { versions: next }, token);
    setSaving(false);
    if (res.success && res.data) {
      setProject(res.data);
      setVersions(res.data.versions ?? []);
      showSaved();
    } else setError((res as { message?: string }).message ?? 'Save failed');
  }

  function startEditVersion(v: ProjectVersion) {
    setVersionEdit(v);
    setVersionForm({
      name: v.name,
      description: v.description ?? '',
      releaseDate: v.releaseDate ? v.releaseDate.slice(0, 10) : '',
      status: v.status,
      mappedEnvironmentIds: v.mappedEnvironmentIds ?? [],
    });
    setVersionModalOpen(true);
  }

  function openNewVersionModal() {
    setVersionEdit(null);
    setVersionForm({ name: '', description: '', releaseDate: '', status: 'unreleased', mappedEnvironmentIds: [] });
    setVersionModalOpen(true);
    // Refetch project so we have latest environments (e.g. after user added them in Settings)
    if (token && projectId) {
      projectsApi.get(projectId, token).then((res) => {
        if (res.success && res.data) setProject(res.data);
      });
    }
  }

  function closeVersionModal() {
    setVersionModalOpen(false);
    setVersionEdit(null);
    setVersionForm({ name: '', description: '', releaseDate: '', status: 'unreleased', mappedEnvironmentIds: [] });
  }

  useEffect(() => {
    if (!releaseModalVersion || !token || !projectId) return;
    setReleaseModalLoading(true);
    setReleaseModalSelectedEnvId(environments[0]?.id ?? '');
    issuesApi
      .list({ project: projectId, fixVersion: releaseModalVersion.id, limit: 500, token })
      .then((res) => {
        setReleaseModalLoading(false);
        if (res.success && res.data?.data) {
          setReleaseModalIssues(res.data.data);
          setReleaseModalCheckedIds(new Set(res.data.data.map((i) => i._id)));
        } else {
          setReleaseModalIssues([]);
          setReleaseModalCheckedIds(new Set());
        }
      })
      .catch(() => {
        setReleaseModalLoading(false);
        setReleaseModalIssues([]);
        setReleaseModalCheckedIds(new Set());
      });
  }, [releaseModalVersion?.id, projectId, token]);

  function openReleaseModal(version: ProjectVersion) {
    setReleaseModalVersion(version);
    setReleaseModalIssues([]);
    setReleaseModalCheckedIds(new Set());
  }

  function closeReleaseModal() {
    setReleaseModalVersion(null);
    setReleaseModalIssues([]);
    setReleaseModalCheckedIds(new Set());
    setReleaseModalSelectedEnvId('');
  }

  function toggleReleaseModalCheck(id: string) {
    setReleaseModalCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setReleaseModalSelectAll(checked: boolean) {
    if (checked) setReleaseModalCheckedIds(new Set(releaseModalIssues.map((i) => i._id)));
    else setReleaseModalCheckedIds(new Set());
  }

  async function submitReleaseModal() {
    if (!token || !projectId || !releaseModalVersion || !releaseModalSelectedEnvId) return;
    setReleaseModalSubmitting(true);
    setError('');
    const issueIds = Array.from(releaseModalCheckedIds);
    const res = await projectsApi.releaseVersion(
      projectId,
      releaseModalVersion.id,
      releaseModalSelectedEnvId,
      token,
      issueIds
    );
    setReleaseModalSubmitting(false);
    if (res.success && res.data) {
      const env = environments.find((e) => e.id === releaseModalSelectedEnvId);
      setReleaseNotesModal({
        versionName: releaseModalVersion.name,
        envName: env?.name ?? releaseModalSelectedEnvId,
        notes: res.data.releaseNotes,
        updatedCount: res.data.updatedCount,
      });
      if (res.data.version) {
        setVersions((prev) => prev.map((v) => (v.id === releaseModalVersion.id ? { ...v, ...res.data!.version } : v)));
        setProject((p) => {
          if (!p || !res.data?.version) return p;
          const vs = (p.versions ?? []).map((v) => (v.id === releaseModalVersion.id ? { ...v, ...res.data!.version } : v));
          return { ...p, versions: vs };
        });
      }
      closeReleaseModal();
    } else setError((res as { message?: string }).message ?? 'Release failed');
  }

  async function downloadReleaseNotesAsImage() {
    const el = releaseNotesExportRef.current ?? releaseNotesContentRef.current;
    if (!el || !releaseNotesModal) return;
    try {
      try {
        // Ensure webfonts are ready before capturing.
        await (document as unknown as { fonts?: { ready?: Promise<void> } }).fonts?.ready;
      } catch {
        // ignore
      }
      const computedBg = typeof window !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--bg-elevated').trim() : '';
      const backgroundColor = computedBg ? `color-mix(in srgb, ${computedBg} 100%, transparent)` : '#0b1220';
      const canvas = await html2canvas(el, {
        backgroundColor,
        scale: 2,
        useCORS: true,
        allowTaint: false,
        scrollX: 0,
        scrollY: 0,
      });
      const link = document.createElement('a');
      link.download = `release-notes-${releaseNotesModal.versionName.replace(/\s+/g, '-')}-${releaseNotesModal.envName}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (e) {
      console.error('Download image failed', e);
    }
  }

  async function downloadReleaseNotesAsPdf() {
    const el = releaseNotesExportRef.current ?? releaseNotesContentRef.current;
    if (!el || !releaseNotesModal) return;
    try {
      try {
        await (document as unknown as { fonts?: { ready?: Promise<void> } }).fonts?.ready;
      } catch {
        // ignore
      }
      const computedBg = typeof window !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--bg-elevated').trim() : '';
      const backgroundColor = computedBg ? `color-mix(in srgb, ${computedBg} 100%, transparent)` : '#0b1220';
      const canvas = await html2canvas(el, {
        backgroundColor,
        scale: 2,
        useCORS: true,
        allowTaint: false,
        scrollX: 0,
        scrollY: 0,
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const maxW = pageW - 2 * margin;
      const maxH = pageH - 2 * margin;
      let imgW = maxW;
      let imgH = (canvas.height * imgW) / canvas.width;
      if (imgH > maxH) {
        imgH = maxH;
        imgW = (canvas.width * imgH) / canvas.height;
      }
      pdf.addImage(imgData, 'PNG', margin, margin, imgW, imgH);
      pdf.save(`release-notes-${releaseNotesModal.versionName.replace(/\s+/g, '-')}-${releaseNotesModal.envName}.pdf`);
    } catch (e) {
      console.error('Download PDF failed', e);
    }
  }

  function copyReleaseNotesAsMarkdown() {
    if (!releaseNotesModal) return;
    navigator.clipboard.writeText(releaseNotesModal.notes).catch(() => {});
  }

  function copyReleaseNotesAsHtml() {
    const el = releaseNotesExportRef.current ?? releaseNotesContentRef.current;
    if (!el || !releaseNotesModal) return;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Release notes ${releaseNotesModal.versionName}</title></head><body>${el.innerHTML}</body></html>`;
    navigator.clipboard.writeText(html).catch(() => {});
  }

  if (!projectId) return null;

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center p-8">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[color:var(--border-subtle)] border-t-[color:var(--text-primary)] rounded-full animate-spin" />
          <span className="text-[color:var(--text-muted)] text-sm">Loading versions…</span>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-8">
        <p className="text-[color:var(--text-muted)] text-sm">Project not found.</p>
        <button type="button" onClick={() => navigate('/projects')} className="mt-2 text-[color:var(--text-primary)] hover:underline text-xs">
          Back to projects
        </button>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 md:py-8 animate-fade-in overflow-x-hidden">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl md:text-2xl font-semibold text-[color:var(--text-primary)] tracking-tight">Versions & releases</h1>
          <p className="text-[color:var(--text-muted)] text-sm mt-1 max-w-xl">
            Create versions, set environments and release rules, then release to QA or Production. Issues linked to a version get updated and release notes are generated automatically.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {saved && (
            <span className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/15 text-emerald-400 text-sm font-medium border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Saved
            </span>
          )}
          <button
            type="button"
            onClick={openNewVersionModal}
            className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)] transition"
          >
            + New version
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
          <WarningIcon className="w-4 h-4" /> {error}
        </div>
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-[color:var(--text-muted)]">All versions ({versions.length})</h3>
        </div>
        {versions.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-10 text-center space-y-2">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] mb-1">
              <PackageIcon className="w-5 h-5" />
            </div>
            <p className="text-[color:var(--text-primary)] font-medium text-sm">No versions yet</p>
            <p className="text-[color:var(--text-muted)] text-xs mt-1 max-w-sm mx-auto">
              Add a version above to track releases and link issues from the ticket view.
            </p>
          </div>
        ) : (
            <ul className="space-y-3">
              {versions.map((v) => (
                <li
                  key={v.id}
                  className={`rounded-xl border overflow-hidden transition ${
                    versionEdit?.id === v.id
                      ? 'border-[color:var(--accent)] bg-[color:var(--bg-elevated)]'
                      : 'border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] hover:bg-[color:var(--bg-elevated)]'
                  }`}
                >
                  <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-6 items-center">
                    <div className="min-w-0 flex flex-col gap-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-semibold text-[color:var(--text-primary)] text-sm truncate">{v.name}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => startEditVersion(v)}
                            className="p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)]"
                            title="Edit"
                          >
                            <EditIcon className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeVersion(v.id)}
                            className="p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-red-400 hover:bg-red-500/10"
                            title="Delete"
                          >
                            <TrashIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        {typeof v.issueCount === 'number' && (
                          <span className="text-[color:var(--text-muted)] text-xs" title="Issues linked to this version">
                            {v.issueCount} {v.issueCount === 1 ? 'issue' : 'issues'}
                          </span>
                        )}
                        {v.releaseDate && (
                          <span className="text-[color:var(--text-muted)] text-xs">{new Date(v.releaseDate).toLocaleDateString()}</span>
                        )}
                        {v.mappedEnvironmentIds?.length ? (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[11px] text-[color:var(--text-primary)] font-medium" title="Mapped environment(s)">
                            {v.mappedEnvironmentIds
                              .map((id) => environments.find((e) => e.id === id)?.name)
                              .filter(Boolean)
                              .join(', ') || '—'}
                          </span>
                        ) : null}
                        <StatusBadge status={v.status} />
                      </div>
                    </div>
                    <div className="flex items-center justify-end sm:justify-center shrink-0">
                      {v.status !== 'released' && (
                        <button
                          type="button"
                          onClick={() => openReleaseModal(v)}
                          className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)] transition"
                        >
                          Release
                        </button>
                      )}
                    </div>
                  </div>
                  {environments.length > 0 && (v.status !== 'released' || Object.keys(v.releasedAtByEnvironment ?? {}).length > 0) && (
                    <div className="px-5 pb-4 pt-0 flex flex-wrap gap-2">
                      {environments.map((env) => {
                        const releasedAt = v.releasedAtByEnvironment?.[env.id];
                        return (
                          <div key={env.id} className="flex items-center gap-2">
                            {releasedAt && (
                              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[color:var(--bg-button-secondary)]/50 text-[color:var(--text-primary)] text-sm">
                                <span className="text-emerald-400">✓</span> {env.name}: {new Date(releasedAt).toLocaleDateString()}
                                {v.releaseNotesByEnvironment?.[env.id] && (
                                  <button
                                    type="button"
                                    onClick={() => setReleaseNotesModal({ versionName: v.name, envName: env.name, notes: v.releaseNotesByEnvironment?.[env.id] ?? '', updatedCount: 0 })}
                                    className="text-indigo-400 hover:underline font-medium"
                                  >
                                    View notes
                                  </button>
                                )}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
      </section>

      {environments.length === 0 && versions.length > 0 && (
        <p className="mt-4 text-[color:var(--text-muted)] text-xs">
          Configure <Link to={`/projects/${projectId}/settings`} className="text-[color:var(--text-primary)] hover:underline">environments & release rules</Link> in Project settings to enable “Release to [Env]” for each version.
        </p>
      )}

      {/* Create / Edit version modal - portal so it centers in viewport */}
      {versionModalOpen && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm overflow-auto" onClick={closeVersionModal}>
          <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl shadow-2xl w-full m-auto" style={{ maxWidth: 'min(28rem, calc(100vw - 2rem))' }} onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-3 border-b border-[color:var(--border-subtle)]">
              <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">{versionEdit ? `Edit version: ${versionEdit.name}` : 'New version'}</h3>
              <p className="text-[color:var(--text-muted)] text-xs mt-1">Version name (e.g. 1.0) and optional release date.</p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className={labelClass}>Name</label>
                <input
                  type="text"
                  value={versionForm.name}
                  onChange={(e) => setVersionForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. 1.0"
                  className={inputClass}
                  onKeyDown={(e) => e.key === 'Enter' && (versionEdit ? updateVersionItem() : addVersion())}
                />
              </div>
              <div>
                <label className={labelClass}>Release date</label>
                <input
                  type="date"
                  value={versionForm.releaseDate}
                  onChange={(e) => setVersionForm((f) => ({ ...f, releaseDate: e.target.value }))}
                  className={inputClass}
                />
              </div>
                <div>
                  <label className={labelClass}>Environments</label>
                <select
                  value={versionForm.mappedEnvironmentIds[0] ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    setVersionForm((f) => ({ ...f, mappedEnvironmentIds: v ? [v] : [] }));
                  }}
                  className={inputClass}
                >
                  <option value="">Select environment</option>
                  {environments.map((env) => (
                    <option key={env.id} value={env.id}>{env.name}</option>
                  ))}
                </select>
                {environments.length === 0 && (
                  <Link to={`/projects/${projectId}/settings`} className="inline-block mt-2 text-[color:var(--text-primary)] hover:underline text-xs">
                    Open Project settings →
                  </Link>
                )}
              </div>
              <div>
                <label className={labelClass}>Description (optional)</label>
                <textarea
                  value={versionForm.description}
                  onChange={(e) => setVersionForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  placeholder="Release notes or short description"
                  className={`${inputClass} resize-y min-h-[80px]`}
                />
              </div>
              <div className="flex gap-3 pt-1">
                {versionEdit ? (
                  <>
                    <button type="button" onClick={updateVersionItem} disabled={!versionForm.name.trim()} className="px-4 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)] disabled:opacity-50 transition">Update</button>
                    <button type="button" onClick={closeVersionModal} className="px-4 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)] transition">Cancel</button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={addVersion} disabled={!versionForm.name.trim()} className="px-4 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)] disabled:opacity-50 transition">Create</button>
                    <button type="button" onClick={closeVersionModal} className="px-4 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)] transition">Cancel</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Release modal: select environment + issues to include; unchecked items get version removed */}
      {releaseModalVersion && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm overflow-auto" onClick={closeReleaseModal}>
          <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl shadow-2xl w-full flex flex-col max-h-[90vh]" style={{ maxWidth: 'min(36rem, calc(100vw - 2rem))' }} onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-3 border-b border-[color:var(--border-subtle)] shrink-0">
              <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">Release version {releaseModalVersion.name}</h3>
              <p className="text-[color:var(--text-muted)] text-xs mt-1">Choose environment and which issues to include. Unchecked items will have this version removed from their Fix version.</p>
            </div>
            <div className="p-6 space-y-4 flex-1 min-h-0 flex flex-col overflow-hidden">
              {environments.length === 0 ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-amber-200/90 text-sm">
                  <p className="font-medium mb-2">No environments configured</p>
                  <p className="text-[color:var(--text-muted)] mb-4">Add environments and release rules in Project settings to enable releases.</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <Link
                      to={`/projects/${projectId}/settings`}
                      className="inline-block px-4 py-2 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)] transition"
                    >
                      Open Project settings
                    </Link>
                    <button type="button" onClick={closeReleaseModal} className="px-4 py-2 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)] transition">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <label className={labelClass}>Release to environment</label>
                    <select
                      value={releaseModalSelectedEnvId}
                      onChange={(e) => setReleaseModalSelectedEnvId(e.target.value)}
                      className={inputClass}
                    >
                      {environments.map((e) => {
                        const alreadyReleased = releaseModalVersion.releasedAtByEnvironment?.[e.id];
                        return (
                          <option key={e.id} value={e.id}>
                            {e.name}{alreadyReleased ? ' (Released)' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="flex-1 min-h-0 flex flex-col">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-xs font-medium text-[color:var(--text-muted)]">Issues in this version</span>
                      {releaseModalIssues.length > 0 && (
                        <label className="flex items-center gap-2 text-[color:var(--text-muted)] text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={releaseModalCheckedIds.size === releaseModalIssues.length}
                            onChange={(e) => setReleaseModalSelectAll(e.target.checked)}
                            className="rounded border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-[color:var(--accent)]"
                          />
                          Select all
                        </label>
                      )}
                    </div>
                    {releaseModalLoading ? (
                      <div className="flex items-center justify-center py-12 text-[color:var(--text-muted)] text-xs">
                        <span className="w-5 h-5 border-2 border-[color:var(--border-subtle)] border-t-[color:var(--text-primary)] rounded-full animate-spin mr-2" />
                        Loading issues…
                      </div>
                    ) : releaseModalIssues.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6 text-center text-[color:var(--text-muted)] text-xs">
                        No issues linked to this version. Link issues from the ticket view (Fix version) first.
                      </div>
                    ) : (
                      <ul className="rounded-xl border border-[color:var(--border-subtle)] overflow-auto flex-1 min-h-0 divide-y divide-[color:var(--border-subtle)]/70">
                        {releaseModalIssues.map((issue) => (
                          <li key={issue._id} className="flex gap-3 px-4 py-3 bg-[color:var(--bg-surface)] hover:bg-[color:var(--bg-elevated)] transition items-start">
                            <label className="flex items-center gap-2 shrink-0 cursor-pointer pt-0.5">
                              <input
                                type="checkbox"
                                checked={releaseModalCheckedIds.has(issue._id)}
                                onChange={() => toggleReleaseModalCheck(issue._id)}
                                className="rounded border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-[color:var(--accent)] focus:ring-[color:var(--accent)]"
                              />
                            </label>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline gap-2">
                                <span className="font-mono text-xs text-[color:var(--text-primary)]">{getIssueKey(issue)}</span>
                                <span className="font-medium text-[color:var(--text-primary)] text-xs truncate">{issue.title}</span>
                              </div>
                              {issue.description && (
                                <p className="text-[color:var(--text-muted)] text-xs mt-1 line-clamp-2">{issue.description}</p>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 pt-2 shrink-0 border-t border-[color:var(--border-subtle)]">
                    {releaseModalVersion.releasedAtByEnvironment?.[releaseModalSelectedEnvId] && (
                      <p className="text-amber-400 text-xs">Already released to this environment.</p>
                    )}
                    <button
                      type="button"
                      onClick={submitReleaseModal}
                      disabled={!releaseModalSelectedEnvId || releaseModalSubmitting || !!releaseModalVersion.releasedAtByEnvironment?.[releaseModalSelectedEnvId]}
                      className="px-4 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)] disabled:opacity-50 transition"
                    >
                      {releaseModalSubmitting ? 'Releasing…' : 'Create release'}
                    </button>
                    <button type="button" onClick={closeReleaseModal} className="px-4 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)] transition">
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {releaseNotesModal && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto backdrop-blur-md"
          style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}
          onClick={() => setReleaseNotesModal(null)}
        >
          <div
            className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl shadow-2xl w-full max-h-[90vh] flex flex-col mx-auto my-auto"
            style={{ maxWidth: 'min(64rem, 95vw)' }}
            onClick={(e) => e.stopPropagation()}
          >
          <div className="p-5 border-b border-[color:var(--border-subtle)] flex items-center justify-between shrink-0">
            <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">Release notes · {releaseNotesModal.versionName} → {releaseNotesModal.envName}</h3>
            <button type="button" onClick={() => setReleaseNotesModal(null)} className="p-2 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)]">×</button>
          </div>
          {releaseNotesModal.updatedCount > 0 && (
            <p className="px-5 py-2 text-xs text-[color:var(--text-muted)] border-b border-[color:var(--border-subtle)]">{releaseNotesModal.updatedCount} issue(s) updated.</p>
          )}
          <div className="p-5 overflow-auto flex-1 min-h-0">
            <div
              ref={releaseNotesExportRef}
              className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden"
            >
              <div className="px-6 py-5 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-sm font-semibold text-[color:var(--text-primary)] truncate">
                    {project?.name ?? 'Project'}
                  </span>
                  <span className="text-xs text-[color:var(--text-muted)]">Release notes</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[color:var(--text-muted)]">
                  <span className="text-[color:var(--text-primary)] font-medium">{releaseNotesModal.versionName}</span>
                  <span>→</span>
                  <span className="text-[color:var(--text-primary)] font-medium">{releaseNotesModal.envName}</span>
                  <span className="opacity-70">·</span>
                  <span>{new Date().toLocaleString()}</span>
                </div>
              </div>
              <div className="px-6 py-5">
                <ReleaseNotesContent notes={releaseNotesModal.notes} projectId={projectId ?? ''} contentRef={releaseNotesContentRef} />
              </div>
            </div>
          </div>
          <div className="p-5 border-t border-[color:var(--border-subtle)] shrink-0 flex flex-wrap items-center gap-2">
            <button type="button" onClick={downloadReleaseNotesAsImage} className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)] transition">
              Download as image
            </button>
            <button type="button" onClick={downloadReleaseNotesAsPdf} className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)] transition">
              Download as PDF
            </button>
            <button type="button" onClick={copyReleaseNotesAsMarkdown} className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)] transition">
              Copy as Markdown
            </button>
            <button type="button" onClick={copyReleaseNotesAsHtml} className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)] transition">
              Copy as HTML
            </button>
            <button type="button" onClick={() => setReleaseNotesModal(null)} className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)] ml-auto">
              Close
            </button>
          </div>
        </div>
        </div>,
        document.body
      )}
    </div>
  );
}
