/**
 * Stage rules for leads and deals (AUT-32). Each workspace chooses whether stages may be skipped
 * and whether records may move back; closing always needs a reason (lost deals, unqualified leads).
 * The defaults keep the old behaviour (any order) until an administrator tightens them.
 */
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from './crmWorkspace';
import { CrmStageRules } from './models/crmStageRules.model';
import type { CrmLeadStatus } from './leads/leads.constants';
import { logAudit } from '../auditLogs/logAudit';

export type FlowRules = { allowSkip: boolean; allowBack: boolean };
export type StageRulesView = { leads: FlowRules; deals: FlowRules; updatedAt: Date | null };

const DEFAULT: FlowRules = { allowSkip: true, allowBack: true };

export async function getStageRules(orgId: string): Promise<StageRulesView> {
  const doc = await CrmStageRules.findOne({ taskflowOrganizationId: toOrgOid(orgId) }).lean();
  return {
    leads: { ...DEFAULT, ...(doc?.leads ?? {}) },
    deals: { ...DEFAULT, ...(doc?.deals ?? {}) },
    updatedAt: doc?.updatedAt ?? null,
  };
}

function parseFlow(raw: unknown, where: string): Partial<FlowRules> {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object') throw new ApiError(400, `${where} must be an object`);
  const r = raw as Record<string, unknown>;
  const out: Partial<FlowRules> = {};
  if (r.allowSkip !== undefined) out.allowSkip = Boolean(r.allowSkip);
  if (r.allowBack !== undefined) out.allowBack = Boolean(r.allowBack);
  return out;
}

export async function saveStageRules(workspaceId: string | null | undefined, input: Record<string, unknown>, actorUserId: string) {
  const orgId = requireWorkspaceId(workspaceId);
  const $set: Record<string, unknown> = { updatedBy: new mongoose.Types.ObjectId(actorUserId) };
  for (const [k, v] of Object.entries(parseFlow(input.leads, 'leads'))) $set[`leads.${k}`] = v;
  for (const [k, v] of Object.entries(parseFlow(input.deals, 'deals'))) $set[`deals.${k}`] = v;
  await CrmStageRules.updateOne(
    { taskflowOrganizationId: toOrgOid(orgId) },
    { $set, $setOnInsert: { taskflowOrganizationId: toOrgOid(orgId) } },
    { upsert: true }
  );
  logAudit({ userId: actorUserId, action: 'crm.stage_rules.update', resourceType: 'crm_stage_rules', resourceId: orgId, meta: input });
  return getStageRules(orgId);
}

/** The main path a lead moves along; nurturing and unqualified are side states. */
export const LEAD_PATH: CrmLeadStatus[] = ['new', 'contacted', 'discovery', 'qualified', 'proposal_requested'];

/**
 * Refuse a lead status change the rules don't allow. Nurturing can be entered from any open stage
 * and left to any open stage; unqualified can be entered from any open stage (with a reason) and
 * reopened to New; converted is only reached by converting.
 */
export function assertLeadMove(rules: FlowRules, from: CrmLeadStatus, to: CrmLeadStatus): void {
  if (from === to) return;
  if (to === 'converted') throw new ApiError(400, 'Convert the lead to a deal to mark it converted');
  if (from === 'converted') throw new ApiError(400, 'Converted leads cannot change status');
  if (to === 'nurturing' || to === 'unqualified') return;
  if (from === 'unqualified') {
    if (to === 'new' || rules.allowBack) return;
    throw new ApiError(400, 'An unqualified lead can only be reopened as New');
  }
  if (from === 'nurturing') return;
  const a = LEAD_PATH.indexOf(from);
  const b = LEAD_PATH.indexOf(to);
  if (b < a && !rules.allowBack) throw new ApiError(400, `Leads can't move back from ${label(from)} to ${label(to)} in this workspace`);
  if (b > a + 1 && !rules.allowSkip) {
    throw new ApiError(400, `Leads move one stage at a time in this workspace: from ${label(from)} the next stage is ${label(LEAD_PATH[a + 1])}`);
  }
}

type Stage = { _id?: unknown; name?: string; order: number; isWon?: boolean; isLost?: boolean };

/**
 * Refuse a deal stage move the rules don't allow. Closing as won or lost is always allowed from an
 * open stage; leaving a won or lost stage (reopening) counts as moving back.
 */
export function assertDealMove(rules: FlowRules, stages: Stage[], fromId: unknown, toId: unknown): void {
  if (String(fromId) === String(toId)) return;
  const from = stages.find((s) => String(s._id) === String(fromId));
  const to = stages.find((s) => String(s._id) === String(toId));
  if (!to) throw new ApiError(400, 'Invalid stage');
  if (!from) return; // the old stage was removed from the pipeline: any stage is fine
  const closed = (s: Stage) => Boolean(s.isWon || s.isLost);
  if (closed(to) && !closed(from)) return;
  if (closed(from)) {
    if (rules.allowBack) return;
    throw new ApiError(400, "Closed deals can't be reopened in this workspace");
  }
  const open = stages.filter((s) => !closed(s)).sort((x, y) => x.order - y.order);
  const a = open.findIndex((s) => String(s._id) === String(from._id));
  const b = open.findIndex((s) => String(s._id) === String(to._id));
  if (b < a && !rules.allowBack) throw new ApiError(400, `Deals can't move back from ${from.name} to ${to.name} in this workspace`);
  if (b > a + 1 && !rules.allowSkip) throw new ApiError(400, `Deals move one stage at a time in this workspace: from ${from.name} the next stage is ${open[a + 1]?.name}`);
}

/** Lost deals and unqualified leads must say why. */
export function requireReason(reason: unknown, what: 'lost' | 'unqualified'): string {
  const r = String(reason ?? '').trim();
  if (!r) throw new ApiError(400, what === 'lost' ? 'Say why the deal was lost' : 'Say why the lead is unqualified');
  return r.slice(0, 500);
}

const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
