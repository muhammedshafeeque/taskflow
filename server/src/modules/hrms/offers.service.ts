/**
 * Job offers and the public careers page (AUT-37).
 *
 * Offer: drafted from the HR offer-letter template → approved → sent to the candidate with a private
 * link → accepted or declined online. Approval runs through the shared approval engine when an "offer"
 * chain is on (so "HR, then finance above the band" can be set up); otherwise someone who may set pay,
 * other than whoever drafted it, approves. HR can require an accepted offer before hiring.
 *
 * Careers page: published, open openings of a workspace, with an application form that adds a candidate.
 */
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { Organization } from '../organizations/organization.model';
import { notifyUsers } from '../notifications/domainNotify';
import { logAudit } from '../auditLogs/logAudit';
import { sendCustomerEmail, tfEmailWrap } from '../../services/email.service';
import { isApprovalChainEnabled, submitForApproval, cancelForRecord } from '../approvals/approvals.service';
import { HrmsOffer, type OfferStatus } from './models/hrmsOffer.model';
import { HrmsCandidate, HrmsJobOpening } from './models/hrmsPeople.model';
import { getHrSettings } from './policy.service';
import { assertCanSetPay, payAccessFor } from './payAccess';
import { assertCandidateJobInReach } from './people.service';
import type { Reach } from './dataScope';

type Oid = mongoose.Types.ObjectId;
type OfferDoc = InstanceType<typeof HrmsOffer>;
const LIVE: OfferStatus[] = ['draft', 'pending_approval', 'approved', 'sent'];
const isId = (v: unknown) => typeof v === 'string' && mongoose.isValidObjectId(v);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const day = (d?: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');

const DEFAULT_LETTER = `Dear {{name}},

We are pleased to offer you the position of {{designation}} at {{company}}, starting on {{joiningDate}}.

Your annual compensation will be {{currency}} {{ctc}}.

Please accept this offer by {{expiresAt}}.

Kind regards,
{{company}}`;

async function offerIn(orgId: string, id: string) {
  if (!isId(id)) throw new ApiError(404, 'Offer not found');
  const o = await HrmsOffer.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!o) throw new ApiError(404, 'Offer not found');
  return o;
}

async function render(orgId: string, o: { designation?: string | null; annualCtc: number; currency?: string | null; joiningDate?: Date | null; expiresAt?: Date | null }, candidateName: string, template?: string) {
  const [settings, org] = await Promise.all([getHrSettings(orgId), Organization.findById(orgId).select('name').lean()]);
  const text = (template ?? '') || (settings as { offerLetterTemplate?: string }).offerLetterTemplate || DEFAULT_LETTER;
  const values: Record<string, string> = {
    name: candidateName,
    designation: o.designation ?? '',
    ctc: Number(o.annualCtc).toLocaleString('en'),
    currency: o.currency ?? '',
    joiningDate: day(o.joiningDate) || 'to be agreed',
    expiresAt: day(o.expiresAt) || 'soon',
    company: (org as { name?: string } | null)?.name ?? '',
  };
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (k in values ? values[k] : m));
}

function parseTerms(input: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (input.annualCtc !== undefined || !partial) {
    const n = Number(input.annualCtc);
    if (!Number.isFinite(n) || n < 0) throw new ApiError(400, 'Annual CTC must be zero or more');
    out.annualCtc = n;
  }
  if (typeof input.currency === 'string' && input.currency.trim()) out.currency = input.currency.trim().toUpperCase().slice(0, 3);
  if (typeof input.designation === 'string') out.designation = input.designation.trim().slice(0, 120);
  for (const k of ['joiningDate', 'expiresAt'] as const) {
    if (input[k] === undefined) continue;
    if (input[k] === null || input[k] === '') out[k] = null;
    else {
      const d = new Date(String(input[k]));
      if (Number.isNaN(d.getTime())) throw new ApiError(400, `${k} is not a valid date`);
      out[k] = d;
    }
  }
  return out;
}

// ── Staff: draft, approve, send ───────────────────────────────────────────

export async function listOffers(ws: string | null | undefined, candidateId: string) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  return HrmsOffer.find({ taskflowOrganizationId: orgOid, candidateId }).sort({ createdAt: -1 }).populate('createdBy', 'name').populate('approvedBy', 'name').lean();
}

