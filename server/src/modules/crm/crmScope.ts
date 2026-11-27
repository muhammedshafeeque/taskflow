/**
 * Record-level access for CRM leads and deals (AUT-29).
 *
 * CRM permissions say what someone may do with leads and deals; the CRM scope codes say whose:
 *   own        — leads assigned to you and deals you own (no scope code held)
 *   team       — also those of people who report to you (any depth) and members of teams you lead
 *   department — also those of everyone in your department(s)
 *   all        — every lead and deal in the workspace
 * Ownership is the lead's assignee and the deal's owner. Unassigned leads and deals without an owner
 * are reached only with "all". Records outside reach answer 404, as if they did not exist.
 */
import mongoose from 'mongoose';
import type { Request } from 'express';
import { ApiError } from '../../utils/ApiError';
import { reachFor, reachOf, scopeLevel, type Reach } from '../hrms/dataScope';
import { requireWorkspaceId, toOrgOid } from './crmWorkspace';
import { CrmLead } from './models/crmLead.model';
import { CrmDeal } from './models/crmDeal.model';

export type CrmReach = Reach;
type ScopedReq = Request & { activeOrganizationId?: string; user?: { id: string; permissions?: string[] } };

const oid = (v: string) => new mongoose.Types.ObjectId(v);
const idOf = (v: unknown): string | null => {
  if (v == null || v === '') return null;
  const raw = typeof v === 'object' && v && '_id' in v ? (v as { _id: unknown })._id : v;
  return raw == null ? null : String(raw);
};

/** The signed-in user's CRM reach (null = everyone), worked out once per request. */
export function crmReachFor(req: ScopedReq): Promise<CrmReach> {
  return reachFor(req, 'crm');
}

/** CRM reach for a viewer outside a request (search, record graph). */
export function crmReachOf(orgOid: mongoose.Types.ObjectId, viewer: { userId: string; permissions: string[] }): Promise<CrmReach> {
  return reachOf(orgOid, viewer.userId, scopeLevel(viewer.permissions, 'crm'));
}

/** True when a person (lead assignee or deal owner) is within reach. */
export function crmReaches(reach: CrmReach, personId: unknown): boolean {
  if (reach === null) return true;
  const id = idOf(personId);
  return id != null && reach.userIds.has(id);
}

/** Mongo filter for leads within reach. */
export function leadScopeFilter(reach: CrmReach): Record<string, unknown> {
  if (reach === null) return {};
  return { assigneeId: { $in: [...reach.userIds].map(oid) } };
}

/** Mongo filter for deals within reach. */
export function dealScopeFilter(reach: CrmReach): Record<string, unknown> {
  if (reach === null) return {};
  return { ownerId: { $in: [...reach.userIds].map(oid) } };
}

/** 404 unless the lead (or a lead merged into it) exists and is within reach. */
export async function assertLeadInReach(workspaceId: string | null | undefined, reach: CrmReach, id: string): Promise<void> {
  if (reach === null) return;
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  if (!mongoose.isValidObjectId(id)) throw new ApiError(404, 'Lead not found');
  const lead =
    (await CrmLead.findOne({ _id: id, taskflowOrganizationId: orgOid }).select('assigneeId').lean()) ??
    (await CrmLead.findOne({ taskflowOrganizationId: orgOid, mergedLeadIds: oid(id) }).select('assigneeId').lean());
  if (!lead || !crmReaches(reach, lead.assigneeId)) throw new ApiError(404, 'Lead not found');
}

/** 404 unless the deal exists and is within reach. */
export async function assertDealInReach(workspaceId: string | null | undefined, reach: CrmReach, id: string): Promise<void> {
  if (reach === null) return;
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  if (!mongoose.isValidObjectId(id)) throw new ApiError(404, 'Deal not found');
  const deal = await CrmDeal.findOne({ _id: id, taskflowOrganizationId: orgOid }).select('ownerId').lean();
  if (!deal || !crmReaches(reach, deal.ownerId)) throw new ApiError(404, 'Deal not found');
}

/**
 * Who a new or edited lead/deal may be given to. With a limited reach the person must be within it,
 * so nobody hands a record to someone outside their team (or leaves it unassigned and loses it).
 * Returns the person to save: the requested one, or the actor when none is given on create.
 */
export function assignableOwner(
  reach: CrmReach,
  requested: unknown,
  actorId: string,
  opts: { creating: boolean; what: 'lead' | 'deal' }
): string | null | undefined {
  const given = requested === undefined ? undefined : idOf(requested);
  if (reach === null) return given;
  const label = opts.what === 'lead' ? 'assign leads' : 'give deals';
  if (given === undefined) return opts.creating ? actorId : undefined;
  if (given === null) throw new ApiError(403, `Your access reaches only your own ${opts.what}s, so it cannot be left without an ${opts.what === 'lead' ? 'assignee' : 'owner'}`);
  if (!crmReaches(reach, given)) throw new ApiError(403, `You can only ${label} to yourself or people in your team`);
  return given;
}

/**
 * Duplicate warnings still say a matching lead exists when it is outside reach (so nobody creates a
 * second copy), but show only its status, why it matched and who has it, not the customer's details.
 */
export function redactLeadDuplicates<T extends { assigneeId?: string; assigneeName?: string; reasons: unknown; status: string; _id: string; updatedAt?: unknown }>(
  reach: CrmReach,
  leads: T[]
): Array<T | (Pick<T, '_id' | 'status' | 'reasons' | 'updatedAt' | 'assigneeName'> & { title: string; outOfScope: true })> {
  if (reach === null) return leads;
  return leads.map((l) =>
    crmReaches(reach, l.assigneeId)
      ? l
      : {
          _id: l._id,
          status: l.status,
          reasons: l.reasons,
          updatedAt: l.updatedAt,
          assigneeName: l.assigneeName,
          title: l.assigneeName ? `A lead assigned to ${l.assigneeName}` : 'An unassigned lead',
          outOfScope: true as const,
        }
  ) as never;
}
