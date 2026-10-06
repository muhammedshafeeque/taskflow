import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { monitorApi, type MonitorAlertDelivery, type MonitorAlertRule } from '../../lib/api';
import { monitorInputClass, useMonitorWorkspace } from './MonitorWorkspace';
import { ModuleHeader, StatusPill } from '../../components/moduleKit';
import SectionCard from '../../components/SectionCard';
import OnCallCard from '../../components/monitor/OnCallCard';

const TRIGGERS: Array<{ id: MonitorAlertRule['trigger']; label: string; hint: string }> = [
  { id: 'error_new', label: 'New error group', hint: 'First time this stack fingerprint is seen' },
  { id: 'error_spike', label: 'Error spike', hint: 'Too many errors in a time window' },
  { id: 'log_level', label: 'Log level', hint: 'error / fatal / warn (configurable)' },
  { id: 'http_status', label: 'HTTP status', hint: 'Status code in a range (default 500–599)' },
  { id: 'transaction_slow', label: 'Slow transaction', hint: 'Duration above a millisecond threshold' },
  { id: 'vital_threshold', label: 'Web vital', hint: 'LCP / INP / CLS / TTFB above a value' },
  { id: 'uptime_down', label: 'Uptime down', hint: 'Failed platform ping (optional streak)' },
  { id: 'event_name', label: 'Custom event', hint: 'Named analytics event' },
  { id: 'new_release', label: 'New release', hint: 'First time a version is ingested' },
];

const emptyForm = () => ({
  name: '',
  enabled: true,
  trigger: 'error_new' as MonitorAlertRule['trigger'],
  environmentId: '',
  appId: '',
  recipients: '',
  cooldownMinutes: '15',
  subjectTemplate: '[Monitor] {{project}} · {{trigger}}',
  bodyTemplate: '',
  logLevels: 'error,fatal',
  messageContains: '',
  minCount: '10',
  windowMinutes: '5',
  httpStatusMin: '500',
  httpStatusMax: '599',
  durationMs: '2000',
  vitalName: 'lcp',
  vitalGte: '2500',
  eventName: '',
  uptimeFailStreak: '1',
});

type FormState = ReturnType<typeof emptyForm>;

function conditionsFromForm(f: FormState): Record<string, unknown> {
  return {
    logLevels: f.logLevels.split(/[,\s]+/).filter(Boolean),
    messageContains: f.messageContains,
    minCount: Number(f.minCount),
    windowMinutes: Number(f.windowMinutes),
    httpStatusMin: Number(f.httpStatusMin),
    httpStatusMax: Number(f.httpStatusMax),
    durationMs: Number(f.durationMs),
    vitalName: f.vitalName,
    vitalGte: Number(f.vitalGte),
    eventName: f.eventName,
    uptimeFailStreak: Number(f.uptimeFailStreak),
  };
}

function formFromRule(rule: MonitorAlertRule): FormState {
  const c = rule.conditions ?? {};
  return {
    name: rule.name,
    enabled: rule.enabled !== false,
    trigger: rule.trigger,
    environmentId: typeof rule.environmentId === 'string' ? rule.environmentId : '',
    appId: typeof rule.appId === 'string' ? rule.appId : '',
    recipients: (rule.recipients ?? []).join(', '),
    cooldownMinutes: String(rule.cooldownMinutes ?? 15),
    subjectTemplate: rule.subjectTemplate || '[Monitor] {{project}} · {{trigger}}',
    bodyTemplate: rule.bodyTemplate || '',
    logLevels: Array.isArray(c.logLevels) ? c.logLevels.join(',') : 'error,fatal',
    messageContains: String(c.messageContains ?? ''),
    minCount: String(c.minCount ?? 10),
    windowMinutes: String(c.windowMinutes ?? 5),
    httpStatusMin: String(c.httpStatusMin ?? 500),
    httpStatusMax: String(c.httpStatusMax ?? 599),
    durationMs: String(c.durationMs ?? 2000),
    vitalName: String(c.vitalName ?? 'lcp'),
    vitalGte: String(c.vitalGte ?? 2500),
    eventName: String(c.eventName ?? ''),
    uptimeFailStreak: String(c.uptimeFailStreak ?? 1),
  };
}

function payload(f: FormState) {
  return {
    name: f.name,
    enabled: f.enabled,
    trigger: f.trigger,
    environmentId: f.environmentId || undefined,
    appId: f.appId || undefined,
    recipients: f.recipients,
    cooldownMinutes: Number(f.cooldownMinutes),
    subjectTemplate: f.subjectTemplate,
    bodyTemplate: f.bodyTemplate,
    conditions: conditionsFromForm(f),
  };
}

