/**
 * Policy read-and-accept tracking (AUT-36).
 *
 * HR assigns a policy (a Documents record of kind "policy") to everyone, to teams, and/or to people.
 * Employees read and accept it from Me. An acceptance is for one version: when the policy's content
 * changes its version goes up, and everyone assigned is asked again. HR sees who has accepted and who
 * is pending, and pending people are reminded on a schedule (or right away from the policy).
 */
import mongoose, { Schema } from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { DocumentRecord } from './models/documentRecord.model';
import { HrmsEmployee } from '../hrms/models/hrmsEmployee.model';
import { ResourceTeam } from '../resources/models/resourceTeam.model';
import { notifyUsers } from '../notifications/domainNotify';
import { claimReminder } from '../reminders/reminderLog.model';
import { logAudit } from '../auditLogs/logAudit';

type Oid = mongoose.Types.ObjectId;
const DAY = 86_400_000;

// ── Models ────────────────────────────────────────────────────────────────

export interface IPolicyAssignment {
  taskflowOrganizationId: Oid;
  documentId: Oid;
  everyone: boolean;
  teamIds: Oid[];
  employeeIds: Oid[];
  /** Remind pending people every N days; 0 = no automatic reminders. */
  remindEveryDays: number;
  active: boolean;
  assignedBy?: Oid;
  createdAt: Date;
  updatedAt: Date;
}

const assignmentSchema = new Schema<IPolicyAssignment>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    documentId: { type: Schema.Types.ObjectId, ref: 'DocumentRecord', required: true, unique: true },
    everyone: { type: Boolean, default: false },
    teamIds: { type: [{ type: Schema.Types.ObjectId, ref: 'ResourceTeam' }], default: [] },
    employeeIds: { type: [{ type: Schema.Types.ObjectId, ref: 'HrmsEmployee' }], default: [] },
    remindEveryDays: { type: Number, default: 3, min: 0, max: 90 },
    active: { type: Boolean, default: true, index: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
export const PolicyAssignment = mongoose.model<IPolicyAssignment>('PolicyAssignment', assignmentSchema);

export interface IPolicyAcceptance {
  taskflowOrganizationId: Oid;
  documentId: Oid;
  version: number;
  employeeId: Oid;
  userId: Oid;
  acceptedAt: Date;
}

const acceptanceSchema = new Schema<IPolicyAcceptance>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    documentId: { type: Schema.Types.ObjectId, ref: 'DocumentRecord', required: true },
    version: { type: Number, required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'HrmsEmployee', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    acceptedAt: { type: Date, required: true },
  },
  { versionKey: false }
);
// One acceptance per person per version: accepting twice changes nothing.
acceptanceSchema.index({ documentId: 1, employeeId: 1, version: 1 }, { unique: true });
export const PolicyAcceptance = mongoose.model<IPolicyAcceptance>('PolicyAcceptance', acceptanceSchema);

// ── Helpers ───────────────────────────────────────────────────────────────

const oid = (v: unknown) => new mongoose.Types.ObjectId(String(v));
const LIVE = (status: string) => status !== 'draft' && status !== 'archived';

async function policyDoc(orgId: string, id: string) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(404, 'Policy not found');
  const doc = await DocumentRecord.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) }).lean();
  if (!doc) throw new ApiError(404, 'Policy not found');
  if (doc.kind !== 'policy') throw new ApiError(400, 'Only policies can be assigned for acceptance');
  return doc;
}

type AudienceEmployee = { _id: Oid; name: string; email?: string; department?: string; userId?: Oid | null };

/** Everyone the assignment covers: current (not terminated) employees. */
async function audienceOf(a: Pick<IPolicyAssignment, 'taskflowOrganizationId' | 'everyone' | 'teamIds' | 'employeeIds'>): Promise<AudienceEmployee[]> {
  const base = { taskflowOrganizationId: a.taskflowOrganizationId, status: { $ne: 'terminated' } };
  const select = '_id name email department userId';
  if (a.everyone) return HrmsEmployee.find(base).select(select).sort({ name: 1 }).lean() as Promise<AudienceEmployee[]>;
  const or: Record<string, unknown>[] = [];
  if (a.employeeIds?.length) or.push({ _id: { $in: a.employeeIds } });
  if (a.teamIds?.length) {
    const teams = await ResourceTeam.find({ _id: { $in: a.teamIds }, taskflowOrganizationId: a.taskflowOrganizationId }).select('memberIds leadId').lean();
    const members = [...new Set(teams.flatMap((t) => [...(t.memberIds ?? []), ...(t.leadId ? [t.leadId] : [])]).map(String))];
    if (members.length) or.push({ userId: { $in: members.map(oid) } });
  }
  if (!or.length) return [];
  return HrmsEmployee.find({ ...base, $or: or }).select(select).sort({ name: 1 }).lean() as Promise<AudienceEmployee[]>;
}

