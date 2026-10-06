import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { portalApi, uploadFile, type ProjectMapping } from '../../lib/api';
import { FiArrowLeft, FiSend, FiPaperclip, FiX } from 'react-icons/fi';
import KbSuggestions from '../../components/portal/KbSuggestions';

const ALL_TYPES = ['bug', 'feature', 'suggestion', 'concern', 'other'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];

export default function NewRequest() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedProject = searchParams.get('projectId') ?? '';

  const [mappings, setMappings] = useState<ProjectMapping[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [projectsError, setProjectsError] = useState('');

  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [type, setType] = useState('');
  const [priority, setPriority] = useState('medium');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    setLoadingProjects(true);
    portalApi.listProjects(token).then((res) => {
      setLoadingProjects(false);
      if (res.success && res.data) {
        const active = res.data.mappings.filter((m) => m.status === 'active');
        setMappings(active);
        if (preselectedProject && active.some((m) => m.projectId._id === preselectedProject)) {
          setProjectId(preselectedProject);
        } else if (active.length === 1) setProjectId(active[0].projectId._id);
      } else {
        setProjectsError((res as { message?: string }).message ?? 'Failed to load projects');
      }
    });
  }, [token, preselectedProject]);

  const selectedMapping = mappings.find((m) => m.projectId._id === projectId);
  const allowedTypes =
    selectedMapping && selectedMapping.allowedRequestTypes.length > 0
      ? ALL_TYPES.filter((t) => selectedMapping.allowedRequestTypes.includes(t))
      : ALL_TYPES;

  // Reset type if it's no longer allowed after project change
  useEffect(() => {
    if (type && !allowedTypes.includes(type)) {
      setType('');
    }
  }, [projectId, allowedTypes, type]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (!projectId || !title.trim() || !type || !priority || !description.trim()) {
      setError('Please fill in all required fields.');
      return;
    }
    setError('');
    setSubmitting(true);
    const attachments: string[] = [];
    for (const file of files) {
      const up = await uploadFile(file, token);
      if (!up.success || !up.data?.url) {
        setSubmitting(false);
        setError((up as { message?: string }).message ?? `Failed to upload ${file.name}`);
        return;
      }
      attachments.push(up.data.url);
    }
    const res = await portalApi.createRequest(
      { projectId, title: title.trim(), description: description.trim(), type, priority, attachments },
      token
    );
    setSubmitting(false);
    if (res.success && res.data) {
      navigate(`/portal/requests/${res.data.request._id}`);
    } else {
      setError((res as { message?: string }).message ?? 'Failed to submit request');
    }
  }

  const labelClass = 'block text-sm font-medium text-[color:var(--text-primary)] mb-1.5';
  const inputClass =
    'w-full rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-4 py-3 text-base md:text-sm text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] transition focus:border-[color:var(--accent)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/30';

  return (
    <div className="p-4 md:p-8 animate-fade-in">
      <div className="mb-6">
        <button
          type="button"
          onClick={() => navigate('/portal/requests')}
          className="flex items-center gap-2 text-sm text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition mb-4"
        >
          <FiArrowLeft /> Back to Issues
        </button>
        <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">New issue</h1>
        <p className="text-sm text-[color:var(--text-muted)] mt-1">
          File project work. A Service Desk ticket and project issue are created after Atrium approval.
        </p>
      </div>

      <div className="max-w-2xl">
        {loadingProjects ? (
          <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-12 text-center text-[color:var(--text-muted)] animate-pulse">
            Loading projects…
          </div>
        ) : projectsError ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-400">
            {projectsError}
          </div>
        ) : mappings.length === 0 ? (
          <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-12 text-center text-sm text-[color:var(--text-muted)]">
            No active projects are mapped to your organisation. Contact your administrator.
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6 space-y-5"
          >
            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            {/* Project */}
            <div>
              <label className={labelClass}>
                Project <span className="text-red-400">*</span>
              </label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                required
                className={inputClass}
              >
                <option value="">Select a project…</option>
                {mappings.map((m) => (
                  <option key={m.projectId._id} value={m.projectId._id}>
                    {m.projectId.name} ({m.projectId.key})
                  </option>
                ))}
              </select>
            </div>

            {/* Title */}
            <div>
              <label className={labelClass}>
                Title <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="Brief summary of your request"
                className={inputClass}
              />
              {token && (
                <div className="mt-2">
                  <KbSuggestions query={`${title} ${description}`.slice(0, 300)} token={token} />
                </div>
              )}
            </div>

            {/* Type + Priority */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>
                  Type <span className="text-red-400">*</span>
                </label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  required
                  disabled={!projectId}
                  className={`${inputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <option value="">Select type…</option>
                  {allowedTypes.map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>
                  Priority <span className="text-red-400">*</span>
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  required
                  className={inputClass}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Description */}
            <div>
              <label className={labelClass}>
                Description <span className="text-red-400">*</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                rows={6}
                placeholder="Provide detailed information about your request…"
                className={`${inputClass} resize-y`}
              />
            </div>

            <div>
              <label className={labelClass}>Attachments</label>
              <input
                type="file"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                className="block w-full text-sm text-[color:var(--text-muted)] file:mr-3 file:min-h-11 file:px-4 file:rounded-lg file:border-0 file:bg-[color:var(--accent)]/15 file:text-[color:var(--accent)] file:font-medium"
              />
              {files.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {files.map((f, i) => (
                    <li
                      key={`${f.name}-${i}`}
                      className="flex items-center gap-2 text-sm rounded-lg border border-[color:var(--border-subtle)] px-3 py-2 min-h-11"
                    >
                      <FiPaperclip className="shrink-0 text-[color:var(--text-muted)]" />
                      <span className="truncate flex-1">{f.name}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${f.name}`}
                        className="w-11 h-11 flex items-center justify-center shrink-0 text-[color:var(--text-muted)] hover:text-red-400"
                        onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        <FiX />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Submit */}
            <div className="flex items-center justify-end gap-3 pt-2 sticky bottom-0 bg-[color:var(--bg-surface)] py-3 -mx-6 px-6 border-t border-[color:var(--border-subtle)] md:static md:border-0 md:py-0 md:mx-0 md:px-0">
              <button
                type="button"
                onClick={() => navigate('/portal/requests')}
                className="btn-secondary min-h-11"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="btn-primary flex items-center gap-2 min-h-11"
              >
                <FiSend />
                {submitting ? (files.length ? 'Uploading…' : 'Submitting…') : 'Submit issue'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
