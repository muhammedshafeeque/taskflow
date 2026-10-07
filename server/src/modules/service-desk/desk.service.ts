import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import mongoose, { Schema } from 'mongoose';
import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { ServiceTicket } from './models/serviceTicket.model';
import { SlaPolicy } from './models/slaPolicy.model';
import { notifyUser } from '../notifications/notificationDispatch.service';
import { sendCustomerEmail } from '../../services/email.service';
import { CustomerUser } from '../customer-portal/customer-user/customerUser.model';
import { CustomerRequest } from '../customer-portal/customer-request/customerRequest.model';

const orgRef = { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true } as const;

// ── Models ───────────────────────────────────────────────────────────────

/**
 * Service desk configuration (all data): business hours for SLA clocks,
 * the default SLA policy, how new tickets get assigned, and CSAT surveys.
 */
const serviceSettingsSchema = new Schema(
  {
    taskflowOrganizationId: { ...orgRef, unique: true },
    defaultSlaPolicyId: { type: Schema.Types.ObjectId, ref: 'SlaPolicy' },
    businessHours: {
      enabled: { type: Boolean, default: false },
      /** Offset from UTC in minutes for the schedule below (e.g. 330 for IST). */
      utcOffsetMinutes: { type: Number, default: 0 },
      /** One entry per open weekday: 0 = Sunday. Times are "HH:MM". */
      days: {
        type: [{ day: Number, start: String, end: String }],
        default: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '18:00' })),
      },
    },
    assignment: {
      /** none | round_robin | least_open */
      mode: { type: String, enum: ['none', 'round_robin', 'least_open'], default: 'none' },
      /** Agents per queue name; key "*" = any queue. */
      queues: { type: Map, of: [Schema.Types.ObjectId], default: {} },
      cursor: { type: Map, of: Number, default: {} },
    },
    csat: {
      enabled: { type: Boolean, default: true },
      question: { type: String, default: 'How satisfied are you with how we handled your request?' },
    },
  },
  { timestamps: true }
);
export const ServiceSettings = mongoose.model('ServiceSettings', serviceSettingsSchema);

const savedReplySchema = new Schema(
  {
    taskflowOrganizationId: orgRef,
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    /** Shared replies are visible to every agent; personal ones only to the owner. */
    shared: { type: Boolean, default: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
export const ServiceSavedReply = mongoose.model('ServiceSavedReply', savedReplySchema);

type Ws = string | null | undefined;
const oid = (id: string) => new mongoose.Types.ObjectId(id);

// ── Settings ─────────────────────────────────────────────────────────────

export async function getServiceSettings(ws: Ws) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const doc = await ServiceSettings.findOne({ taskflowOrganizationId: orgOid }).lean();
  const queues = doc?.assignment?.queues instanceof Map ? Object.fromEntries(doc.assignment.queues) : ((doc?.assignment?.queues as Record<string, unknown>) ?? {});
  return {
    defaultSlaPolicyId: doc?.defaultSlaPolicyId ? String(doc.defaultSlaPolicyId) : null,
    businessHours: doc?.businessHours ?? { enabled: false, utcOffsetMinutes: 0, days: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '18:00' })) },
    assignment: {
      mode: doc?.assignment?.mode ?? 'none',
      queues: Object.fromEntries(Object.entries(queues).map(([k, v]) => [k, (v as unknown[]).map(String)])),
    },
    csat: doc?.csat ?? { enabled: true, question: 'How satisfied are you with how we handled your request?' },
  };
}