async function acceptedVersions(documentId: Oid, employeeIds: Oid[]) {
  const rows = await PolicyAcceptance.find({ documentId, employeeId: { $in: employeeIds } }).select('employeeId version acceptedAt').lean();
  const latest = new Map<string, { version: number; acceptedAt: Date }>();
  for (const r of rows) {
    const k = String(r.employeeId);
    if (!latest.has(k) || latest.get(k)!.version < r.version) latest.set(k, { version: r.version, acceptedAt: r.acceptedAt });
  }
  return latest;
}

function notifyPending(userIds: string[], doc: { _id: unknown; title: string; version: number }, reminder: boolean, actorId?: string) {
  if (!userIds.length) return;
  void notifyUsers(
    userIds,
    'policy_acceptance_required',
    {
      title: reminder ? `Reminder: please read and accept "${doc.title}"` : `Please read and accept "${doc.title}"`,
      body: doc.version > 1 ? `Version ${doc.version}` : '',
      link: `/me/policies/${String(doc._id)}`,
    },
    actorId
  );
}

// ── HR: assign, see who is pending, remind ────────────────────────────────

/** Who a policy can be assigned to: current employees and teams (names only). */
export async function audienceOptions(workspaceId: string | null | undefined) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const [employees, teams] = await Promise.all([
    HrmsEmployee.find({ taskflowOrganizationId: orgOid, status: { $ne: 'terminated' } }).select('name email department').sort({ name: 1 }).lean(),
    ResourceTeam.find({ taskflowOrganizationId: orgOid }).select('name').sort({ name: 1 }).lean(),
  ]);
  return {
    employees: employees.map((e) => ({ _id: String(e._id), name: e.name, email: e.email, department: e.department })),
    teams: teams.map((t) => ({ _id: String(t._id), name: t.name })),
  };
}

export async function getAssignment(workspaceId: string | null | undefined, documentId: string) {
  const orgId = requireWorkspaceId(workspaceId);
  await policyDoc(orgId, documentId);
  const a = await PolicyAssignment.findOne({ taskflowOrganizationId: toOrgOid(orgId), documentId: oid(documentId) }).lean();
  return a
    ? { everyone: a.everyone, teamIds: a.teamIds.map(String), employeeIds: a.employeeIds.map(String), remindEveryDays: a.remindEveryDays, active: a.active, updatedAt: a.updatedAt }
    : null;
}

/** Assign (or change who must accept) a policy. Newly covered people are asked straight away. */
export async function saveAssignment(workspaceId: string | null | undefined, documentId: string, input: Record<string, unknown>, actorId: string) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const doc = await policyDoc(orgId, documentId);
  const ids = (v: unknown, what: string) => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) throw new ApiError(400, `${what} must be a list`);
    const list = [...new Set(v.map(String))];
    if (list.some((x) => !mongoose.isValidObjectId(x))) throw new ApiError(400, `${what} contains an invalid id`);
    return list.map(oid);
  };
  const everyone = Boolean(input.everyone);
  const teamIds = ids(input.teamIds, 'teamIds');
  const employeeIds = ids(input.employeeIds, 'employeeIds');
  const remindEveryDays = input.remindEveryDays === undefined ? 3 : Number(input.remindEveryDays);
  if (!Number.isInteger(remindEveryDays) || remindEveryDays < 0 || remindEveryDays > 90) throw new ApiError(400, 'Reminder interval must be 0 to 90 days');
  const active = input.active === undefined ? true : Boolean(input.active);
  if (active && !everyone && !teamIds.length && !employeeIds.length) throw new ApiError(400, 'Choose everyone, a team or people to assign the policy to');
  if (teamIds.length && (await ResourceTeam.countDocuments({ _id: { $in: teamIds }, taskflowOrganizationId: orgOid })) !== teamIds.length) {
    throw new ApiError(400, 'One of the teams was not found');
  }
  if (employeeIds.length && (await HrmsEmployee.countDocuments({ _id: { $in: employeeIds }, taskflowOrganizationId: orgOid })) !== employeeIds.length) {
    throw new ApiError(400, 'One of the people was not found');
  }

  const before = await PolicyAssignment.findOne({ taskflowOrganizationId: orgOid, documentId: doc._id }).lean();
  const beforeIds = new Set(before?.active ? (await audienceOf(before)).map((e) => String(e._id)) : []);
  await PolicyAssignment.updateOne(
    { taskflowOrganizationId: orgOid, documentId: doc._id },
    { $set: { everyone, teamIds, employeeIds, remindEveryDays, active, assignedBy: oid(actorId) } },
    { upsert: true }
  );
  logAudit({ userId: actorId, action: 'documents.policy.assign', resourceType: 'document', resourceId: documentId, meta: { everyone, teams: teamIds.length, people: employeeIds.length, active } });

  if (active && LIVE(doc.status)) {
    const audience = await audienceOf({ taskflowOrganizationId: orgOid, everyone, teamIds, employeeIds });
    const accepted = await acceptedVersions(doc._id as Oid, audience.map((e) => e._id));
    const fresh = audience.filter((e) => !beforeIds.has(String(e._id)) && accepted.get(String(e._id))?.version !== doc.version && e.userId);
    notifyPending(fresh.map((e) => String(e.userId)), doc as never, false, actorId);
  }
  return getAssignment(orgId, documentId);
}

