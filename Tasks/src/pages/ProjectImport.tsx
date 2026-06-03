import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { projectsApi, type ImportJobStatus, type Project } from '../lib/api';

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
          <span className="text-[color:var(--text-muted)]">Reporter email (creator on imported issues)</span>
          <input
            type="email"
            value={reporterEmail}
            onChange={(e) => setReporterEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
          />
        </label>

        <label className="flex items-center gap-2 text-xs text-[color:var(--text-primary)]">
          <input type="checkbox" checked={skipExisting} onChange={(e) => setSkipExisting(e.target.checked)} />
          Skip items already imported (external id)
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
              placeholder="Optional WIQL"
              value={adoWiql}
              onChange={(e) => setAdoWiql(e.target.value)}
              rows={2}
              className="sm:col-span-2 rounded-md border border-[color:var(--border-subtle)] px-3 py-2 text-xs font-mono"
            />
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
          <div className="text-sm border-t border-[color:var(--border-subtle)] pt-3">
            <p>
              Job <span className="font-mono text-xs">{job.jobId}</span> — {job.status}
            </p>
            {job.progress && <p className="text-[color:var(--text-muted)]">{job.progress}</p>}
            {job.error && <p className="text-red-500">{job.error}</p>}
            {job.result != null && (
              <pre className="text-[11px] mt-2 bg-[color:var(--bg-page)] p-3 rounded-md overflow-auto max-h-48">
                {JSON.stringify(job.result, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