export async function updateServiceSettings(ws: Ws, input: Record<string, unknown>) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const $set: Record<string, unknown> = {};
  if (input.defaultSlaPolicyId !== undefined) {
    if (input.defaultSlaPolicyId && !(await SlaPolicy.exists({ _id: input.defaultSlaPolicyId, taskflowOrganizationId: orgOid }))) {
      throw new ApiError(400, 'SLA policy not found');
    }
    $set.defaultSlaPolicyId = input.defaultSlaPolicyId ? oid(String(input.defaultSlaPolicyId)) : null;
  }
  const bh = input.businessHours as Record<string, unknown> | undefined;
  if (bh) {
    if (typeof bh.enabled === 'boolean') $set['businessHours.enabled'] = bh.enabled;
    if (bh.utcOffsetMinutes !== undefined) $set['businessHours.utcOffsetMinutes'] = Math.max(-720, Math.min(840, Number(bh.utcOffsetMinutes) || 0));
    if (Array.isArray(bh.days)) {
      const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
      $set['businessHours.days'] = bh.days
        .map((d: Record<string, unknown>) => ({ day: Number(d.day), start: String(d.start), end: String(d.end) }))
        .filter((d) => d.day >= 0 && d.day <= 6 && hhmm.test(d.start) && hhmm.test(d.end) && d.start < d.end);
    }
  }
  const a = input.assignment as Record<string, unknown> | undefined;
  if (a) {
    if (['none', 'round_robin', 'least_open'].includes(String(a.mode))) $set['assignment.mode'] = a.mode;
    if (a.queues && typeof a.queues === 'object') {
      $set['assignment.queues'] = Object.fromEntries(
        Object.entries(a.queues as Record<string, unknown>).map(([q, ids]) => [
          q.replace(/[.$]/g, '_'),
          (Array.isArray(ids) ? ids : []).filter((x) => mongoose.Types.ObjectId.isValid(String(x))).map((x) => oid(String(x))),
        ])
      );
    }
  }
  const c = input.csat as Record<string, unknown> | undefined;
  if (c) {
    if (typeof c.enabled === 'boolean') $set['csat.enabled'] = c.enabled;
    if (typeof c.question === 'string') $set['csat.question'] = c.question.slice(0, 300);
  }
  await ServiceSettings.updateOne({ taskflowOrganizationId: orgOid }, { $set }, { upsert: true });
  return getServiceSettings(String(orgOid));
}

// ── Business-hours clock ─────────────────────────────────────────────────

type Schedule = { enabled: boolean; utcOffsetMinutes: number; days: Array<{ day: number; start: string; end: string }> };
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Add working minutes to a start time following a weekly schedule (pure, for tests). */
export function addBusinessMinutes(start: Date, minutes: number, schedule: Schedule): Date {
  if (!schedule.enabled || !schedule.days.length) return new Date(start.getTime() + minutes * 60_000);
  const off = schedule.utcOffsetMinutes * 60_000;
  let local = new Date(start.getTime() + off); // shift so UTC getters read local wall time
  let remaining = minutes;
  for (let guard = 0; guard < 3700 && remaining > 0; guard++) {
    const today = schedule.days.find((d) => d.day === local.getUTCDay());
    const nowMin = local.getUTCHours() * 60 + local.getUTCMinutes();
    if (today) {
      const s = toMin(today.start);
      const e = toMin(today.end);
      const from = Math.max(nowMin, s);
      if (from < e) {
        const take = Math.min(remaining, e - from);
        remaining -= take;
        local = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + (from + take) * 60_000);
        if (remaining <= 0) break;
      }
    }
    // jump to the start of the next day
    local = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1));
  }
  return new Date(local.getTime() - off);
}

/**
 * Applied to every new ticket whatever its source (form, portal, email,
 * WhatsApp): SLA due times (contract policy, else the default policy) on the
 * business-hours clock, and automatic assignment.
 */
export async function finalizeNewTicket(ticketId: string) {
  const t = await ServiceTicket.findById(ticketId);
  if (!t) return;
  const settings = await getServiceSettings(String(t.taskflowOrganizationId));
  const policyId = t.slaPolicyId ?? (settings.defaultSlaPolicyId ? oid(settings.defaultSlaPolicyId) : null);
  if (policyId) await applySla(t, policyId, settings.businessHours as Schedule);
  if (!t.assigneeId && settings.assignment.mode !== 'none') {
    const agent = await pickAgent(String(t.taskflowOrganizationId), t.queue ?? 'general', settings.assignment as { mode: string; queues: Record<string, string[]> });
    if (agent) {
      t.assigneeId = oid(agent);
      void notifyUser({ userId: agent, eventKey: 'system_alert', title: 'Ticket assigned to you', body: t.subject, link: `/service/tickets?ticket=${t._id}` }).catch(() => undefined);
    }
  }
  await t.save();
}

