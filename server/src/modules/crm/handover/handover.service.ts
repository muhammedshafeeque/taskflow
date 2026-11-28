/**
 * Sales-to-delivery handover (AUT-41). Winning a deal starts a checklist from the workspace template;
 * sales completes it and sends it to the project manager, who accepts it or returns it with a note.
 */
import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crmWorkspace';
import { CrmDeal } from '../models/crmDeal.model';
import { CrmHandover, CrmHandoverTemplate, DEFAULT_HANDOVER_ITEMS, type HandoverStatus } from '../models/crmHandover.model';
import { Project } from '../../projects/project.model';
import { OrganizationMember } from '../../organizations/organizationMember.model';
import { notifyUsers } from '../../notifications/domainNotify';
import { logAudit } from '../../auditLogs/logAudit';
import { crmReaches, type CrmReach } from '../crmScope';

type Oid = mongoose.Types.ObjectId;
const oid = (v: unknown) => new mongoose.Types.ObjectId(String(v));
const isId = (v: unknown) => v != null && mongoose.isValidObjectId(String(v));
/** States in which sales can still change the checklist. */
const EDITABLE: HandoverStatus[] = ['open', 'returned'];

// ── Template ───────────────────────────────────────────────────────────────

export async function getHandoverTemplate(ws: string | null | undefined) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const doc = await CrmHandoverTemplate.findOne({ taskflowOrganizationId: orgOid }).lean();
  return { items: doc?.items?.length ? doc.items.map((i) => ({ title: i.title, required: i.required !== false })) : DEFAULT_HANDOVER_ITEMS };
}

export async function saveHandoverTemplate(ws: string | null | undefined, input: { items?: unknown }) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  if (!Array.isArray(input.items)) throw new ApiError(400, 'items must be a list');
  const items = input.items
    .map((i) => (typeof i === 'string' ? { title: i } : (i as { title?: unknown; required?: unknown })))
    .map((i) => ({ title: String(i?.title ?? '').trim().slice(0, 200), required: i?.required !== false }))
    .filter((i) => i.title)
    .slice(0, 40);
  if (!items.length) throw new ApiError(400, 'Add at least one checklist item');
  await CrmHandoverTemplate.findOneAndUpdate({ taskflowOrganizationId: orgOid }, { $set: { items } }, { upsert: true });
  return getHandoverTemplate(ws);
}

// ── Lifecycle hooks (called by the deal service) ───────────────────────────

async function projectLead(projectId: unknown): Promise<Oid | undefined> {
  if (!isId(projectId)) return undefined;
  const p = await Project.findById(projectId).select('lead').lean();
  return (p as { lead?: Oid } | null)?.lead ?? undefined;
}

/**
 * Start the handover when a deal is won. Safe to call more than once; a handover cancelled by reopening
 * the deal is opened again. The project lead becomes the PM when the deal already has a project.
 */
export async function startHandover(orgId: string, dealId: unknown) {
  if (!isId(dealId)) return null;
  const orgOid = toOrgOid(orgId);
  const deal = await CrmDeal.findOne({ _id: dealId, taskflowOrganizationId: orgOid }).select('status projectId ownerId title').lean();
  if (!deal || deal.status !== 'won') return null;
  const existing = await CrmHandover.findOne({ dealId: deal._id });
  if (existing) {
    if (existing.status === 'cancelled') {
      existing.status = 'open';
      await existing.save();
    }
    return existing.toObject();
  }
  const { items } = await getHandoverTemplate(orgId);
  const pm = await projectLead(deal.projectId);
  try {
    const doc = await CrmHandover.create({
      taskflowOrganizationId: orgOid,
      dealId: deal._id,
      projectId: deal.projectId ?? undefined,
      pmUserId: pm,
      items,
      status: 'open',
    });
    if (deal.ownerId) {
      void notifyUsers([deal.ownerId], 'approval_requested', { title: `Hand over: ${deal.title}`, body: 'Complete the handover checklist and send it to the project manager.', link: `/crm/deals/${String(deal._id)}` });
    }
    return doc.toObject();
  } catch (err) {
    // Won twice at the same moment: the other call created it.
    if ((err as { code?: number }).code === 11000) return CrmHandover.findOne({ dealId: deal._id }).lean();
    throw err;
  }
}

/** The deal was reopened or lost: a handover that was not accepted yet no longer applies. */
export async function cancelHandover(orgId: string, dealId: unknown) {
  if (!isId(dealId)) return;
  await CrmHandover.updateOne({ taskflowOrganizationId: toOrgOid(orgId), dealId: oid(dealId), status: { $in: ['open', 'submitted', 'returned'] } }, { $set: { status: 'cancelled' } });
}

/** A delivery project was created for the deal: link it, and make its lead the PM unless one is chosen. */
export async function linkHandoverProject(orgId: string, dealId: unknown, projectId: unknown) {
  if (!isId(dealId) || !isId(projectId)) return;
  const h = await CrmHandover.findOne({ taskflowOrganizationId: toOrgOid(orgId), dealId: oid(dealId) });
  if (!h) return;
  h.projectId = oid(projectId);
  if (!h.pmUserId) h.pmUserId = await projectLead(projectId);
  await h.save();
}