export async function createOffer(ws: string | null | undefined, candidateId: string, input: Record<string, unknown>, actorId: string, permissions: string[], reach: Reach = null) {
  const orgId = requireWorkspaceId(ws);
  const orgOid = toOrgOid(orgId);
  assertCanSetPay({ annualCtc: input.annualCtc ?? 0 }, payAccessFor(permissions));
  if (!isId(candidateId)) throw new ApiError(404, 'Candidate not found');
  const c = await HrmsCandidate.findOne({ _id: candidateId, taskflowOrganizationId: orgOid }).lean();
  if (!c) throw new ApiError(404, 'Candidate not found');
  await assertCandidateJobInReach(reach, c.jobId);
  if (c.status !== 'active') throw new ApiError(409, `This candidate is ${c.status}`);
  if (await HrmsOffer.exists({ candidateId: c._id, status: { $in: LIVE } })) throw new ApiError(409, 'This candidate already has an open offer. Withdraw it to make a new one.');
  const job = await HrmsJobOpening.findById(c.jobId).lean();
  const terms = parseTerms({ annualCtc: c.expectedSalary ?? 0, currency: job?.currency, designation: job?.title, ...input }, false);
  const offer = {
    ...terms,
    currency: (terms.currency as string) ?? job?.currency ?? 'USD',
    aboveBand: job?.salaryMax != null && (terms.annualCtc as number) > job.salaryMax,
  } as { annualCtc: number; currency: string; designation?: string; joiningDate?: Date | null; expiresAt?: Date | null; aboveBand: boolean };
  const letter = typeof input.letter === 'string' && input.letter.trim() ? input.letter.slice(0, 20_000) : await render(orgId, offer, c.name);
  try {
    const doc = await HrmsOffer.create({ taskflowOrganizationId: orgOid, candidateId: c._id, jobId: c.jobId, status: 'draft', letter, createdBy: new mongoose.Types.ObjectId(actorId), ...offer });
    logAudit({ userId: actorId, action: 'hr.offer.create', resourceType: 'offer', resourceId: String(doc._id), meta: { candidateId, aboveBand: offer.aboveBand } });
    return doc.toObject();
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new ApiError(409, 'This candidate already has an open offer');
    throw err;
  }
}

/** Change a draft (or an offer sent back from approval). The letter is filled in again unless given. */
export async function updateOffer(ws: string | null | undefined, id: string, input: Record<string, unknown>, permissions: string[]) {
  const orgId = requireWorkspaceId(ws);
  const o = await offerIn(orgId, id);
  if (o.status !== 'draft') throw new ApiError(409, 'Only a draft offer can be changed');
  if (input.annualCtc !== undefined) assertCanSetPay({ annualCtc: input.annualCtc }, payAccessFor(permissions));
  const terms = parseTerms(input, true);
  o.set(terms);
  const job = await HrmsJobOpening.findById(o.jobId).select('salaryMax').lean();
  o.aboveBand = job?.salaryMax != null && o.annualCtc > job.salaryMax;
  if (typeof input.letter === 'string' && input.letter.trim()) o.letter = input.letter.slice(0, 20_000);
  else if (Object.keys(terms).length) {
    const c = await HrmsCandidate.findById(o.candidateId).select('name').lean();
    o.letter = await render(orgId, o, c?.name ?? '');
  }
  await o.save();
  return o.toObject();
}

/** Send a draft for approval: through the offer chain when it is on, else to anyone who may set pay. */
export async function submitOffer(ws: string | null | undefined, id: string, actorId: string) {
  const orgId = requireWorkspaceId(ws);
  const o = await offerIn(orgId, id);
  if (o.status !== 'draft') throw new ApiError(409, 'Only a draft offer can be sent for approval');
  o.status = 'pending_approval';
  o.rejectionNote = undefined;
  await o.save();
  if (await isApprovalChainEnabled(orgId, 'offer')) {
    try {
      await submitForApproval(orgId, 'offer', String(o._id), actorId);
    } catch (err) {
      o.status = 'draft';
      await o.save();
      throw err;
    }
  } else {
    const { usersWithPermission } = await import('../auth/usersWithPermission');
    const approvers = (await usersWithPermission('taskflow.hr.salary.manage', orgId)).filter((u) => u !== actorId);
    void notifyUsers(approvers, 'approval_requested', { title: `Offer to approve${o.aboveBand ? ' (above the salary band)' : ''}`, body: `${o.currency} ${o.annualCtc}`, link: '/hrms/recruitment' }, actorId);
  }
  logAudit({ userId: actorId, action: 'hr.offer.submit', resourceType: 'offer', resourceId: id });
  return o.toObject();
}