async function applySla(t: InstanceType<typeof ServiceTicket>, policyId: mongoose.Types.ObjectId, schedule: Schedule) {
  const policy = await SlaPolicy.findById(policyId).lean();
  if (!policy || policy.enabled === false) return;
  const target = policy.targets.find((x) => x.priority === t.priority) ?? policy.targets[0];
  if (!target) return;
  const created = t.createdAt ?? new Date();
  t.slaPolicyId = policy._id as mongoose.Types.ObjectId;
  if (!t.firstRespondedAt) t.firstResponseDueAt = addBusinessMinutes(created, target.firstResponseMinutes, schedule);
  t.resolutionDueAt = addBusinessMinutes(created, target.resolutionMinutes, schedule);
}

/** Recompute due times after a priority change. */
export async function recomputeSla(ticketId: string) {
  const t = await ServiceTicket.findById(ticketId);
  if (!t?.slaPolicyId) return;
  const settings = await getServiceSettings(String(t.taskflowOrganizationId));
  await applySla(t, t.slaPolicyId, settings.businessHours as Schedule);
  await t.save();
}

async function pickAgent(orgId: string, queue: string, assignment: { mode: string; queues: Record<string, string[]> }): Promise<string | null> {
  const pool = assignment.queues[queue] ?? assignment.queues['*'] ?? [];
  if (!pool.length) return null;
  if (assignment.mode === 'least_open') {
    const counts = await ServiceTicket.aggregate<{ _id: mongoose.Types.ObjectId; n: number }>([
      { $match: { taskflowOrganizationId: oid(orgId), assigneeId: { $in: pool.map(oid) }, status: { $nin: ['resolved', 'closed'] } } },
      { $group: { _id: '$assigneeId', n: { $sum: 1 } } },
    ]);
    return [...pool].sort((a, b) => (counts.find((c) => String(c._id) === a)?.n ?? 0) - (counts.find((c) => String(c._id) === b)?.n ?? 0))[0];
  }
  // round robin: atomic cursor per queue
  const key = (assignment.queues[queue] ? queue : '*').replace(/[.$]/g, '_');
  const doc = await ServiceSettings.findOneAndUpdate(
    { taskflowOrganizationId: oid(orgId) },
    { $inc: { [`assignment.cursor.${key}`]: 1 } },
    { new: true }
  ).lean();
  const cursor = doc?.assignment?.cursor instanceof Map ? doc.assignment.cursor.get(key) : (doc?.assignment?.cursor as Record<string, number> | undefined)?.[key];
  return pool[((Number(cursor) || 1) - 1) % pool.length];
}

// ── Saved replies ────────────────────────────────────────────────────────

export async function listSavedReplies(ws: Ws, userId: string) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  return ServiceSavedReply.find({ taskflowOrganizationId: orgOid, $or: [{ shared: true }, { ownerId: oid(userId) }] }).sort({ title: 1 }).lean();
}

export async function saveSavedReply(ws: Ws, input: Record<string, unknown>, user: { id: string; canManageShared: boolean }, id?: string) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const shared = Boolean(input.shared) && user.canManageShared;
  const data: Record<string, unknown> = {};
  if (typeof input.title === 'string') data.title = input.title.trim().slice(0, 80);
  if (typeof input.body === 'string') data.body = input.body.slice(0, 5000);
  data.shared = shared;
  if (id) {
    const existing = await ServiceSavedReply.findOne({ _id: id, taskflowOrganizationId: orgOid });
    if (!existing) throw new ApiError(404, 'Saved reply not found');
    if (existing.shared ? !user.canManageShared : String(existing.ownerId) !== user.id) throw new ApiError(403, 'Not allowed');
    existing.set(data);
    await existing.save();
    return existing.toObject();
  }
  if (!data.title || !data.body) throw new ApiError(400, 'title and body are required');
  return (await ServiceSavedReply.create({ ...data, taskflowOrganizationId: orgOid, ownerId: oid(user.id) })).toObject();
}

export async function deleteSavedReply(ws: Ws, id: string, user: { id: string; canManageShared: boolean }) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const existing = await ServiceSavedReply.findOne({ _id: id, taskflowOrganizationId: orgOid });
  if (!existing) return { ok: true };
  if (existing.shared ? !user.canManageShared : String(existing.ownerId) !== user.id) throw new ApiError(403, 'Not allowed');
  await existing.deleteOne();
  return { ok: true };
}

// ── Merge ────────────────────────────────────────────────────────────────