// ── Reading ────────────────────────────────────────────────────────────────

const populate = <T extends { populate: (path: string, select: string) => T }>(q: T) =>
  q.populate('dealId', 'title value currency ownerId status').populate('projectId', 'name key').populate('pmUserId', 'name email').populate('items.doneBy', 'name').populate('submittedBy', 'name').populate('acceptedBy', 'name').populate('returnedBy', 'name');

async function load(orgId: string, filter: Record<string, unknown>) {
  return populate(CrmHandover.findOne({ taskflowOrganizationId: toOrgOid(orgId), ...filter })).lean();
}

/** The handover of a deal. A deal won before handovers existed gets one now. */
export async function getDealHandover(ws: string | null | undefined, dealId: string) {
  const orgId = requireWorkspaceId(ws);
  if (!isId(dealId)) throw new ApiError(404, 'Deal not found');
  const deal = await CrmDeal.findOne({ _id: dealId, taskflowOrganizationId: toOrgOid(orgId) }).select('status').lean();
  if (!deal) throw new ApiError(404, 'Deal not found');
  if (deal.status === 'won') await startHandover(orgId, dealId);
  return load(orgId, { dealId: oid(dealId) });
}

/** A handover by id, for its PM or for someone who can see the deal. */
export async function getHandover(ws: string | null | undefined, id: string, viewer: { userId: string; canReadDeals: boolean; reach: CrmReach }) {
  const orgId = requireWorkspaceId(ws);
  if (!isId(id)) throw new ApiError(404, 'Handover not found');
  const h = await load(orgId, { _id: oid(id) });
  if (!h) throw new ApiError(404, 'Handover not found');
  const pm = (h.pmUserId as { _id?: unknown } | null)?._id;
  const owner = (h.dealId as { ownerId?: unknown } | null)?.ownerId;
  if (String(pm) !== viewer.userId && !(viewer.canReadDeals && crmReaches(viewer.reach, owner))) throw new ApiError(404, 'Handover not found');
  return h;
}

/**
 * Handovers for a list: `mine` = those waiting for me as PM (or that I accepted); otherwise every
 * handover of deals within the viewer's CRM reach.
 */
export async function listHandovers(ws: string | null | undefined, query: { mine?: boolean; status?: string }, viewer: { userId: string; canReadDeals: boolean; reach: CrmReach }) {
  const orgId = requireWorkspaceId(ws);
  const orgOid = toOrgOid(orgId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: orgOid };
  if (query.status && (['open', 'submitted', 'returned', 'accepted', 'cancelled'] as string[]).includes(query.status)) filter.status = query.status;
  if (query.mine || !viewer.canReadDeals) filter.pmUserId = oid(viewer.userId);
  else if (viewer.reach !== null) {
    const deals = await CrmDeal.find({ taskflowOrganizationId: orgOid, ownerId: { $in: [...viewer.reach.userIds].map(oid) } }).distinct('_id');
    filter.dealId = { $in: deals };
  }
  return populate(CrmHandover.find(filter)).sort({ updatedAt: -1 }).limit(200).lean();
}

// ── Sales: fill in and send ────────────────────────────────────────────────

async function editableFor(orgId: string, dealId: string) {
  if (!isId(dealId)) throw new ApiError(404, 'Deal not found');
  await getDealHandover(orgId, dealId);
  const h = await CrmHandover.findOne({ taskflowOrganizationId: toOrgOid(orgId), dealId: oid(dealId) });
  if (!h) throw new ApiError(409, 'A handover starts when the deal is won');
  return h;
}

/**
 * Tick items, add notes or items, and choose the PM. Only before it is sent, or after it came back.
 * `items`: [{ id, done?, note? }]; `addItems`: titles to add; `removeItemIds`: optional items to drop.
 */