/** Approve or send back an offer when no offer chain is on. Needs pay rights; never your own offer. */
export async function decideOffer(ws: string | null | undefined, id: string, decision: 'approve' | 'reject', actorId: string, permissions: string[], note?: string) {
  const orgId = requireWorkspaceId(ws);
  const o = await offerIn(orgId, id);
  if (await isApprovalChainEnabled(orgId, 'offer')) throw new ApiError(409, 'Offers are approved through the approval chain: decide it in Approvals');
  if (o.status !== 'pending_approval') throw new ApiError(409, 'This offer is not waiting for approval');
  if (!payAccessFor(permissions).set) throw new ApiError(403, 'Approving an offer needs the permission to set pay');
  if (String(o.createdBy) === actorId) throw new ApiError(403, 'You cannot approve an offer you drafted');
  if (decision === 'reject' && !String(note ?? '').trim()) throw new ApiError(400, 'Say why the offer is sent back');
  await applyOfferDecision(orgId, String(o._id), decision === 'approve' ? 'approved' : 'rejected', actorId, note);
  return (await HrmsOffer.findById(o._id).lean())!;
}

/** Shared by the manual decision and the approval engine's adapter. */
export async function applyOfferDecision(orgId: string, id: string, outcome: 'approved' | 'rejected', actorId: string, note?: string) {
  const o = await offerIn(orgId, id);
  if (o.status !== 'pending_approval') return;
  if (outcome === 'approved') {
    o.status = 'approved';
    o.approvedBy = new mongoose.Types.ObjectId(actorId) as never;
    o.approvedAt = new Date();
  } else {
    o.status = 'draft';
    o.rejectionNote = note ? String(note).slice(0, 1000) : 'Sent back for changes';
  }
  await o.save();
  logAudit({ userId: actorId, action: outcome === 'approved' ? 'hr.offer.approve' : 'hr.offer.reject', resourceType: 'offer', resourceId: id });
  void notifyUsers([o.createdBy], 'approval_decided', { title: `Offer ${outcome === 'approved' ? 'approved' : 'sent back'}`, body: o.rejectionNote ?? '', link: '/hrms/recruitment' }, actorId);
}

const PURPOSE = 'offer_response';
export function offerToken(id: string, expiresAt?: Date | null): string {
  const seconds = expiresAt ? Math.max(3600, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000) + 86_400) : 60 * 86_400;
  return jwt.sign({ sub: id, purpose: PURPOSE }, env.jwtSecret, { expiresIn: seconds });
}
export const offerUrl = (id: string, expiresAt?: Date | null) => `${env.frontendUrl.replace(/\/$/, '')}/offer/${offerToken(id, expiresAt)}`;

/** Email the approved offer to the candidate with their private accept/decline link. Resending is allowed. */
export async function sendOffer(ws: string | null | undefined, id: string, actorId: string) {
  const orgId = requireWorkspaceId(ws);
  const o = await offerIn(orgId, id);
  if (o.status !== 'approved' && o.status !== 'sent') throw new ApiError(409, 'Only an approved offer can be sent');
  if (o.expiresAt && new Date(o.expiresAt).getTime() < Date.now()) throw new ApiError(409, 'This offer has expired; withdraw it and make a new one');
  const c = await HrmsCandidate.findById(o.candidateId).select('name email').lean();
  if (!c?.email) throw new ApiError(400, 'Add the candidate’s email before sending the offer');
  const org = await Organization.findById(orgId).select('name').lean();
  const url = offerUrl(String(o._id), o.expiresAt);
  const html = tfEmailWrap(
    `<p>Dear ${esc(c.name)},</p>
     <p>${esc((org as { name?: string } | null)?.name ?? 'We')} would like to offer you the position of <strong>${esc(o.designation ?? '')}</strong>.</p>
     <p><a href="${url}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none">Read and respond to your offer</a></p>
     ${o.expiresAt ? `<p style="font-size:12px;color:#666">Please respond by ${day(o.expiresAt)}.</p>` : ''}`,
    'indigo'
  );
  await sendCustomerEmail(c.email, `Your offer from ${(org as { name?: string } | null)?.name ?? 'us'}`, html);
  o.status = 'sent';
  o.sentAt = new Date();
  o.sentTo = c.email;
  await o.save();
  logAudit({ userId: actorId, action: 'hr.offer.send', resourceType: 'offer', resourceId: id, meta: { to: c.email } });
  return { ...o.toObject(), url };
}

