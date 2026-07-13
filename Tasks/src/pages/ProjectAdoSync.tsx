import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { projectsApi, type Project } from '../lib/api';

export default function ProjectAdoSync() {
  const { projectId } = useParams<{ projectId: string }>();
  const { token } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [org, setOrg] = useState('');
  const [adoProject, setAdoProject] = useState('');
  const [pat, setPat] = useState('');
  const [hasPat, setHasPat] = useState(false);
  const [defaultWorkItemType, setDefaultWorkItemType] = useState('Task');
  const [statusMap, setStatusMap] = useState<Record<string, string>>({});
  const [webhookUrl, setWebhookUrl] = useState('');
  const [adoStates, setAdoStates] = useState<string[]>([]);
  const [adoTypes, setAdoTypes] = useState<string[]>([]);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [autoSyncIntervalMinutes, setAutoSyncIntervalMinutes] = useState(15);
  const [lastAutoSyncAt, setLastAutoSyncAt] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token || !projectId) return;
    projectsApi.get(projectId, token).then((res) => {
      if (res.success && res.data) setProject(res.data);
    });
    projectsApi.getAdoIntegration(projectId, token).then((res) => {
      if (!res.success || !res.data) return;
      const d = res.data;
      setEnabled(d.enabled);
      setOrg(d.org);
      setAdoProject(d.adoProject);
      setHasPat(d.hasPat);
      setDefaultWorkItemType(d.defaultWorkItemType || 'Task');
      setStatusMap(d.statusMap || {});
      setWebhookUrl(d.webhookUrl || '');
      setAutoSyncEnabled(!!d.autoSyncEnabled);
      setAutoSyncIntervalMinutes(d.autoSyncIntervalMinutes ?? 15);
      setLastAutoSyncAt(d.lastAutoSyncAt);
      if (d.org && d.adoProject && d.hasPat) {
        void loadAdoStates(d.org, d.adoProject, 'use-stored');
      }
    });
  }, [token, projectId]);

  async function loadAdoStates(orgName: string, projectName: string, patValue: string) {
    if (!token || !projectId) return;
    const res = await projectsApi.testAdoIntegration(
      projectId,
      { org: orgName, adoProject: projectName, pat: patValue },
      token
    );
    if (res.success && res.data) {
      setAdoStates(res.data.states || []);
      setAdoTypes(res.data.types || []);
    }
  }

  async function handleTest() {
    if (!token || !projectId) return;
    if (!pat && !hasPat) {
      setError('Enter a PAT to test the connection.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    const res = await projectsApi.testAdoIntegration(
      projectId,
      { org, adoProject, pat: pat || 'use-stored' },
      token
    );
    setBusy(false);
    if (res.success && res.data) {
      setAdoStates(res.data.states || []);
      setAdoTypes(res.data.types || []);
      setMessage(`Connection successful. Found ${res.data.states?.length ?? 0} ADO state(s).`);
    } else {
      setError(res.message ?? 'Connection test failed');
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !projectId) return;
    setBusy(true);
    setError('');
    setMessage('');
    const body: {
      enabled: boolean;
      org: string;
      adoProject: string;
      pat?: string;
      statusMap: Record<string, string>;
      defaultWorkItemType: string;
      autoSyncEnabled: boolean;
      autoSyncIntervalMinutes: number;
    } = {
      enabled,
      org,
      adoProject,
      statusMap,
      defaultWorkItemType,
      autoSyncEnabled,
      autoSyncIntervalMinutes,
    };
    if (pat.trim()) body.pat = pat.trim();
    const res = await projectsApi.saveAdoIntegration(projectId, body, token);
    setBusy(false);
    if (res.success && res.data) {
      setHasPat(res.data.hasPat);
      setWebhookUrl(res.data.webhookUrl || '');
      setLastAutoSyncAt(res.data.lastAutoSyncAt);
      setPat('');
      setMessage('Azure DevOps sync settings saved.');
    } else {
      setError(res.message ?? 'Failed to save settings');
    }
  }

  async function handleRunSyncNow() {
    if (!token || !projectId) return;
    setBusy(true);
    setError('');
    setMessage('');
    const res = await projectsApi.runAdoSyncNow(projectId, token);
    setBusy(false);
    if (res.success && res.data) {
      setMessage(
        `Sync complete. Created: ${res.data.created}, Updated: ${res.data.updated}, Skipped: ${res.data.skippedExisting}, History imported: ${res.data.historyImported ?? 0}, Attachments imported: ${res.data.attachmentsImported ?? 0}, Errors: ${res.data.errors}`
      );
      setLastAutoSyncAt(new Date().toISOString());
    } else {
      setError(res.message ?? 'Sync failed');
    }
  }

  const intervalOptions = [
    { value: 5, label: 'Every 5 minutes' },
    { value: 15, label: 'Every 15 minutes' },
    { value: 30, label: 'Every 30 minutes' },
    { value: 60, label: 'Every 1 hour' },
    { value: 120, label: 'Every 2 hours' },
    { value: 360, label: 'Every 6 hours' },
  ];

  function updateStatusMap(tfStatus: string, adoState: string) {
    setStatusMap((prev) => ({ ...prev, [tfStatus]: adoState }));
  }

  const tfStatuses = project?.statuses?.map((s) => s.name) ?? ['Backlog', 'Todo', 'In Progress', 'Done'];

  return (
    <div className="flex-1 min-h-0 p-6 max-w-3xl">
      <div className="mb-6">
        <Link
          to={`/projects/${projectId}/settings`}
          className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
        >
          ← Back to project settings
        </Link>
        <h1 className="text-lg font-semibold text-[color:var(--text-primary)] mt-2">
          Azure DevOps sync {project ? `· ${project.name}` : ''}
        </h1>
        <p className="text-sm text-[color:var(--text-muted)] mt-1">
          Two-way sync between Taskflow issues and Azure DevOps work items.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm">
          {message}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <label className="flex items-center gap-2 text-sm text-[color:var(--text-primary)]">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enable real-time sync
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-[color:var(--text-muted)] mb-1">ADO organization</label>
            <input
              className="w-full rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm"
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              placeholder="your-org"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-[color:var(--text-muted)] mb-1">ADO project</label>
            <input
              className="w-full rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm"
              value={adoProject}
              onChange={(e) => setAdoProject(e.target.value)}
              placeholder="MyProject"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-[color:var(--text-muted)] mb-1">
            Personal Access Token {hasPat ? '(saved — leave blank to keep)' : ''}
          </label>
          <input
            type="password"
            className="w-full rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm"
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            placeholder="Work Items (Read & Write)"
          />
        </div>

        <div>
          <label className="block text-xs text-[color:var(--text-muted)] mb-1">Default work item type</label>
          <input
            className="w-full rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm"
            value={defaultWorkItemType}
            onChange={(e) => setDefaultWorkItemType(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleTest}
            disabled={busy}
            className="px-3 py-2 rounded-md border border-[color:var(--border-subtle)] text-sm"
          >
            Load ADO states
          </button>
          <Link
            to={`/projects/${projectId}/import`}
            className="px-3 py-2 rounded-md border border-[color:var(--border-subtle)] text-sm inline-flex items-center"
          >
            Bulk import
          </Link>
        </div>

        <div className="rounded-lg border border-[color:var(--border-subtle)] p-4 bg-[color:var(--bg-surface)] space-y-3">
          <h2 className="text-sm font-medium text-[color:var(--text-primary)]">Auto sync interval</h2>
          <p className="text-xs text-[color:var(--text-muted)]">
            Periodically pull new and updated work items from Azure DevOps (creates missing users, updates assignees, labels, and status).
          </p>
          <label className="flex items-center gap-2 text-sm text-[color:var(--text-primary)]">
            <input
              type="checkbox"
              checked={autoSyncEnabled}
              onChange={(e) => setAutoSyncEnabled(e.target.checked)}
            />
            Enable scheduled auto sync
          </label>
          <div>
            <label className="block text-xs text-[color:var(--text-muted)] mb-1">Sync interval</label>
            <select
              className="w-full max-w-xs rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
              value={autoSyncIntervalMinutes}
              onChange={(e) => setAutoSyncIntervalMinutes(Number(e.target.value))}
              disabled={!autoSyncEnabled}
            >
              {intervalOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          {lastAutoSyncAt && (
            <p className="text-xs text-[color:var(--text-muted)]">
              Last auto sync: {new Date(lastAutoSyncAt).toLocaleString()}
            </p>
          )}
          <button
            type="button"
            onClick={handleRunSyncNow}
            disabled={busy || !enabled}
            className="px-3 py-2 rounded-md border border-[color:var(--border-subtle)] text-sm"
          >
            Run sync now
          </button>
        </div>

        <div>
          <h2 className="text-sm font-medium text-[color:var(--text-primary)] mb-2">Status mapping</h2>
          <p className="text-xs text-[color:var(--text-muted)] mb-2">
            Map each Taskflow status to an Azure DevOps state from your project.
          </p>
          {adoStates.length > 0 ? (
            <p className="text-xs text-[color:var(--text-muted)] mb-3">
              ADO states in project: {adoStates.join(', ')}
            </p>
          ) : (
            <p className="text-xs text-amber-500 mb-3">
              Click &quot;Load ADO states&quot; to fetch actual states from your DevOps project before mapping.
            </p>
          )}
          <div className="space-y-2">
            {tfStatuses.map((tfStatus) => (
              <div key={tfStatus} className="flex items-center gap-3">
                <span className="text-sm w-32 shrink-0">{tfStatus}</span>
                <span className="text-[color:var(--text-muted)]">→</span>
                <select
                  className="flex-1 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-2 py-1.5 text-sm"
                  value={statusMap[tfStatus] ?? ''}
                  onChange={(e) => updateStatusMap(tfStatus, e.target.value)}
                  disabled={adoStates.length === 0}
                >
                  <option value="">— select ADO state —</option>
                  {adoStates.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        {webhookUrl && (
          <div className="rounded-lg border border-[color:var(--border-subtle)] p-4 bg-[color:var(--bg-surface)]">
            <h2 className="text-sm font-medium text-[color:var(--text-primary)] mb-2">Service Hook setup</h2>
            <p className="text-xs text-[color:var(--text-muted)] mb-2">
              In Azure DevOps: Project Settings → Service hooks → Create → Web Hooks. Subscribe to{' '}
              <code className="text-[color:var(--text-primary)]">workitem.created</code> and{' '}
              <code className="text-[color:var(--text-primary)]">workitem.updated</code>.
            </p>
            <label className="block text-xs text-[color:var(--text-muted)] mb-1">Webhook URL</label>
            <input
              readOnly
              className="w-full rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-xs font-mono"
              value={webhookUrl}
              onFocus={(e) => e.target.select()}
            />
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 rounded-md bg-[color:var(--accent)] text-white text-sm font-medium disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save sync settings'}
        </button>
      </form>

      {adoTypes.length > 0 && (
        <p className="mt-4 text-xs text-[color:var(--text-muted)]">
          ADO work item types: {adoTypes.join(', ')}
        </p>
      )}
    </div>
  );
}
