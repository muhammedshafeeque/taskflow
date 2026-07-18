import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import OrganizationSettingsPanel from '../components/OrganizationSettingsPanel';
import {
  adminSystemApi,
  organizationsApi,
  projectsApi,
  type AdminIntegrationConfigItem,
} from '../lib/api';
import { userHasPermission } from '../utils/permissions';
import { TASK_FLOW_PERMISSIONS } from '@shared/constants/permissions';
import { canAccessTaskflowWorkspaceSettings } from '../utils/taskflowWorkspaceSettingsAccess';

type TabId = 'organization' | 'integrations';

function canViewIntegrationsConfig(user: { permissions?: string[]; role?: string } | null) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return userHasPermission(user.permissions ?? [], TASK_FLOW_PERMISSIONS.TASKFLOW.LICENSE.VIEW);
}

export default function TaskflowWorkspaceSettings() {
  const { user, token, refreshUser } = useAuth();
  const [tab, setTab] = useState<TabId>('organization');
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [projectTotal, setProjectTotal] = useState<number | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  const [integrations, setIntegrations] = useState<AdminIntegrationConfigItem[]>([]);
  const [integrationKeys, setIntegrationKeys] = useState<string[]>([]);
  const [integrationsLoading, setIntegrationsLoading] = useState(false);
  const [integrationsError, setIntegrationsError] = useState<string | null>(null);

  const orgs = user?.organizations ?? [];
  const activeOrgId = user?.activeOrganizationId ?? orgs[0]?.id;
  const showIntegrationsTab = canViewIntegrationsConfig(user);
  const workspaceSettingsAllowed = canAccessTaskflowWorkspaceSettings(user);

  useEffect(() => {
    if (!showIntegrationsTab && tab === 'integrations') setTab('organization');
  }, [showIntegrationsTab, tab]);

  useEffect(() => {
    if (!token || !activeOrgId || user?.userType !== 'taskflow') {
      setMemberCount(null);
      setProjectTotal(null);
      return;
    }
    let cancelled = false;
    setUsageLoading(true);
    void (async () => {
      const [orgRes, projRes] = await Promise.all([
        organizationsApi.get(activeOrgId, token),
        projectsApi.list(1, 1, token),
      ]);
      if (cancelled) return;
      if (orgRes.success && orgRes.data?.members) {
        setMemberCount(orgRes.data.members.filter((m) => m.status === 'active').length);
      } else setMemberCount(null);
      if (projRes.success && projRes.data) {
        setProjectTotal(projRes.data.total);
      } else {
        setProjectTotal(null);
      }
      setUsageLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, activeOrgId, user?.userType]);

  useEffect(() => {
    if (!token || user?.userType !== 'taskflow' || !showIntegrationsTab) return;
    let cancelled = false;
    setIntegrationsLoading(true);
    setIntegrationsError(null);
    void adminSystemApi.getIntegrationsConfig(token).then((res) => {
      if (cancelled) return;
      setIntegrationsLoading(false);
      if (!res.success || !res.data) {
        setIntegrationsError((res as { message?: string }).message ?? 'Could not load integrations config');
        setIntegrations([]);
        setIntegrationKeys([]);
        return;
      }
      setIntegrations(res.data.items);
      setIntegrationKeys(res.data.sampleEnvKeys);
    });
    return () => {
      cancelled = true;
    };
  }, [token, user?.userType, showIntegrationsTab]);

  const copyEnvTemplate = useCallback(() => {
    const defaults = integrationKeys.map((k) => `${k}=false`);
    const block = [
      '# Integrations toggles',
      ...defaults,
      '',
      '# SMTP',
      'SMTP_HOST=',
      'SMTP_PORT=587',
      'SMTP_USER=',
      'SMTP_PASS=',
      'MAIL_FROM=noreply@your-domain.com',
      '',
      '# Slack',
      'SLACK_BOT_TOKEN=',
      'SLACK_SIGNING_SECRET=',
      'SLACK_DEFAULT_CHANNEL=#alerts',
      '',
      '# Teams',
      'TEAMS_WEBHOOK_URL=',
      '',
      '# Telegram',
      'TELEGRAM_BOT_TOKEN=',
      'TELEGRAM_CHAT_ID=',
      '',
      '# Jira',
      'JIRA_BASE_URL=',
      'JIRA_EMAIL=',
      'JIRA_API_TOKEN=',
      'JIRA_PROJECT_KEY=',
      '',
      '# Azure DevOps',
      'AZURE_DEVOPS_ORG_URL=',
      'AZURE_DEVOPS_PAT=',
      'AZURE_DEVOPS_PROJECT=',
      '',
      '# Google Auth',
      'GOOGLE_CLIENT_ID=',
      'GOOGLE_CLIENT_SECRET=',
      'GOOGLE_CALLBACK_URL=',
      '',
      '# Microsoft Auth',
      'AZURE_AD_CLIENT_ID=',
      'AZURE_AD_CLIENT_SECRET=',
      'AZURE_AD_TENANT_ID=common',
      'MICROSOFT_CALLBACK_URL=',
      '',
      '# GitHub',
      'GITHUB_CLIENT_ID=',
      'GITHUB_CLIENT_SECRET=',
      'GITHUB_WEBHOOK_SECRET=',
    ].join('\n');
    void navigator.clipboard.writeText(block);
  }, [integrationKeys]);

  const tabButtons = useMemo(() => {
    const items: { id: TabId; label: string }[] = [{ id: 'organization', label: 'Profile' }];
    if (showIntegrationsTab) items.push({ id: 'integrations', label: 'Integrations' });
    return items;
  }, [showIntegrationsTab]);

  if (!user || user.userType !== 'taskflow') {
    return (
      <div className="w-full px-4 lg:px-6 xl:px-8 py-6">
        <p className="text-sm text-[color:var(--text-muted)]">Organization settings are available for Atrium accounts.</p>
        <Link to="/users" className="mt-4 inline-block text-sm text-[color:var(--accent)]">
          ← Back to Auth
        </Link>
      </div>
    );
  }

  if (!token) {
    return null;
  }

  if (!workspaceSettingsAllowed) {
    return (
      <div className="w-full px-4 lg:px-6 xl:px-8 py-6 space-y-4">
        <h1 className="text-lg font-semibold text-[color:var(--text-primary)]">Organization settings</h1>
        <p className="text-sm text-[color:var(--text-muted)]">
          You do not have permission to view organization settings.
        </p>
        <Link to="/users" className="inline-block text-sm text-[color:var(--accent)] hover:underline">
          Back to Auth →
        </Link>
      </div>
    );
  }

  if (orgs.length === 0) {
    return (
      <div className="w-full px-4 lg:px-6 xl:px-8 py-6 space-y-4">
        <h1 className="text-lg font-semibold text-[color:var(--text-primary)]">Organization settings</h1>
        <p className="text-sm text-[color:var(--text-muted)]">
          You are not a member of an organization yet. Ask an admin to invite you.
        </p>
        <Link to="/" className="inline-block text-sm text-[color:var(--accent)] hover:underline">
          Back to Home →
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 px-4 lg:px-6 xl:px-8 py-4 lg:py-6 space-y-6">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-[color:var(--text-primary)]">Organization settings</h1>
        <p className="mt-1 text-sm text-[color:var(--text-muted)]">
          Company profile and environment integrations for your organization.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-[color:var(--border-subtle)] pb-2">
        {tabButtons.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setTab(b.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              tab === b.id
                ? 'bg-[color:var(--accent)]/15 text-[color:var(--accent)] ring-1 ring-[color:var(--accent)]/30'
                : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)]'
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      {tab === 'organization' && (
        <section className="space-y-6 min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">Organization</h2>

          <div className="max-w-2xl space-y-4 min-w-0">
            {activeOrgId && (
              <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-4 py-3 text-sm">
                <p className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Organization</p>
                <p className="mt-1 font-semibold text-[color:var(--text-primary)]">
                  {orgs.find((o) => o.id === activeOrgId)?.name ?? '—'}
                </p>
              </div>
            )}

            <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-4 py-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <span className="text-[color:var(--text-muted)]">
                Members:{' '}
                <strong className="text-[color:var(--text-primary)] tabular-nums">{usageLoading ? '…' : memberCount ?? '—'}</strong>
              </span>
              <span className="text-[color:var(--text-muted)]">
                Projects:{' '}
                <strong className="text-[color:var(--text-primary)] tabular-nums">{usageLoading ? '…' : projectTotal ?? '—'}</strong>
              </span>
            </div>

            <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-4 sm:p-5 min-w-0">
              <OrganizationSettingsPanel
                token={token}
                activeOrganizationId={activeOrgId}
                user={user}
                hideMembers
                onMembersChanged={() => {
                  void refreshUser();
                }}
              />
            </div>
          </div>
        </section>
      )}

      {tab === 'integrations' && showIntegrationsTab && (
        <section className="space-y-4 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">Integrations configuration</h2>
            <button
              type="button"
              onClick={copyEnvTemplate}
              className="rounded-md border border-[color:var(--border-subtle)] px-3 py-1.5 text-xs hover:bg-[color:var(--bg-surface)]"
            >
              Copy .env template
            </button>
          </div>
          <p className="text-xs text-[color:var(--text-muted)]">
            Control integrations via environment variables. Update `.env`, then restart the server to apply changes.
          </p>
          {integrationsError && (
            <div className="rounded-md border border-[color:var(--color-blocked)]/40 bg-[color:var(--color-blocked)]/10 px-3 py-2 text-xs text-[color:var(--color-blocked)]">
              {integrationsError}
            </div>
          )}
          {integrationsLoading && <p className="text-xs text-[color:var(--text-muted)]">Loading integrations…</p>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {integrations.map((item) => (
              <div key={item.id} className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-4">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <h3 className="text-xs font-semibold text-[color:var(--text-primary)]">{item.label}</h3>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] ${
                      item.configured
                        ? 'bg-[color:var(--color-done)]/15 text-[color:var(--color-done)]'
                        : 'bg-[color:var(--color-blocked)]/15 text-[color:var(--color-blocked)]'
                    }`}
                  >
                    {item.configured ? 'configured' : 'missing env'}
                  </span>
                </div>
                <p className="text-[11px] text-[color:var(--text-muted)] mb-1.5">
                  Enabled flag: <span className="font-mono">{item.enabled ? 'true' : 'false'}</span>
                </p>
                {item.notes && <p className="text-[11px] text-[color:var(--text-muted)] mb-2">{item.notes}</p>}
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">Required env keys</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {item.envKeys.map((k) => (
                    <span
                      key={k}
                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                        item.missingKeys.includes(k)
                          ? 'bg-[color:var(--color-blocked)]/15 text-[color:var(--color-blocked)]'
                          : 'bg-[color:var(--bg-surface)] text-[color:var(--text-primary)]'
                      }`}
                    >
                      {k}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-[11px] text-[color:var(--text-muted)]">
            After changing `.env`, restart the server process (`npm run dev`) to reload integration configs.
          </div>
        </section>
      )}

    </div>
  );
}