export async function withdrawOffer(ws: string | null | undefined, id: string, actorId: string) {
  const orgId = requireWorkspaceId(ws);
  const o = await offerIn(orgId, id);
  if (!LIVE.includes(o.status as OfferStatus)) throw new ApiError(409, `This offer is already ${o.status}`);
  o.status = 'withdrawn';
  await o.save();
  await cancelForRecord(orgId, 'offer', id, actorId, 'Offer withdrawn').catch(() => undefined);
  logAudit({ userId: actorId, action: 'hr.offer.withdraw', resourceType: 'offer', resourceId: id });
  return o.toObject();
}

/** The accepted offer a hire is based on, if any. */
export async function acceptedOfferFor(candidateId: unknown) {
  return HrmsOffer.findOne({ candidateId, status: 'accepted' }).sort({ updatedAt: -1 }).lean();
}

// ── Candidate: read and respond (private link) ────────────────────────────

function offerIdFromToken(token: string): string {
  try {
    const p = jwt.verify(token, env.jwtSecret) as { sub?: string; purpose?: string };
    if (p.purpose !== PURPOSE || !isId(p.sub)) throw new Error('bad');
    return p.sub!;
  } catch {
    throw new ApiError(404, 'This offer link is invalid or has expired. Please contact us.');
  }
}

async function candidateView(o: OfferDoc | Record<string, any>) {
  const [c, org] = await Promise.all([HrmsCandidate.findById(o.candidateId).select('name').lean(), Organization.findById(o.taskflowOrganizationId).select('name').lean()]);
  const expired = o.status === 'sent' && o.expiresAt && new Date(o.expiresAt).getTime() < Date.now();
  return {
    company: (org as { name?: string } | null)?.name ?? '',
    name: c?.name ?? '',
    designation: o.designation,
    annualCtc: o.annualCtc,
    currency: o.currency,
    joiningDate: o.joiningDate,
    expiresAt: o.expiresAt,
    letter: o.letter,
    status: expired ? 'expired' : o.status === 'sent' ? 'open' : o.status,
    response: o.response ?? null,
  };
}

export async function publicOffer(token: string) {
  const o = await HrmsOffer.findById(offerIdFromToken(token));
  if (!o || !['sent', 'accepted', 'declined'].includes(o.status)) throw new ApiError(404, 'This offer link is invalid or has expired. Please contact us.');
  return candidateView(o);
}

export async function respondToOffer(token: string, body: { decision?: unknown; name?: unknown; note?: unknown }) {
  const o = await HrmsOffer.findById(offerIdFromToken(token));
  if (!o || !['sent', 'accepted', 'declined'].includes(o.status)) throw new ApiError(404, 'This offer link is invalid or has expired. Please contact us.');
  if (o.status !== 'sent') throw new ApiError(409, `You have already ${o.status} this offer.`);
  if (o.expiresAt && new Date(o.expiresAt).getTime() < Date.now()) throw new ApiError(409, 'This offer has expired. Please contact us.');
  const decision = body.decision === 'accept' ? 'accepted' : body.decision === 'decline' ? 'declined' : null;
  if (!decision) throw new ApiError(400, 'Choose accept or decline');
  const name = String(body.name ?? '').trim();
  if (!name) throw new ApiError(400, 'Type your full name to sign');
  // Only one answer, even if the page is submitted twice at once.
  const won = await HrmsOffer.updateOne(
    { _id: o._id, status: 'sent' },
    { $set: { status: decision, response: { decision, name: name.slice(0, 200), note: body.note ? String(body.note).slice(0, 2000) : undefined, at: new Date() } } }
  );
  if (!won.modifiedCount) throw new ApiError(409, 'This offer was already answered.');
  const job = await HrmsJobOpening.findById(o.jobId).select('hiringManagerId title').lean();
  void notifyUsers([o.createdBy, job?.hiringManagerId], 'approval_decided', {
    title: `Offer ${decision}: ${name}`,
    body: job?.title ?? '',
    link: '/hrms/recruitment',
  });
  logAudit({ userId: String(o.createdBy), action: `hr.offer.${decision}`, resourceType: 'offer', resourceId: String(o._id), meta: { by: 'candidate', name } });
  return candidateView((await HrmsOffer.findById(o._id))!);
}