/** Who must accept, who has (for this version), who has not, and who has no account to accept with. */
export async function acceptanceReport(workspaceId: string | null | undefined, documentId: string) {
  const orgId = requireWorkspaceId(workspaceId);
  const doc = await policyDoc(orgId, documentId);
  const a = await PolicyAssignment.findOne({ taskflowOrganizationId: toOrgOid(orgId), documentId: doc._id }).lean();
  const audience = a?.active ? await audienceOf(a) : [];
  const accepted = await acceptedVersions(doc._id as Oid, audience.map((e) => e._id));
  const rows = audience.map((e) => {
    const acc = accepted.get(String(e._id));
    const status = acc?.version === doc.version ? 'accepted' : !e.userId ? 'no_account' : acc ? 'outdated' : 'pending';
    return {
      employeeId: String(e._id),
      name: e.name,
      email: e.email,
      department: e.department,
      status,
      acceptedVersion: acc?.version ?? null,
      acceptedAt: acc?.acceptedAt ?? null,
    };
  });
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  return {
    policy: { _id: String(doc._id), title: doc.title, version: doc.version, status: doc.status, live: LIVE(doc.status) },
    assignment: a ? { everyone: a.everyone, teamIds: a.teamIds.map(String), employeeIds: a.employeeIds.map(String), remindEveryDays: a.remindEveryDays, active: a.active } : null,
    counts: { total: rows.length, accepted: count('accepted'), pending: count('pending') + count('outdated'), noAccount: count('no_account') },
    rows,
  };
}

/** Remind everyone still pending, now. */
export async function remindNow(workspaceId: string | null | undefined, documentId: string, actorId: string) {
  const report = await acceptanceReport(workspaceId, documentId);
  if (!report.policy.live) throw new ApiError(400, 'Publish the policy (not draft or archived) before asking people to accept it');
  const pendingIds = report.rows.filter((r) => r.status === 'pending' || r.status === 'outdated').map((r) => r.employeeId);
  const users = (await HrmsEmployee.find({ _id: { $in: pendingIds.map(oid) } }).select('userId').lean()).map((e) => String(e.userId)).filter((u) => u !== 'undefined' && u !== 'null');
  notifyPending(users, { _id: report.policy._id, title: report.policy.title, version: report.policy.version }, true, actorId);
  logAudit({ userId: actorId, action: 'documents.policy.remind', resourceType: 'document', resourceId: documentId, meta: { reminded: users.length } });
  return { reminded: users.length };
}

/**
 * After a policy is edited: a new version (or the policy being published) asks everyone assigned who
 * has not accepted this version, straight away.
 */
export async function onPolicyChanged(orgId: string, doc: { _id: unknown; title: string; version: number; status: string; kind: string }, before: { version: number; status: string }) {
  if (doc.kind !== 'policy' || !LIVE(doc.status)) return;
  const becameLive = !LIVE(before.status);
  if (doc.version === before.version && !becameLive) return;
  const a = await PolicyAssignment.findOne({ taskflowOrganizationId: toOrgOid(orgId), documentId: doc._id, active: true }).lean();
  if (!a) return;
  const audience = (await audienceOf(a)).filter((e) => e.userId);
  const accepted = await acceptedVersions(oid(doc._id), audience.map((e) => e._id));
  notifyPending(audience.filter((e) => accepted.get(String(e._id))?.version !== doc.version).map((e) => String(e.userId)), doc, false);
}

// ── Me: read and accept ───────────────────────────────────────────────────

async function assignmentsCovering(orgOid: Oid, employee: { _id: unknown; userId?: unknown }) {
  const teams = employee.userId
    ? await ResourceTeam.find({ taskflowOrganizationId: orgOid, $or: [{ memberIds: employee.userId }, { leadId: employee.userId }] }).distinct('_id')
    : [];
  return PolicyAssignment.find({
    taskflowOrganizationId: orgOid,
    active: true,
    $or: [{ everyone: true }, { employeeIds: employee._id }, ...(teams.length ? [{ teamIds: { $in: teams } }] : [])],
  }).lean();
}

