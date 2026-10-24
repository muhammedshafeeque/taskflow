import { useState } from 'react';
import type { ProjectMember, ProjectRule } from '../../lib/api';
import { ACTION_TYPES, NOTIFY_TARGETS } from './automationConstants';
import { PersonMultiSelect, PersonSelect, toPeople } from '../people';

const inputClass =
  'w-full px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-xs placeholder-[color:var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40 transition';
const labelClass = 'block text-xs font-medium text-[color:var(--text-primary)] mb-1.5';
const smallBtn =
  'px-2.5 py-1 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs hover:bg-[color:var(--bg-surface)] disabled:opacity-50';

type Condition = ProjectRule['conditions'][number];
type Action = Record<string, unknown> & { type: string };

const CONDITION_FIELDS: Array<{ value: string; label: string; kind: 'status' | 'priority' | 'type' | 'text' | 'user' }> = [
  { value: 'issue.status', label: 'Status', kind: 'status' },
  { value: 'old.status', label: 'Previous status', kind: 'status' },
  { value: 'issue.priority', label: 'Priority', kind: 'priority' },
  { value: 'issue.type', label: 'Type', kind: 'type' },
  { value: 'issue.assignee', label: 'Assignee', kind: 'user' },
  { value: 'issue.storyPoints', label: 'Story points', kind: 'text' },
];



function blankAction(type: string): Action {
  switch (type) {
    case 'assign':
      return { type, to: 'reporter' };
    case 'set_status':
      return { type, status: '' };
    case 'set_priority':
      return { type, priority: '' };
    case 'add_label':
      return { type, label: '' };
    case 'notify_users':
      return { type, to: ['assignee'], message: '{{issue.key}} is now {{issue.status}}' };
    default:
      return { type: 'webhook', url: '', secret: '' };
  }
}