// ── Careers page ──────────────────────────────────────────────────────────

async function careersOrg(slug: string) {
  const org = await Organization.findOne({ slug: String(slug).toLowerCase() }).select('_id name').lean();
  if (!org) throw new ApiError(404, 'Careers page not found');
  const settings = (await getHrSettings(String(org._id))) as { careersPageEnabled?: boolean; careersIntro?: string };
  if (!settings.careersPageEnabled) throw new ApiError(404, 'Careers page not found');
  return { org: org as { _id: Oid; name: string }, intro: settings.careersIntro ?? '' };
}

const publicJob = (j: Record<string, any>) => ({
  _id: String(j._id),
  title: j.title,
  department: j.department,
  location: j.location,
  employmentType: j.employmentType,
  description: j.description,
});

export async function careersPage(slug: string) {
  const { org, intro } = await careersOrg(slug);
  const jobs = await HrmsJobOpening.find({ taskflowOrganizationId: org._id, status: 'open', published: true }).sort({ createdAt: -1 }).lean();
  return { company: org.name, intro, jobs: jobs.map(publicJob) };
}

async function openPublishedJob(orgId: Oid, jobId: string) {
  if (!isId(jobId)) throw new ApiError(404, 'This opening is no longer available');
  const job = await HrmsJobOpening.findOne({ _id: jobId, taskflowOrganizationId: orgId, status: 'open', published: true }).lean();
  if (!job) throw new ApiError(404, 'This opening is no longer available');
  return job;
}

export async function careersJob(slug: string, jobId: string) {
  const { org } = await careersOrg(slug);
  return { company: org.name, job: publicJob(await openPublishedJob(org._id, jobId)) };
}

/** An application from the careers page becomes a candidate in the opening's first stage. */
export async function applyToJob(slug: string, jobId: string, body: Record<string, unknown>) {
  const { org } = await careersOrg(slug);
  const job = await openPublishedJob(org._id, jobId);
  // A hidden field people never see; bots fill it in.
  if (String(body.website ?? '').trim()) return { received: true };
  const name = String(body.name ?? '').trim().slice(0, 120);
  const email = String(body.email ?? '').trim().toLowerCase().slice(0, 200);
  if (!name) throw new ApiError(400, 'Enter your name');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError(400, 'Enter a valid email');
  const resumeUrl = String(body.resumeUrl ?? '').trim();
  if (resumeUrl && !/^https?:\/\/\S+$/i.test(resumeUrl)) throw new ApiError(400, 'The CV link must start with http:// or https://');
  if (await HrmsCandidate.exists({ jobId: job._id, email, status: 'active' })) throw new ApiError(409, 'You have already applied for this opening. We will be in touch.');
  const settings = await getHrSettings(String(org._id));
  const stages = (job.stages?.length ? job.stages : (settings as { recruitmentStages?: string[] }).recruitmentStages) ?? ['Applied'];
  const cand = await HrmsCandidate.create({
    taskflowOrganizationId: org._id,
    jobId: job._id,
    name,
    email,
    phone: String(body.phone ?? '').trim().slice(0, 40) || undefined,
    resumeUrl: resumeUrl || undefined,
    coverNote: String(body.coverNote ?? '').trim().slice(0, 4000) || undefined,
    source: 'careers_page',
    stage: stages[0],
    status: 'active',
  });
  if (job.hiringManagerId) {
    void notifyUsers([job.hiringManagerId], 'hr_application_received', { title: `New application: ${name}`, body: job.title, link: '/hrms/recruitment' });
  }
  return { received: true, candidateId: String(cand._id) };
}
