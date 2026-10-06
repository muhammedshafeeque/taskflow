import type { ProjectMember, ProjectRule } from '../../lib/api';
import { ACTION_TYPES, NOTIFY_TARGETS } from './automationConstants';

export function describeAutomationRule(rule: ProjectRule, members: ProjectMember[]): string {
  const name = (id: string) => members.find((m) => m.user._id === id)?.user.name ?? id;
  const when = rule.trigger === 'issue.created' ? 'When created' : 'When updated';
  const ifs = rule.conditions.map((c) => `${c.field} ${c.op} ${c.op === 'exists' ? '' : String(c.value ?? '')}`.trim());
  const thens = rule.actions.map((a) => {
    if (a.type === 'assign') return `assign ${['reporter', 'lead'].includes(String(a.to)) ? a.to : name(String(a.to))}`;
    if (a.type === 'set_status') return `status → ${a.status}`;
    if (a.type === 'set_priority') return `priority → ${a.priority}`;
    if (a.type === 'add_label') return `label +${a.label}`;
    if (a.type === 'notify_users') return `notify ${(a.to as string[]).map((t) => (NOTIFY_TARGETS.some((n) => n.value === t) ? t : name(t))).join(', ')}`;
    if (a.type === 'webhook') return 'webhook';
    return a.type;
  });
  return `${when}${ifs.length ? ` if ${ifs.join(' and ')}` : ''} → ${thens.join(', ')}`;
}

export function isAutomationRule(rule: ProjectRule): boolean {
  return rule.actions.some((a) => ACTION_TYPES.some((t) => t.value === a.type));
}