export async function updateHandover(ws: string | null | undefined, dealId: string, input: Record<string, unknown>, actorId: string) {
  const orgId = requireWorkspaceId(ws);
  const h = await editableFor(orgId, dealId);
  if (!EDITABLE.includes(h.status as HandoverStatus)) throw new ApiError(409, h.status === 'submitted' ? 'This handover is with the project manager' : `This handover is ${h.status}`);
  if (typeof input.notes === 'string') h.notes = input.notes.slice(0, 20_000);
  if (input.pmUserId !== undefined) {
    if (!input.pmUserId) h.pmUserId = undefined;
    else {
      if (!isId(input.pmUserId) || !(await OrganizationMember.exists({ organization: toOrgOid(orgId), user: oid(input.pmUserId), status: 'active' }))) {
        throw new ApiError(400, 'Choose a project manager who is a member of this workspace');
      }
      h.pmUserId = oid(input.pmUserId);
    }
  }
  if (Array.isArray(input.items)) {
    for (const change of input.items as Array<{ id?: unknown; done?: unknown; note?: unknown }>) {
      const item = h.items.find((i) => String(i._id) === String(change?.id));
      if (!item) throw new ApiError(400, 'Checklist item not found');
      if (change.done !== undefined && Boolean(change.done) !== item.done) {
        item.done = Boolean(change.done);
        item.doneBy = item.done ? oid(actorId) : undefined;
        item.doneAt = item.done ? new Date() : undefined;
      }
      if (typeof change.note === 'string') item.note = change.note.slice(0, 2000);
    }
  }
  if (Array.isArray(input.addItems)) {
    for (const t of input.addItems) {
      const title = String(t ?? '').trim().slice(0, 200);
      if (title) h.items.push({ title, required: false, done: false });
    }
    if (h.items.length > 60) throw new ApiError(400, 'A handover can have up to 60 items');
  }
  if (Array.isArray(input.removeItemIds)) {
    for (const id of input.removeItemIds) {
      const item = h.items.find((i) => String(i._id) === String(id));
      if (!item) continue;
      if (item.required) throw new ApiError(400, `"${item.title}" is required and cannot be removed`);
      item.deleteOne();
    }
  }
  await h.save();
  return load(orgId, { _id: h._id });
}

/** Send the checklist to the PM. Every required item must be done and a PM chosen. */
export async function submitHandover(ws: string | null | undefined, dealId: string, actorId: string) {
  const orgId = requireWorkspaceId(ws);
  const h = await editableFor(orgId, dealId);
  if (!EDITABLE.includes(h.status as HandoverStatus)) throw new ApiError(409, h.status === 'submitted' ? 'This handover was already sent' : `This handover is ${h.status}`);
  if (!h.pmUserId) throw new ApiError(400, 'Choose the project manager who takes over this deal');
  const missing = h.items.filter((i) => i.required && !i.done).map((i) => i.title);
  if (missing.length) throw new ApiError(400, `Complete the required items first: ${missing.join('; ')}`);
  // Only one send, even if pressed twice.
  const sent = await CrmHandover.updateOne(
    { _id: h._id, status: { $in: EDITABLE } },
    { $set: { status: 'submitted', submittedBy: oid(actorId), submittedAt: new Date() } }
  );
  if (!sent.modifiedCount) throw new ApiError(409, 'This handover was already sent');
  const deal = await CrmDeal.findById(h.dealId).select('title').lean();
  void notifyUsers([h.pmUserId], 'approval_requested', { title: `Handover to accept: ${deal?.title ?? 'deal'}`, body: 'Review the handover checklist and accept it, or return it with what is missing.', link: `/handovers/${String(h._id)}` }, actorId);
  logAudit({ userId: actorId, action: 'crm.handover.submit', resourceType: 'deal', resourceId: dealId, meta: { handoverId: String(h._id), pmUserId: String(h.pmUserId) } });
  return load(orgId, { _id: h._id });
}

// ── PM: accept or return ───────────────────────────────────────────────────

/** Only the chosen PM decides. Returning needs a note saying what is missing. */
export async function decideHandover(ws: string | null | undefined, id: string, decision: 'accept' | 'return', actorId: string, note?: unknown) {
  const orgId = requireWorkspaceId(ws);
  if (!isId(id)) throw new ApiError(404, 'Handover not found');
  const h = await CrmHandover.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!h) throw new ApiError(404, 'Handover not found');
  if (String(h.pmUserId) !== actorId) throw new ApiError(403, 'Only the project manager it was sent to can accept or return this handover');
  if (h.status !== 'submitted') throw new ApiError(409, h.status === 'accepted' ? 'This handover was already accepted' : 'This handover is not waiting for you');
  const text = String(note ?? '').trim().slice(0, 2000);
  if (decision === 'return' && !text) throw new ApiError(400, 'Say what is missing so sales can complete it');
  const $set =
    decision === 'accept'
      ? { status: 'accepted', acceptedBy: oid(actorId), acceptedAt: new Date(), ...(text ? { returnNote: text } : {}) }
      : { status: 'returned', returnedBy: oid(actorId), returnedAt: new Date(), returnNote: text };
  const done = await CrmHandover.updateOne({ _id: h._id, status: 'submitted' }, { $set });
  if (!done.modifiedCount) throw new ApiError(409, 'This handover was already decided');
  const deal = await CrmDeal.findById(h.dealId).select('title ownerId').lean();
  void notifyUsers([deal?.ownerId, h.submittedBy], 'approval_decided', {
    title: `Handover ${decision === 'accept' ? 'accepted' : 'returned'}: ${deal?.title ?? 'deal'}`,
    body: text,
    link: `/crm/deals/${String(h.dealId)}`,
  }, actorId);
  logAudit({ userId: actorId, action: decision === 'accept' ? 'crm.handover.accept' : 'crm.handover.return', resourceType: 'deal', resourceId: String(h.dealId), meta: { handoverId: id } });
  return load(orgId, { _id: h._id });
}
