import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { projectsApi, type AdoImportResult, type ImportJobStatus, type Project } from '../lib/api';

type Source = 'ado' | 'csv' | 'jira';

export default function ProjectImport() {
  const { projectId } = useParams<{ projectId: string }>();
  const { token, user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [source, setSource] = useState<Source>('csv');
  const [reporterEmail, setReporterEmail] = useState(user?.email ?? '');
  const [skipExisting, setSkipExisting] = useState(true);
  const [csvContent, setCsvContent] = useState('');
  const [adoOrg, setAdoOrg] = useState('');
  const [adoProject, setAdoProject] = useState('');
  const [adoPat, setAdoPat] = useState('');
  const [adoWiql, setAdoWiql] = useState('');
  const [jiraJql, setJiraJql] = useState('');
  const [jiraBaseUrl, setJiraBaseUrl] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraToken, setJiraToken] = useState('');
  const [jiraProjectKey, setJiraProjectKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<unknown>(null);
  const [job, setJob] = useState<ImportJobStatus | null>(null);

  useEffect(() => {
    if (!token || !projectId) return;
    projectsApi.get(projectId, token).then((res) => {
      if (res.success && res.data) setProject(res.data);
    });
    projectsApi.getAdoIntegration(projectId, token).then((res) => {
      if (!res.success || !res.data) return;
      const d = res.data;
      if (d.org) setAdoOrg(d.org);
      if (d.adoProject) setAdoProject(d.adoProject);
      if (d.hasPat || d.org || d.adoProject) setSource('ado');
    });
  }, [token, projectId]);

  useEffect(() => {
    if (!job?.jobId || job.status === 'completed' || job.status === 'failed' || !token || !projectId) {
      return;
    }
    const t = setInterval(() => {
      projectsApi.getImportJob(projectId, job.jobId, token).then((res) => {
        if (res.success && res.data) setJob(res.data);
      });
    }, 2000);
    return () => clearInterval(t);
  }, [job?.jobId, job?.status, token, projectId]);

  function buildBody(dryRun: boolean) {
    const options: Record<string, unknown> = { skipExisting };
    if (source === 'ado') {
      if (adoOrg) options.org = adoOrg;
      if (adoProject) options.adoProject = adoProject;
      if (adoPat) options.pat = adoPat;
      if (adoWiql) options.wiql = adoWiql;
    }
    if (source === 'jira') {
      if (jiraJql) options.jql = jiraJql;
      if (jiraBaseUrl) options.baseUrl = jiraBaseUrl;
      if (jiraEmail) options.email = jiraEmail;
      if (jiraToken) options.apiToken = jiraToken;
      if (jiraProjectKey) options.jiraProjectKey = jiraProjectKey;
    }
    return {
      source,
      reporterEmail,
      dryRun,
      skipExisting,
      csvContent: source === 'csv' ? csvContent : undefined,
      options,
    };
  }

  async function runDryRun() {
    if (!token || !projectId) return;
    setBusy(true);
    setMessage('');
    setPreview(null);
    const res = await projectsApi.startImport(projectId, buildBody(true), token);
    setBusy(false);
    if (res.success && res.data?.preview) {
      setPreview(res.data.preview);
      setMessage('Dry run completed — no data was written.');
    } else {
      setMessage(res.message ?? 'Dry run failed');
    }
  }

  async function runImport() {
    if (!token || !projectId) return;
    setBusy(true);
    setMessage('');
    setPreview(null);
    setJob(null);
    const res = await projectsApi.startImport(projectId, buildBody(false), token);
    setBusy(false);
    if (res.success && res.data?.jobId) {
      setJob({ jobId: res.data.jobId, status: res.data.status ?? 'pending' });
      setMessage('Import started. Polling for status…');
    } else if (res.success && res.data?.dryRun) {
      setPreview(res.data.preview);
    } else {
      setMessage(res.message ?? 'Import failed to start');
    }
  }

  function onCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvContent(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  function renderImportResult(result: unknown) {
    if (!result || typeof result !== 'object') return null;
    const r = result as AdoImportResult;
    const rows: Array<[string, number]> = [
      ['Created', r.created],
      ['Updated', r.updated],
      ['Skipped (existing)', r.skippedExisting],
      ['History imported', r.historyImported ?? 0],
      ['Attachments imported', r.attachmentsImported ?? 0],
      ['Parent links set', r.parentsSet ?? 0],
      ['Related links', r.linksCreated ?? 0],
      ['Errors', r.errors],
    ];
    return (
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2"
          >
            <p className="text-[10px] uppercase tracking-wide text-[color:var(--text-muted)]">{label}</p>
            <p className="text-lg font-semibold tabular-nums text-[color:var(--text-primary)]">{value}</p>
          </div>
        ))}
      </div>
    );
  }

  const jobRunning = job?.status === 'pending' || job?.status === 'running';

  return (
    <div className="flex-1 min-h-0 p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-[color:var(--text-primary)]">
          Import issues {project ? `· ${project.name}` : ''}
        </h1>
        <p className="text-sm text-[color:var(--text-muted)] mt-1">
          Import from Azure DevOps, CSV, or Jira. Use dry run to preview counts before writing.
        </p>
        {projectId && (
          <Link
            to={`/projects/${projectId}/settings`}
            className="text-sm text-[color:var(--accent)] hover:underline mt-2 inline-block"
          >
            ← Project settings
          </Link>
        )}
      </div>

      <div className="space-y-4 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5 card-shadow">
        <label className="block text-xs">
          <span className="text-[color:var(--text-muted)]">Source</span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as Source)}
            className="mt-1 w-full rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
          >
            <option value="csv">CSV file</option>
            <option value="ado">Azure DevOps</option>
            <option value="jira">Jira</option>
          </select>
        </label>

        <label className="block text-xs">
          <span className="text-[color:var(--text-muted)]">Reporter email (Taskflow user for import audit only)</span>
          <input
            type="email"
            value={reporterEmail}
            onChange={(e) => setReporterEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
          />
          <p className="mt-1 text-[10px] text-[color:var(--text-muted)]">
            Does not filter which tasks are imported. ADO imports all work items in the project; assignees are mapped from ADO when the user exists in Taskflow.
          </p>
        </label>

        <label className="flex items-center gap-2 text-xs text-[color:var(--text-primary)]">
          <input type="checkbox" checked={skipExisting} onChange={(e) => setSkipExisting(e.target.checked)} />
          Skip already-imported items (uncheck to update existing tasks from ADO)
        </label>

        {source === 'csv' && (
          <div className="space-y-2">
            <input type="file" accept=".csv,text/csv" onChange={onCsvFile} className="text-sm" />
            <p className="text-[10px] text-[color:var(--text-muted)]">
              Expected columns: title, status, type, priority, assignee, storyPoints, labels, key, parent, externalId
            </p>
            <textarea
              value={csvContent}
              onChange={(e) => setCsvContent(e.target.value)}
              rows={6}
              placeholder="Or paste CSV here…"
              className="w-full rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-xs font-mono"
            />
          </div>
        )}

        {source === 'ado' && (
          <div className="space-y-3">
            <p className="text-xs text-[color:var(--text-muted)]">
              Imports <strong>all work items</strong> in the ADO project (not filtered by user). Uses saved Azure DevOps sync credentials if fields are left empty. No notification emails are sent during import.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
            <input
              placeholder="Organization (or env AZURE_DEVOPS_ORG)"
              value={adoOrg}
              onChange={(e) => setAdoOrg(e.target.value)}
              className="rounded-md border border-[color:var(--border-subtle)] px-3 py-2 text-sm"
            />
            <input
              placeholder="ADO project (or env)"
              value={adoProject}
              onChange={(e) => setAdoProject(e.target.value)}
              className="rounded-md border border-[color:var(--border-subtle)] px-3 py-2 text-sm"
            />
            <input
              type="password"
              placeholder="PAT (or env)"
              value={adoPat}
              onChange={(e) => setAdoPat(e.target.value)}
              className="rounded-md border border-[color:var(--border-subtle)] px-3 py-2 text-sm sm:col-span-2"
            />
            <textarea
              placeholder="Optional WIQL (leave empty to import all project work items)"
              value={adoWiql}
              onChange={(e) => setAdoWiql(e.target.value)}
              rows={2}
              className="sm:col-span-2 rounded-md border border-[color:var(--border-subtle)] px-3 py-2 text-xs font-mono"
            />
          </div>
          </div>
        )}

        {source === 'jira' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              placeholder="Base URL"
              value={jiraBaseUrl}
              onChange={(e) => setJiraBaseUrl(e.target.value)}
              className="sm:col-span-2 rounded-md border border-[color:var(--border-subtle)] px-3 py-2 text-sm"
            />
            <input
              placeholder="Email"
              value={jiraEmail}
              onChange={(e) => setJiraEmail(e.target.value)}
              className="rounded-md border border-[color:var(--border-subtle)] px-3 py-2 text-sm"
            />
            <input
              type="password"
              placeholder="API token"
              value={jiraToken}
              onChange={(e) => setJiraToken(e.target.value)}
              className="rounded-md border border-[color:var(--border-subtle)] px-3 py-2 text-sm"
            />
            <input
              placeholder="Jira project key"
              value={jiraProjectKey}
              onChange={(e) => setJiraProjectKey(e.target.value)}
              className="rounded-md border border-[color:var(--border-subtle)] px-3 py-2 text-sm"
            />
            <input
              placeholder="JQL (optional)"
              value={jiraJql}
              onChange={(e) => setJiraJql(e.target.value)}
              className="rounded-md border border-[color:var(--border-subtle)] px-3 py-2 text-sm"
            />
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          <button type="button" disabled={busy} onClick={runDryRun} className="btn-secondary px-4 py-2 rounded-md text-sm">
            Dry run
          </button>
          <button type="button" disabled={busy} onClick={runImport} className="btn-primary px-4 py-2 rounded-md text-sm">
            Start import
          </button>
        </div>

        {message && <p className="text-sm text-[color:var(--text-muted)]">{message}</p>}
        {preview != null && (
          <pre className="text-[11px] bg-[color:var(--bg-page)] p-3 rounded-md overflow-auto max-h-48">
            {JSON.stringify(preview, null, 2)}
          </pre>
        )}
        {job && (
          <div className="text-sm border-t border-[color:var(--border-subtle)] pt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  job.status === 'completed'
                    ? 'bg-green-500/15 text-green-600'
                    : job.status === 'failed'
                      ? 'bg-red-500/15 text-red-600'
                      : jobRunning
                        ? 'bg-blue-500/15 text-blue-600'
                        : 'bg-[color:var(--bg-elevated)] text-[color:var(--text-muted)]'
                }`}
              >
                {job.status}
              </span>
              <span className="font-mono text-xs text-[color:var(--text-muted)]">{job.jobId}</span>
            </div>
            {job.progress && (
              <p className="text-[color:var(--text-primary)] font-medium">{job.progress}</p>
            )}
            {jobRunning && (
              <p className="text-xs text-[color:var(--text-muted)] animate-pulse">Import in progress…</p>
            )}
            {job.error && <p className="text-red-500">{job.error}</p>}
            {(job.logs?.length ?? 0) > 0 && (
              <div>
                <p className="text-xs font-medium text-[color:var(--text-muted)] mb-1">Import log</p>
                <div className="max-h-56 overflow-y-auto rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] p-3 font-mono text-[11px] leading-relaxed space-y-0.5">
                  {job.logs!.map((line, i) => (
                    <div key={`${i}-${line}`} className="text-[color:var(--text-primary)]">
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {job.result != null && job.status === 'completed' && (
              <div>
                <p className="text-xs font-medium text-[color:var(--text-muted)] mb-1">Summary</p>
                {renderImportResult(job.result)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