/** Policies assigned to me that are published: what to accept, and what I already accepted. */
export async function myPolicies(workspaceId: string | null | undefined, employee: { _id: unknown; userId?: unknown; status?: string }) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  if (employee.status === 'terminated') return [];
  const assignments = await assignmentsCovering(orgOid, employee);
  if (!assignments.length) return [];
  const docs = await DocumentRecord.find({ _id: { $in: assignments.map((a) => a.documentId) }, kind: 'policy', status: { $nin: ['draft', 'archived'] } })
    .select('title summary version updatedAt')
    .sort({ title: 1 })
    .lean();
  const accepted = await PolicyAcceptance.find({ employeeId: employee._id, documentId: { $in: docs.map((d) => d._id) } }).select('documentId version acceptedAt').lean();
  return docs.map((d) => {
    const mine = accepted.filter((x) => String(x.documentId) === String(d._id)).sort((x, y) => y.version - x.version)[0];
    const current = mine?.version === d.version;
    return {
      documentId: String(d._id),
      title: d.title,
      summary: d.summary,
      version: d.version,
      status: current ? 'accepted' : mine ? 'new_version' : 'pending',
      acceptedAt: current ? mine.acceptedAt : null,
      updatedAt: d.updatedAt,
    };
  });
}

/** One assigned policy, with its full text, for reading before accepting. */
export async function myPolicy(workspaceId: string | null | undefined, employee: { _id: unknown; userId?: unknown; status?: string }, documentId: string) {
  const list = await myPolicies(workspaceId, employee);
  const entry = list.find((p) => p.documentId === documentId);
  if (!entry) throw new ApiError(404, 'Policy not found');
  const doc = await DocumentRecord.findById(documentId).select('title summary content fileUrl version updatedAt').lean();
  return { ...entry, content: doc?.content ?? '', fileUrl: doc?.fileUrl ?? null };
}

/** Accept the version I read. Accepting an older version than the current one is refused. */
export async function acceptPolicy(
  workspaceId: string | null | undefined,
  employee: { _id: unknown; userId?: unknown; status?: string },
  userId: string,
  documentId: string,
  version: unknown
) {
  const orgId = requireWorkspaceId(workspaceId);
  const entry = (await myPolicies(orgId, employee)).find((p) => p.documentId === documentId);
  if (!entry) throw new ApiError(404, 'Policy not found');
  const v = Number(version);
  if (!Number.isInteger(v) || v !== entry.version) {
    throw new ApiError(409, `This policy has changed to version ${entry.version} since you opened it. Please read it again before accepting.`);
  }
  try {
    await PolicyAcceptance.create({
      taskflowOrganizationId: toOrgOid(orgId),
      documentId: oid(documentId),
      version: v,
      employeeId: oid(employee._id),
      userId: oid(userId),
      acceptedAt: new Date(),
    });
    logAudit({ userId, action: 'documents.policy.accept', resourceType: 'document', resourceId: documentId, meta: { version: v, employeeId: String(employee._id) } });
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err; // already accepted: nothing to do
  }
  return (await myPolicies(orgId, employee)).find((p) => p.documentId === documentId)!;
}

// ── Reminders job ─────────────────────────────────────────────────────────

/**
 * Remind people who have not accepted the current version, every `remindEveryDays` days. Keyed by
 * policy, version, person and period, so each reminder is sent once; a new version asks again at once.
 */
export async function remindPendingPolicies(now = new Date()): Promise<number> {
  let sent = 0;
  const assignments = await PolicyAssignment.find({ active: true, remindEveryDays: { $gt: 0 } }).lean();
  for (const a of assignments) {
    const doc = await DocumentRecord.findById(a.documentId).select('title version status kind').lean();
    if (!doc || doc.kind !== 'policy' || !LIVE(doc.status)) continue;
    const audience = (await audienceOf(a)).filter((e) => e.userId);
    const accepted = await acceptedVersions(doc._id as Oid, audience.map((e) => e._id));
    const period = Math.floor((now.getTime() - new Date(a.updatedAt).getTime()) / (a.remindEveryDays * DAY));
    // The first ask goes out when the policy is assigned, published or changed; reminders follow after.
    if (period < 1) continue;
    const due: string[] = [];
    for (const e of audience) {
      if (accepted.get(String(e._id))?.version === doc.version) continue;
      if (await claimReminder('policy', `${String(doc._id)}:v${doc.version}:${String(e._id)}:${period}`)) due.push(String(e.userId));
    }
    if (due.length) {
      notifyPending(due, doc as never, true);
      sent += due.length;
    }
  }
  return sent;
}
