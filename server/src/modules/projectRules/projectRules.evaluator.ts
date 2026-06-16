import type { IProject, IProjectRule, IProjectStatus } from '../projects/project.model';
import { PROJECT_PERMISSIONS } from '../../shared/constants/permissions';

export type RuleActionType =
  | 'issue.create'
  | 'issue.update'
  | 'issue.status_change'
  | 'issue.enter_work_lane'
  | 'worklog.create'
  | 'comment.create'
  | 'estimate.submit';

export interface RuleEvaluationContext {
  project: IProject | Record<string, unknown>;
  issue: Record<string, unknown>;
  action: RuleActionType;
  userId: string;
  memberPermissions: string[];
  payload?: Record<string, unknown>;
  oldIssue?: Record<string, unknown>;
  dryRun?: boolean;
}

export interface RuleViolation {
  ruleId: string;
  ruleName: string;
  message: string;
  mode: 'log' | 'enforce';
}

export interface RuleEvaluationResult {
  allowed: boolean;
  violations: RuleViolation[];
  logOnly: RuleViolation[];
  requiredFields: string[];
  notifyEvents: string[];
}

function getStatuses(project: Record<string, unknown>): IProjectStatus[] {
  return (project.statuses as IProjectStatus[] | undefined) ?? [];
}

function statusByName(project: Record<string, unknown>, name: string): IProjectStatus | undefined {
  return getStatuses(project).find((s) => s.name === name);
}

function getFieldValue(ctx: RuleEvaluationContext, field: string): unknown {
  const { issue, payload, oldIssue } = ctx;
  const project = ctx.project as Record<string, unknown>;
  if (field === 'estimate.pending') {
    return payload?.hasPendingEstimate === true;
  }
  if (field === 'estimate.lanePending') {
    return payload?.lanePending === true;
  }
  if (field === 'estimate.laneApproved') {
    return payload?.laneApproved === true;
  }
  if (field === 'worklog.exceedsApproved') {
    return payload?.exceedsApproved === true;
  }
  if (field === 'status.userInLane') {
    const st = statusByName(project, String(issue.status ?? ''));
    return st?.userInLane ?? '';
  }
  if (field === 'status.enteringWorkLane') {
    return payload?.enteringWorkLane === true;
  }
  if (field === 'issue.hasParent') {
    return !!issue.parent;
  }
  if (field.startsWith('issue.')) {
    const key = field.slice('issue.'.length);
    return issue[key];
  }
  if (field.startsWith('old.')) {
    const key = field.slice('old.'.length);
    return oldIssue?.[key];
  }
  return undefined;
}

function matchCondition(ctx: RuleEvaluationContext, cond: { field: string; op: string; value?: unknown }): boolean {
  const actual = getFieldValue(ctx, cond.field);
  switch (cond.op) {
    case 'eq':
      return actual === cond.value;
    case 'neq':
      return actual !== cond.value;
    case 'exists':
      return actual != null && actual !== '';
    case 'gt':
      return Number(actual) > Number(cond.value ?? 0);
    default:
      return false;
  }
}

function ruleMatchesTrigger(rule: IProjectRule, action: RuleActionType): boolean {
  const map: Record<RuleActionType, RuleTrigger[]> = {
    'issue.create': ['issue.created'],
    'issue.update': ['issue.updated'],
    'issue.status_change': ['issue.updated'],
    'issue.enter_work_lane': ['issue.updated'],
    'worklog.create': ['worklog.creating'],
    'comment.create': ['comment.creating'],
    'estimate.submit': ['estimate.submitted'],
  };
  return map[action]?.includes(rule.trigger) ?? false;
}

type RuleTrigger = IProjectRule['trigger'];

function isRulesActive(project: Record<string, unknown>): boolean {
  if (process.env.PROJECT_RULES_ENABLED === 'false') return false;
  return !!(project.estimateApprovalEnabled || ((project.projectRules as IProjectRule[] | undefined)?.length ?? 0) > 0);
}

export function detectEnteringWorkLane(
  project: Record<string, unknown>,
  oldStatus: string | undefined,
  newStatus: string | undefined
): { entering: boolean; laneId?: string } {
  const oldSt = oldStatus ? statusByName(project, oldStatus) : undefined;
  const newSt = newStatus ? statusByName(project, newStatus) : undefined;
  const newLane = newSt?.userInLane;
  if (!newLane) return { entering: false };
  if (oldSt?.userInLane === newLane && oldStatus === newStatus) return { entering: false };
  if (oldSt?.userInLane === newLane) return { entering: false };
  return { entering: true, laneId: newLane };
}

export function evaluateProjectRules(ctx: RuleEvaluationContext): RuleEvaluationResult {
  const project = ctx.project as Record<string, unknown>;
  if (!isRulesActive(project)) {
    return { allowed: true, violations: [], logOnly: [], requiredFields: [], notifyEvents: [] };
  }

  const globalMode = (project.rulesEnforcementMode as 'log' | 'enforce') ?? 'enforce';
  const rules = ([...(project.projectRules as IProjectRule[] | undefined) ?? []] as IProjectRule[])
    .filter((r) => r.enabled)
    .sort((a, b) => a.order - b.order);

  const violations: RuleViolation[] = [];
  const logOnly: RuleViolation[] = [];
  const requiredFields: string[] = [];
  const notifyEvents: string[] = [];

  for (const rule of rules) {
    if (!ruleMatchesTrigger(rule, ctx.action)) continue;
    const conditions = rule.conditions ?? [];
    if (conditions.length > 0 && !conditions.every((c) => matchCondition(ctx, c))) continue;

    const effectiveMode = rule.mode ?? globalMode;

    for (const action of rule.actions ?? []) {
      if (action.type === 'deny') {
        if (action.unlessPermission && ctx.memberPermissions.includes(action.unlessPermission)) continue;
        const v: RuleViolation = {
          ruleId: rule.id,
          ruleName: rule.name,
          message: action.message,
          mode: effectiveMode,
        };
        if (effectiveMode === 'log') logOnly.push(v);
        else violations.push(v);
      }
      if (action.type === 'require_field') {
        requiredFields.push(action.field);
      }
      if (action.type === 'notify') {
        notifyEvents.push(action.eventKey);
      }
    }
  }

  if (requiredFields.length > 0 && ctx.payload) {
    for (const field of requiredFields) {
      const val = ctx.payload[field];
      if (val == null || val === '') {
        violations.push({
          ruleId: 'require_field',
          ruleName: 'Required field',
          message: `${field} is required`,
          mode: globalMode,
        });
      }
    }
  }

  const blocking = violations.filter((v) => v.mode === 'enforce');
  return {
    allowed: blocking.length === 0,
    violations: blocking,
    logOnly,
    requiredFields,
    notifyEvents,
  };
}

export function buildWorkLaneContext(
  project: Record<string, unknown>,
  issue: Record<string, unknown>,
  oldIssue: Record<string, unknown> | undefined,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  const oldStatus = oldIssue?.status as string | undefined;
  const newStatus = issue.status as string | undefined;
  const lane = detectEnteringWorkLane(project, oldStatus, newStatus);
  return {
    ...extra,
    enteringWorkLane: lane.entering,
    targetLaneId: lane.laneId,
  };
}

export const RULE_PERMISSIONS = {
  APPROVE: PROJECT_PERMISSIONS.ISSUE.ESTIMATE.APPROVE,
  SUBMIT: PROJECT_PERMISSIONS.ISSUE.ESTIMATE.SUBMIT,
  COMMENT: PROJECT_PERMISSIONS.ISSUE.COMMENT.CREATE,
};
