import crypto from 'crypto';
import mongoose from 'mongoose';
import { Issue } from '../issues/issue.model';
import { Project, type IProjectRule } from '../projects/project.model';
import { ProjectMember } from '../projects/projectMember.model';
import * as issueHistoryService from '../issues/issueHistory.service';
import { notifyUser, appUrl } from '../notifications/notificationDispatch.service';
import { notifyProjectRefresh } from '../../websocket';
import { assertSafeOutboundUrl } from '../../utils/safeUrl';
import { ruleConditionsMatch, type RuleEvaluationContext } from './projectRules.evaluator';
import { isProjectRulesGloballyEnabled } from './projectRules.service';

export const AUTOMATION_ACTION_TYPES = [
  'assign',
  'set_status',
  'set_priority',
  'add_label',
  'notify_users',
  'webhook',
] as const;

type AutomationTrigger = 'issue.created' | 'issue.updated';

type IssueDoc = Record<string, unknown> & {
  _id: unknown;
  key?: string;
  title?: string;
  status?: string;
  priority?: string;
  assignee?: unknown;
  reporter?: unknown;
  labels?: string[];
  project: unknown;
};

/** `{{issue.key}}`, `{{issue.title}}`, `{{issue.status}}`, `{{old.status}}`, `{{link}}` */
function render(template: string, issue: IssueDoc, oldIssue: IssueDoc | undefined, link: string): string {
  return template.replace(/\{\{\s*(issue|old)\.(\w+)\s*\}\}|\{\{\s*link\s*\}\}/g, (m, scope, key) => {
    if (!scope) return link;
    const src = scope === 'old' ? oldIssue : issue;
    const v = src?.[key];
    return v == null ? '' : String(v);
  });
}

function idOf(v: unknown): string | undefined {
  if (!v) return undefined;
  if (typeof v === 'object' && v !== null && '_id' in v) return String((v as { _id: unknown })._id);
  return String(v);
}

async function resolveUsers(
  targets: string[],
  issue: IssueDoc,
  project: { lead?: unknown },
  projectId: string
): Promise<string[]> {
  const out = new Set<string>();
  for (const t of targets) {
    if (t === 'assignee') {
      const a = idOf(issue.assignee);
      if (a) out.add(a);
    } else if (t === 'reporter') {
      const r = idOf(issue.reporter);
      if (r) out.add(r);
    } else if (t === 'lead') {
      const l = idOf(project.lead);
      if (l) out.add(l);
    } else if (mongoose.Types.ObjectId.isValid(t)) {
      out.add(t);
    }
  }
  if (!out.size) return [];
  // Only notify people who are actually on the project.
  const members = await ProjectMember.find({ project: projectId, user: { $in: [...out] } }).distinct('user');
  const memberSet = new Set(members.map(String));
  const lead = idOf(project.lead);
  return [...out].filter((u) => memberSet.has(u) || u === lead);
}

/**
 * Runs the side-effect ("automation") actions of matching rules after an issue
 * has been saved. Changes are written with `updateOne`, so they never re-enter
 * `issues.update` — automations cannot trigger each other in a loop.
 */