/** Move a duplicate's conversation into the main ticket and close the duplicate. */
export async function mergeTickets(ws: Ws, duplicateId: string, intoId: string, user: { id: string; name?: string }) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  if (duplicateId === intoId) throw new ApiError(400, 'Pick a different ticket');
  const [dup, main] = await Promise.all([
    ServiceTicket.findOne({ _id: duplicateId, taskflowOrganizationId: orgOid }),
    ServiceTicket.findOne({ _id: intoId, taskflowOrganizationId: orgOid }),
  ]);
  if (!dup || !main) throw new ApiError(404, 'Ticket not found');
  main.comments.push({
    authorName: user.name ?? 'System',
    body: `Merged from "${dup.subject}":\n\n${dup.description ?? ''}`.slice(0, 20_000),
    internal: true,
    createdAt: new Date(),
  });
  for (const c of dup.comments) main.comments.push({ authorId: c.authorId, authorName: c.authorName, body: c.body, internal: c.internal, createdAt: c.createdAt });
  main.comments.sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());
  await main.save();
  dup.comments.push({ authorName: user.name ?? 'System', body: `Merged into "${main.subject}".`, internal: true, createdAt: new Date() });
  dup.status = 'closed';
  dup.resolvedAt = new Date();
  dup.set('mergedIntoId', main._id);
  await dup.save();
  return main.toObject();
}

// ── Customer satisfaction ────────────────────────────────────────────────

const csatHash = (t: string) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);

export function csatToken(ticketId: string): string {
  return jwt.sign({ sub: ticketId, purpose: 'csat' }, env.jwtSecret, { expiresIn: '30d' });
}

/** Ask the requester to rate the ticket once it's resolved (email link; portal shows it inline). */
export async function sendCsatRequest(ticketId: string) {
  const t = await ServiceTicket.findById(ticketId).lean();
  if (!t || t.csatScore) return;
  const settings = await getServiceSettings(String(t.taskflowOrganizationId));
  if (!settings.csat.enabled) return;
  let email = t.requesterEmail;
  if (!email && t.customerRequestId) {
    const req = await CustomerRequest.findById(t.customerRequestId).select('createdBy').lean();
    const cu = req?.createdBy ? await CustomerUser.findById(req.createdBy).select('email').lean() : null;
    email = cu?.email;
  }
  if (!email) return;
  const base = env.appUrl.replace(/\/$/, '');
  const token = csatToken(String(t._id));
  const links = [1, 2, 3, 4, 5]
    .map((n) => `<a href="${base}/rate/${token}?score=${n}" style="display:inline-block;margin:0 4px;padding:8px 12px;border:1px solid #ddd;border-radius:6px;text-decoration:none">${'★'.repeat(n)}</a>`)
    .join('');
  await sendCustomerEmail(
    email,
    `How did we do? ${t.subject}`,
    `<div style="font-family:Arial,sans-serif;font-size:14px"><p>${settings.csat.question}</p><p>${links}</p><p style="color:#666;font-size:12px">Ticket: ${t.subject}</p></div>`
  ).catch((err) => console.error('[csat] email failed', err));
}

export async function submitCustomerCsat(token: string, score: number, comment?: string) {
  let payload: { sub?: string; purpose?: string };
  try {
    payload = jwt.verify(token, env.jwtSecret) as typeof payload;
  } catch {
    throw new ApiError(401, 'This rating link has expired');
  }
  if (payload.purpose !== 'csat' || !payload.sub) throw new ApiError(400, 'Invalid rating link');
  return recordCsat(payload.sub, score, comment);
}

export async function recordCsat(ticketId: string, score: number, comment?: string) {
  const s = Math.round(Number(score));
  if (!(s >= 1 && s <= 5)) throw new ApiError(400, 'Score must be 1–5');
  const t = await ServiceTicket.findById(ticketId);
  if (!t) throw new ApiError(404, 'Ticket not found');
  t.csatScore = s;
  if (comment) t.csatComment = String(comment).slice(0, 2000);
  await t.save();
  if (t.assigneeId && s <= 2) {
    void notifyUser({ userId: String(t.assigneeId), eventKey: 'system_alert', title: `Low rating (${s}★): ${t.subject}`, body: t.csatComment ?? '', link: `/service/tickets?ticket=${t._id}` }).catch(() => undefined);
  }
  return { ticketId: String(t._id), score: s, subject: t.subject, ref: csatHash(String(t._id)) };
}