export default function AutomationRuleBuilder({
  statuses,
  priorities,
  issueTypes,
  members,
  nextOrder,
  initial,
  onSave,
  onCancel,
}: {
  statuses: string[];
  priorities: string[];
  issueTypes: string[];
  members: ProjectMember[];
  nextOrder: number;
  initial?: ProjectRule | null;
  onSave: (rule: ProjectRule) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [trigger, setTrigger] = useState<'issue.created' | 'issue.updated'>(
    initial?.trigger === 'issue.created' ? 'issue.created' : 'issue.updated'
  );
  const [conditions, setConditions] = useState<Condition[]>(initial?.conditions ?? []);
  const [actions, setActions] = useState<Action[]>((initial?.actions as Action[]) ?? [blankAction('assign')]);
  const [mode, setMode] = useState<'log' | 'enforce'>(initial?.mode ?? 'enforce');
  const [error, setError] = useState('');

  const optionsFor = (field: string): string[] | null => {
    const kind = CONDITION_FIELDS.find((f) => f.value === field)?.kind;
    if (kind === 'status') return statuses;
    if (kind === 'priority') return priorities;
    if (kind === 'type') return issueTypes;
    return null;
  };

  const patchCondition = (i: number, patch: Partial<Condition>) =>
    setConditions((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const patchAction = (i: number, patch: Record<string, unknown>) =>
    setActions((prev) => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  function save() {
    if (!name.trim()) return setError('Give the rule a name.');
    if (!actions.length) return setError('Add at least one action.');
    for (const a of actions) {
      if (a.type === 'set_status' && !a.status) return setError('Pick a status for "Set status".');
      if (a.type === 'set_priority' && !a.priority) return setError('Pick a priority for "Set priority".');
      if (a.type === 'add_label' && !String(a.label ?? '').trim()) return setError('Enter a label.');
      if (a.type === 'webhook' && !/^https:\/\//.test(String(a.url ?? ''))) return setError('Webhook URL must start with https://');
      if (a.type === 'notify_users' && !(a.to as string[]).length) return setError('Choose who to notify.');
    }
    // A status rule that fires on its own target status would loop on every edit; require a guard.
    const selfStatus = trigger === 'issue.updated' && actions.some((a) => a.type === 'set_status') && !conditions.length;
    if (selfStatus) return setError('Add a condition to status-changing rules on "updated" (e.g. Status = Review).');
    const cleanedActions = actions.map((a) => (a.type === 'webhook' && !a.secret ? { type: a.type, url: a.url } : a));
    onSave({
      id: initial?.id ?? `auto-${Date.now().toString(36)}`,
      name: name.trim(),
      enabled: initial?.enabled ?? true,
      order: initial?.order ?? nextOrder,
      mode,
      trigger,
      conditions: conditions.filter((c) => c.field),
      actions: cleanedActions,
    });
  }

  return (
    <div className="rounded-xl border border-[color:var(--accent)]/40 bg-[color:var(--bg-page)] p-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <div>
          <label className={labelClass}>Rule name</label>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Auto-assign bugs to QA lead" />
        </div>
        <div>
          <label className={labelClass}>When an issue is</label>
          <select className={inputClass} value={trigger} onChange={(e) => setTrigger(e.target.value as typeof trigger)}>
            <option value="issue.created">Created</option>
            <option value="issue.updated">Updated</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Mode</label>
          <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="enforce">Run</option>
            <option value="log">Log only (dry run)</option>
          </select>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className={labelClass + ' mb-0'}>If (all must match)</span>
          <button type="button" className={smallBtn} onClick={() => setConditions((c) => [...c, { field: 'issue.type', op: 'eq', value: issueTypes[0] ?? '' }])}>
            + Condition
          </button>
        </div>
        {!conditions.length && <p className="text-[11px] text-[color:var(--text-muted)]">No conditions — runs for every issue.</p>}
        <div className="space-y-2">
          {conditions.map((c, i) => {
            const opts = optionsFor(c.field);
            const isUser = c.field === 'issue.assignee';
            return (
              <div key={i} className="grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-center">
                <select className={inputClass} value={c.field} onChange={(e) => patchCondition(i, { field: e.target.value, value: '' })}>
                  {CONDITION_FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
                <select className={`${inputClass} w-auto`} value={c.op} onChange={(e) => patchCondition(i, { op: e.target.value })}>
                  <option value="eq">is</option>
                  <option value="neq">is not</option>
                  <option value="exists">is set</option>
                  <option value="gt">greater than</option>
                </select>
                {c.op === 'exists' ? (
                  <span />
                ) : opts ? (
                  <select className={inputClass} value={String(c.value ?? '')} onChange={(e) => patchCondition(i, { value: e.target.value })}>
                    <option value="">Select…</option>
                    {opts.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                ) : isUser ? (
                  <PersonSelect
                    size="sm"
                    value={String(c.value ?? '')}
                    onChange={(v) => patchCondition(i, { value: v })}
                    people={toPeople(members.map((m) => m.user))}
                    placeholder="Select person…"
                    aria-label="Person"
                  />
                ) : (
                  <input
                    className={inputClass}
                    value={String(c.value ?? '')}
                    onChange={(e) => patchCondition(i, { value: c.op === 'gt' ? Number(e.target.value) : e.target.value })}
                  />
                )}
                <button type="button" className={smallBtn} onClick={() => setConditions((prev) => prev.filter((_, j) => j !== i))} aria-label="Remove condition">
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className={labelClass + ' mb-0'}>Then</span>
          <button type="button" className={smallBtn} onClick={() => setActions((a) => [...a, blankAction('notify_users')])}>
            + Action
          </button>
        </div>
        <div className="space-y-2">
          {actions.map((a, i) => (
            <div key={i} className="grid grid-cols-[auto_1fr_auto] gap-2 items-start">
              <select className={`${inputClass} w-auto`} value={a.type} onChange={(e) => setActions((prev) => prev.map((x, j) => (j === i ? blankAction(e.target.value) : x)))}>
                {ACTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <div className="space-y-1.5">
                {a.type === 'assign' && (
                  <PersonSelect
                    size="sm"
                    value={String(a.to ?? '')}
                    onChange={(v) => patchAction(i, { to: v })}
                    people={toPeople(members.map((m) => m.user))}
                    specialOptions={[
                      { value: 'reporter', label: 'Reporter', hint: 'Whoever raised the issue' },
                      { value: 'lead', label: 'Project lead' },
                    ]}
                    aria-label="Assign to"
                  />
                )}
                {a.type === 'set_status' && (
                  <select className={inputClass} value={String(a.status ?? '')} onChange={(e) => patchAction(i, { status: e.target.value })}>
                    <option value="">Select status…</option>
                    {statuses.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                )}
                {a.type === 'set_priority' && (
                  <select className={inputClass} value={String(a.priority ?? '')} onChange={(e) => patchAction(i, { priority: e.target.value })}>
                    <option value="">Select priority…</option>
                    {priorities.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                )}
                {a.type === 'add_label' && (
                  <input className={inputClass} value={String(a.label ?? '')} onChange={(e) => patchAction(i, { label: e.target.value })} placeholder="needs-triage" />
                )}
                {a.type === 'notify_users' && (
                  <>
                    <PersonMultiSelect
                      size="sm"
                      values={a.to as string[]}
                      onChange={(to) => patchAction(i, { to })}
                      people={toPeople(members.map((m) => m.user))}
                      specialOptions={NOTIFY_TARGETS}
                      placeholder="Who should be notified?"
                      aria-label="Notify"
                    />
                    <input
                      className={inputClass}
                      value={String(a.message ?? '')}
                      onChange={(e) => patchAction(i, { message: e.target.value })}
                      placeholder="{{issue.key}} moved from {{old.status}} to {{issue.status}}"
                    />
                  </>
                )}
                {a.type === 'webhook' && (
                  <>
                    <input className={inputClass} value={String(a.url ?? '')} onChange={(e) => patchAction(i, { url: e.target.value })} placeholder="https://example.com/hooks/atrium" />
                    <input
                      className={inputClass}
                      value={String(a.secret ?? '')}
                      onChange={(e) => patchAction(i, { secret: e.target.value })}
                      placeholder="Signing secret (optional, sent as X-Atrium-Signature HMAC-SHA256)"
                    />
                  </>
                )}
              </div>
              <button type="button" className={smallBtn} onClick={() => setActions((prev) => prev.filter((_, j) => j !== i))} aria-label="Remove action">
                ✕
              </button>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-[color:var(--text-muted)]">
          Placeholders: {'{{issue.key}} {{issue.title}} {{issue.status}} {{old.status}} {{link}} {{rule}}'}. Changes made by automations don't trigger other automations.
        </p>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" className={smallBtn} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          className="px-3 py-1 rounded-md bg-[color:var(--accent)] text-white text-xs font-medium hover:opacity-90"
        >
          {initial ? 'Update rule' : 'Add rule'}
        </button>
      </div>
    </div>
  );
}