export default function MonitorAlerts() {
  const { token, user } = useAuth();
  const { projectId, project, envs, apps } = useMonitorWorkspace();
  const canManage = canAny(user, 'taskflow.monitor.alert.manage');
  const [rules, setRules] = useState<MonitorAlertRule[]>([]);
  const [deliveries, setDeliveries] = useState<MonitorAlertDelivery[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    if (!token || !projectId) return;
    Promise.all([monitorApi.listAlerts(projectId, token), monitorApi.alertDeliveries(projectId, token)]).then(([r, d]) => {
      if (r.success) setRules((r.data as MonitorAlertRule[]) ?? []);
      else setError(r.message || 'Could not load alert rules');
      if (d.success) setDeliveries((d.data as MonitorAlertDelivery[]) ?? []);
    });
  }, [token, projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = () => {
    if (!token) return;
    setError('');
    setNotice('');
    const body = payload(form);
    const req = editingId
      ? monitorApi.updateAlert(projectId, editingId, body, token)
      : monitorApi.createAlert(projectId, body, token);
    req.then((res) => {
      if (!res.success) {
        setError(res.message || 'Could not save rule');
        return;
      }
      setForm(emptyForm());
      setEditingId(null);
      load();
    });
  };

  return (
    <div className="w-full animate-fade-in space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <ModuleHeader
        eyebrow="Alerts"
        title="Email notifications"
        subtitle={`${project?.name ?? ''} · Rules fire automatically from ingest and uptime. Uses workspace email transport.`.trim()}
        accent="#f59e0b"
      />
      {projectId && <OnCallCard projectId={projectId} canManage={canManage} />}
      {error && <p className="text-sm text-rose-400">{error}</p>}
      {notice && <p className="text-sm text-emerald-400">{notice}</p>}

      {canManage && token && (
        <SectionCard
          title={editingId ? 'Edit rule' : 'New rule'}
          description="Choose a trigger, optional filters, recipients, cooldown, and email copy. Placeholders: {{project}} {{trigger}} {{message}} {{app}} {{environment}} {{url}} {{status}} {{durationMs}} {{level}} {{release}} {{eventName}} {{vitalName}} {{vitalValue}} {{openUrl}}."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[11px] font-medium text-[color:var(--text-muted)]">Name</span>
              <input className={monitorInputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[11px] font-medium text-[color:var(--text-muted)]">Trigger</span>
              <select className={monitorInputClass} value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value as FormState['trigger'] })}>
                {TRIGGERS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">{TRIGGERS.find((t) => t.id === form.trigger)?.hint}</p>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-[color:var(--text-muted)]">Environment</span>
              <select className={monitorInputClass} value={form.environmentId} onChange={(e) => setForm({ ...form, environmentId: e.target.value })}>
                <option value="">Any</option>
                {envs.map((env) => (
                  <option key={env._id} value={env._id}>
                    {env.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-[color:var(--text-muted)]">App</span>
              <select className={monitorInputClass} value={form.appId} onChange={(e) => setForm({ ...form, appId: e.target.value })}>
                <option value="">Any</option>
                {apps.map((app) => (
                  <option key={app._id} value={app._id}>
                    {app.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[11px] font-medium text-[color:var(--text-muted)]">Recipients (comma-separated)</span>
              <input className={monitorInputClass} placeholder="ops@example.com, oncall@example.com" value={form.recipients} onChange={(e) => setForm({ ...form, recipients: e.target.value })} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-[color:var(--text-muted)]">Cooldown (minutes)</span>
              <input className={monitorInputClass} value={form.cooldownMinutes} onChange={(e) => setForm({ ...form, cooldownMinutes: e.target.value })} />
            </label>
            <label className="flex items-end gap-2 pb-1">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
              <span className="text-[13px]">Enabled</span>
            </label>
            {form.trigger === 'log_level' && (
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-[11px] font-medium text-[color:var(--text-muted)]">Log levels</span>
                <input className={monitorInputClass} value={form.logLevels} onChange={(e) => setForm({ ...form, logLevels: e.target.value })} />
              </label>
            )}
            {form.trigger === 'error_spike' && (
              <>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-[color:var(--text-muted)]">Min errors</span>
                  <input className={monitorInputClass} value={form.minCount} onChange={(e) => setForm({ ...form, minCount: e.target.value })} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-[color:var(--text-muted)]">Window (minutes)</span>
                  <input className={monitorInputClass} value={form.windowMinutes} onChange={(e) => setForm({ ...form, windowMinutes: e.target.value })} />
                </label>
              </>
            )}
            {form.trigger === 'http_status' && (
              <>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-[color:var(--text-muted)]">Status min</span>
                  <input className={monitorInputClass} value={form.httpStatusMin} onChange={(e) => setForm({ ...form, httpStatusMin: e.target.value })} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-[color:var(--text-muted)]">Status max</span>
                  <input className={monitorInputClass} value={form.httpStatusMax} onChange={(e) => setForm({ ...form, httpStatusMax: e.target.value })} />
                </label>
              </>
            )}
            {form.trigger === 'transaction_slow' && (
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-[color:var(--text-muted)]">Duration ≥ ms</span>
                <input className={monitorInputClass} value={form.durationMs} onChange={(e) => setForm({ ...form, durationMs: e.target.value })} />
              </label>
            )}
            {form.trigger === 'vital_threshold' && (
              <>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-[color:var(--text-muted)]">Vital</span>
                  <select className={monitorInputClass} value={form.vitalName} onChange={(e) => setForm({ ...form, vitalName: e.target.value })}>
                    <option value="lcp">LCP</option>
                    <option value="inp">INP</option>
                    <option value="cls">CLS</option>
                    <option value="ttfb">TTFB</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-[color:var(--text-muted)]">Value ≥</span>
                  <input className={monitorInputClass} value={form.vitalGte} onChange={(e) => setForm({ ...form, vitalGte: e.target.value })} />
                </label>
              </>
            )}
            {form.trigger === 'event_name' && (
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-[11px] font-medium text-[color:var(--text-muted)]">Event name (blank = any)</span>
                <input className={monitorInputClass} value={form.eventName} onChange={(e) => setForm({ ...form, eventName: e.target.value })} />
              </label>
            )}
            {form.trigger === 'uptime_down' && (
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-[color:var(--text-muted)]">Fail streak</span>
                <input className={monitorInputClass} value={form.uptimeFailStreak} onChange={(e) => setForm({ ...form, uptimeFailStreak: e.target.value })} />
              </label>
            )}
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[11px] font-medium text-[color:var(--text-muted)]">Message contains (optional)</span>
              <input className={monitorInputClass} value={form.messageContains} onChange={(e) => setForm({ ...form, messageContains: e.target.value })} />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[11px] font-medium text-[color:var(--text-muted)]">Subject template</span>
              <input className={monitorInputClass} value={form.subjectTemplate} onChange={(e) => setForm({ ...form, subjectTemplate: e.target.value })} />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[11px] font-medium text-[color:var(--text-muted)]">Body template (optional plain text)</span>
              <textarea className={`${monitorInputClass} h-24 py-2`} value={form.bodyTemplate} onChange={(e) => setForm({ ...form, bodyTemplate: e.target.value })} />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" className="btn-primary btn-primary-sm" onClick={save}>
              {editingId ? 'Save changes' : 'Create rule'}
            </button>
            {editingId && (
              <button
                type="button"
                className="rounded-lg border border-[color:var(--border-subtle)] px-3 py-1.5 text-[13px]"
                onClick={() => {
                  setEditingId(null);
                  setForm(emptyForm());
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </SectionCard>
      )}

      <SectionCard title="Rules" description="Each rule is independent. Cooldown stops duplicate mail.">
        {rules.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-[color:var(--text-muted)]">No alert rules yet.</p>
        ) : (
          <ul className="space-y-2">
            {rules.map((rule) => (
              <li
                key={rule._id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2.5"
              >
                <div>
                  <p className="text-[13px] font-medium">
                    {rule.name}{' '}
                    <span className="ml-2 font-mono text-[11px] text-[color:var(--text-muted)]">{rule.trigger}</span>
                  </p>
                  <p className="text-[11px] text-[color:var(--text-muted)]">
                    {(rule.recipients ?? []).join(', ')} · cooldown {rule.cooldownMinutes}m · fired {rule.fireCount ?? 0}
                    {rule.lastError ? ` · ${rule.lastError}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill label={rule.enabled ? 'On' : 'Off'} tone={rule.enabled ? 'green' : 'slate'} />
                  {canManage && token && (
                    <>
                      <button
                        type="button"
                        className="text-[12px] text-cyan-300"
                        onClick={() => {
                          setEditingId(rule._id);
                          setForm(formFromRule(rule));
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-[12px] text-cyan-300"
                        onClick={() =>
                          monitorApi.testAlert(projectId, rule._id, token).then((r) => {
                            if (r.success) setNotice('Test email sent');
                            else setError(r.message || 'Test failed');
                            load();
                          })
                        }
                      >
                        Test
                      </button>
                      <button type="button" className="text-[12px] text-rose-400" onClick={() => monitorApi.deleteAlert(projectId, rule._id, token).then(load)}>
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Recent deliveries" description="Last 100 sends for this project (kept ~30 days).">
        {deliveries.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-[color:var(--text-muted)]">No emails sent yet.</p>
        ) : (
          <ul className="space-y-2">
            {deliveries.map((row) => (
              <li key={row._id} className="rounded-lg border border-[color:var(--border-subtle)] px-3 py-2 text-[12px]">
                <span className={row.ok ? 'text-emerald-400' : 'text-rose-400'}>{row.ok ? 'Sent' : 'Failed'}</span>
                {' · '}
                {row.subject}
                <span className="block text-[11px] text-[color:var(--text-muted)]">
                  {(row.recipients ?? []).join(', ')} · {row.timestamp ? new Date(row.timestamp).toLocaleString() : ''}
                  {row.error ? ` · ${row.error}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