export async function runIssueAutomations(params: {
  trigger: AutomationTrigger;
  issueId: string;
  actorId: string;
  oldIssue?: Record<string, unknown>;
}): Promise<void> {
  if (!isProjectRulesGloballyEnabled()) return;
  const issue = (await Issue.findById(params.issueId).lean()) as IssueDoc | null;
  if (!issue) return;
  const projectId = String(issue.project);
  const project = await Project.findById(projectId).select('projectRules rulesEnforcementMode lead statuses priorities key').lean();
  if (!project) return;

  const rules = ((project.projectRules ?? []) as IProjectRule[])
    .filter((r) => r.enabled && r.trigger === params.trigger)
    .filter((r) => (r.actions ?? []).some((a) => (AUTOMATION_ACTION_TYPES as readonly string[]).includes(a.type)))
    .sort((a, b) => a.order - b.order);
  if (!rules.length) return;

  const ctx: RuleEvaluationContext = {
    project: project as unknown as Record<string, unknown>,
    issue,
    oldIssue: params.oldIssue,
    action: params.trigger === 'issue.created' ? 'issue.create' : 'issue.update',
    userId: params.actorId,
    memberPermissions: [],
  };

  const statuses = new Set(((project.statuses ?? []) as Array<{ name: string }>).map((s) => s.name));
  const priorities = new Set(((project.priorities ?? []) as Array<{ name: string }>).map((p) => p.name));
  const link = appUrl(`/projects/${projectId}/issues/${encodeURIComponent(issue.key ?? String(issue._id))}`) ?? '';
  const set: Record<string, unknown> = {};
  const addLabels: string[] = [];
  const history: Array<{ field: string; fromValue: unknown; toValue: unknown }> = [];

  for (const rule of rules) {
    if (!ruleConditionsMatch(rule, ctx)) continue;
    const mode = rule.mode ?? project.rulesEnforcementMode ?? 'enforce';
    for (const action of rule.actions ?? []) {
      if (!(AUTOMATION_ACTION_TYPES as readonly string[]).includes(action.type)) continue;
      if (mode === 'log') {
        console.log(`[automation] (log only) rule "${rule.name}" would run ${action.type} on ${issue.key ?? issue._id}`);
        continue;
      }
      try {
        switch (action.type) {
          case 'assign': {
            const target =
              action.to === 'reporter' ? idOf(issue.reporter) : action.to === 'lead' ? idOf(project.lead) : action.to;
            if (!target || !mongoose.Types.ObjectId.isValid(target) || target === idOf(issue.assignee)) break;
            const isMember =
              target === idOf(project.lead) || (await ProjectMember.exists({ project: projectId, user: target }));
            if (!isMember) break;
            set.assignee = new mongoose.Types.ObjectId(target);
            history.push({ field: 'assignee', fromValue: idOf(issue.assignee) ?? null, toValue: target });
            break;
          }
          case 'set_status':
            if (action.status && action.status !== issue.status && (!statuses.size || statuses.has(action.status))) {
              set.status = action.status;
              set.boardColumn = action.status;
              history.push({ field: 'status', fromValue: issue.status, toValue: action.status });
            }
            break;
          case 'set_priority':
            if (action.priority && action.priority !== issue.priority && (!priorities.size || priorities.has(action.priority))) {
              set.priority = action.priority;
              history.push({ field: 'priority', fromValue: issue.priority, toValue: action.priority });
            }
            break;
          case 'add_label':
            if (action.label && !(issue.labels ?? []).includes(action.label)) addLabels.push(action.label.trim());
            break;
          case 'notify_users': {
            const users = await resolveUsers(action.to ?? [], issue, project, projectId);
            const body = render(action.message || 'Rule "{{rule}}" matched {{issue.key}}', issue, params.oldIssue as IssueDoc, link).replace(
              '{{rule}}',
              rule.name
            );
            await Promise.all(
              users
                .filter((u) => u !== params.actorId)
                .map((userId) =>
                  notifyUser({
                    userId,
                    eventKey: 'task_updated',
                    title: `${issue.key ?? 'Issue'}: ${rule.name}`,
                    body,
                    link,
                    metadata: { issueId: String(issue._id), projectId, ruleId: rule.id },
                  }).catch(() => undefined)
                )
            );
            break;
          }
          case 'webhook': {
            const url = assertSafeOutboundUrl(action.url, 'Automation webhook URL');
            const payload = JSON.stringify({
              event: params.trigger,
              rule: { id: rule.id, name: rule.name },
              project: { id: projectId, key: project.key },
              issue: {
                id: String(issue._id),
                key: issue.key,
                title: issue.title,
                status: issue.status,
                priority: issue.priority,
                assignee: idOf(issue.assignee) ?? null,
                url: link,
              },
              previous: params.oldIssue ? { status: params.oldIssue.status, priority: params.oldIssue.priority } : undefined,
              timestamp: new Date().toISOString(),
            });
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (action.secret) {
              headers['X-Atrium-Signature'] = crypto.createHmac('sha256', action.secret).update(payload).digest('hex');
            }
            fetch(url, { method: 'POST', headers, body: payload, redirect: 'error', signal: AbortSignal.timeout(10_000) }).catch(
              (err) => console.error(`[automation] webhook for rule "${rule.name}" failed:`, err)
            );
            break;
          }
        }
      } catch (err) {
        console.error(`[automation] rule "${rule.name}" action ${action.type} failed:`, err);
      }
    }
  }

  if (!Object.keys(set).length && !addLabels.length) return;
  const update: Record<string, unknown> = {};
  if (Object.keys(set).length) update.$set = set;
  if (addLabels.length) {
    update.$addToSet = { labels: { $each: addLabels } };
    history.push({ field: 'labels', fromValue: (issue.labels ?? []).join(', '), toValue: [...(issue.labels ?? []), ...addLabels].join(', ') });
  }
  await Issue.updateOne({ _id: issue._id }, update);
  await issueHistoryService.recordFieldChanges(String(issue._id), params.actorId, history).catch(() => undefined);
  notifyProjectRefresh(projectId);
}
