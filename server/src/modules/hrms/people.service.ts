import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { notifyUser } from '../notifications/notificationDispatch.service';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import {
  HrmsCandidate,
  HrmsChecklist,
  HrmsChecklistTemplate,
  HrmsJobOpening,
  HrmsReview,
  HrmsReviewCycle,
} from './models/hrmsPeople.model';
import { assertValidManager, managerUserIdOf } from './managers';
import { createWithCode } from './employeeCode';
import { Role } from '../roles/role.model';
import { User } from '../auth/user.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import { withRuleGainCheck } from '../auth/accessProfile';
import type { GrantActor } from '../auth/grantGuard';
import { requestAccount } from './accountLink';
import { assertCanSetPay, payAccessFor, withoutPay } from './payAccess';
import { getHrSettings } from './policy.service';
import { type Reach, assertReaches, assertReachesEveryone, employeeFilter, reaches } from './dataScope';

/** Who is looking at recruitment: their HR reach, and whether they hold a recruitment permission at all. */
export type RecruitmentView = { userId: string; reach: Reach; canRead: boolean };

/** Jobs a limited reach covers: hired for by someone in reach, or for the viewer's own department. */
function jobFilter(reach: Reach): Record<string, unknown> {
  if (reach === null) return {};
  return {
    $or: [
      { hiringManagerId: { $in: [...reach.userIds].map(oid) } },
      ...(reach.departments.length ? [{ department: { $in: reach.departments } }] : []),
    ],
  };
}

function jobInReach(reach: Reach, job: { hiringManagerId?: unknown; department?: string | null } | null): boolean {
  if (!job) return false;
  if (reach === null) return true;
  if (job.hiringManagerId && reach.userIds.has(String(job.hiringManagerId))) return true;
  return Boolean(job.department && reach.departments.includes(job.department));
}

export async function assertCandidateJobInReach(reach: Reach, jobId: unknown) {
  if (reach === null) return;
  const job = await HrmsJobOpening.findById(jobId).select('hiringManagerId department').lean();
  if (!jobInReach(reach, job)) throw new ApiError(404, 'Candidate not found');
}


const oid = (id: string) => new mongoose.Types.ObjectId(id);
const isId = (v: unknown) => typeof v === 'string' && mongoose.Types.ObjectId.isValid(v);

// ── Checklists ───────────────────────────────────────────────────────────

export async function listTemplates(ws: string | null | undefined, kind?: string) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  return HrmsChecklistTemplate.find({ taskflowOrganizationId: orgOid, ...(kind ? { kind } : {}) }).sort({ name: 1 }).lean();
}

export async function saveTemplate(ws: string | null | undefined, input: Record<string, unknown>, id?: string) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const data: Record<string, unknown> = {};
  if (typeof input.name === 'string') data.name = input.name.trim().slice(0, 80);
  if (input.kind === 'onboarding' || input.kind === 'offboarding') data.kind = input.kind;
  if (typeof input.active === 'boolean') data.active = input.active;
  if (Array.isArray(input.tasks)) {
    data.tasks = input.tasks
      .map((t: Record<string, unknown>) => ({
        title: String(t.title ?? '').trim().slice(0, 200),
        description: t.description ? String(t.description).slice(0, 1000) : undefined,
        assignTo: String(t.assignTo ?? 'hr'),
        dueOffsetDays: Number(t.dueOffsetDays) || 0,
      }))
      .filter((t) => t.title)
      .slice(0, 60);
  }
  if (id) {
    const doc = await HrmsChecklistTemplate.findOneAndUpdate({ _id: id, taskflowOrganizationId: orgOid }, { $set: data }, { new: true }).lean();
    if (!doc) throw new ApiError(404, 'Template not found');
    return doc;
  }
  if (!data.name || !data.kind) throw new ApiError(400, 'name and kind are required');
  return (await HrmsChecklistTemplate.create({ ...data, taskflowOrganizationId: orgOid })).toObject();
}

export async function startChecklist(
  ws: string | null | undefined,
  input: { employeeId?: string; templateId?: string; startDate?: string },
  actorId: string,
  reach: Reach = null
) {
  assertReaches(reach, input.employeeId);
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const [employee, template] = await Promise.all([
    HrmsEmployee.findOne({ _id: input.employeeId, taskflowOrganizationId: orgOid }).lean(),
    HrmsChecklistTemplate.findOne({ _id: input.templateId, taskflowOrganizationId: orgOid }).lean(),
  ]);
  if (!employee) throw new ApiError(404, 'Employee not found');
  if (!template) throw new ApiError(404, 'Template not found');
  const start = input.startDate ? new Date(input.startDate) : template.kind === 'offboarding' && employee.exitDate ? new Date(employee.exitDate) : new Date(employee.joinedDate);
  const manager = await managerUserIdOf(employee);
  const tasks = template.tasks.map((t) => {
    const assignee =
      t.assignTo === 'employee' ? employee.userId : t.assignTo === 'manager' ? manager : t.assignTo === 'hr' ? actorId : isId(t.assignTo) ? t.assignTo : actorId;
    return {
      title: t.title,
      description: t.description,
      assigneeId: assignee ? oid(String(assignee)) : undefined,
      dueDate: new Date(start.getTime() + (t.dueOffsetDays ?? 0) * 86_400_000),
    };
  });
  const doc = await HrmsChecklist.create({
    taskflowOrganizationId: orgOid,
    employeeId: employee._id,
    templateId: template._id,
    kind: template.kind,
    name: `${template.name} — ${employee.name}`,
    startDate: start,
    tasks,
    createdBy: oid(actorId),
  });
  const assignees = [...new Set(tasks.map((t) => (t.assigneeId ? String(t.assigneeId) : '')).filter(Boolean))];
  await Promise.all(
    assignees.map((userId) =>
      notifyUser({
        userId,
        eventKey: 'system_alert',
        title: `${template.kind === 'onboarding' ? 'Onboarding' : 'Offboarding'} tasks for ${employee.name}`,
        body: `${tasks.filter((t) => String(t.assigneeId) === userId).length} task(s) assigned to you`,
        link: '/hrms/onboarding',
      }).catch(() => undefined)
    )
  );
  return doc.toObject();
}

export async function listChecklists(ws: string | null | undefined, query: { status?: string; employeeId?: string; mine?: string }, userId: string, reach: Reach = null) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const filter: Record<string, unknown> = { taskflowOrganizationId: orgOid };
  // Checklists of people in reach, plus any with a task for the viewer.
  if (reach !== null && query.mine !== '1') filter.$or = [employeeFilter(reach, 'employeeId'), { 'tasks.assigneeId': oid(userId) }];
  if (query.status) filter.status = query.status;
  if (query.employeeId) filter.employeeId = query.employeeId;
  if (query.mine === '1') filter['tasks.assigneeId'] = oid(userId);
  return HrmsChecklist.find(filter).populate('employeeId', 'name employeeCode').populate('tasks.assigneeId', 'name').sort({ startDate: -1 }).limit(200).lean();
}

/** Tick a task. HR can tick anything; others only their own tasks. */
export async function setTaskDone(
  ws: string | null | undefined,
  checklistId: string,
  taskId: string,
  done: boolean,
  user: { id: string; canManage: boolean },
  reach: Reach = null
) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const cl = await HrmsChecklist.findOne({ _id: checklistId, taskflowOrganizationId: orgOid });
  if (!cl) throw new ApiError(404, 'Checklist not found');
  const task = cl.tasks.id(taskId);
  if (!task) throw new ApiError(404, 'Task not found');
  if (!(user.canManage && reaches(reach, cl.employeeId)) && String(task.assigneeId) !== user.id) throw new ApiError(403, 'This task is assigned to someone else');
  task.done = done;
  task.doneAt = done ? new Date() : undefined;
  task.doneBy = done ? oid(user.id) : undefined;
  cl.status = cl.tasks.every((t) => t.done) ? 'completed' : 'open';
  await cl.save();
  return cl.toObject();
}

// ── Recruitment ──────────────────────────────────────────────────────────

export async function listJobs(ws: string | null | undefined, status?: string, view?: RecruitmentView) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const scope: Record<string, unknown> = {};
  if (view && !(view.canRead && view.reach === null)) {
    // Interviewers see the jobs of candidates they interview.
    const interviewing = await HrmsCandidate.find({ taskflowOrganizationId: orgOid, 'interviews.interviewerIds': oid(view.userId) }).distinct('jobId');
    const or: Record<string, unknown>[] = [{ _id: { $in: interviewing } }];
    if (view.canRead) or.push(jobFilter(view.reach));
    scope.$or = or;
  }
  const jobs = await HrmsJobOpening.find({ taskflowOrganizationId: orgOid, ...scope, ...(status ? { status } : {}) })
    .populate('hiringManagerId', 'name')
    .sort({ createdAt: -1 })
    .lean();
  const counts = await HrmsCandidate.aggregate<{ _id: mongoose.Types.ObjectId; active: number; hired: number }>([
    { $match: { taskflowOrganizationId: orgOid } },
    { $group: { _id: '$jobId', active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } }, hired: { $sum: { $cond: [{ $eq: ['$status', 'hired'] }, 1, 0] } } } },
  ]);
  return jobs.map((j) => ({ ...j, candidates: counts.find((c) => String(c._id) === String(j._id)) ?? { active: 0, hired: 0 } }));
}

export async function saveJob(ws: string | null | undefined, input: Record<string, unknown>, id?: string, reach: Reach = null) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  if (reach !== null) {
    if (id && !jobInReach(reach, await HrmsJobOpening.findOne({ _id: id, taskflowOrganizationId: orgOid }).select('hiringManagerId department').lean())) {
      throw new ApiError(404, 'Job not found');
    }
    const next = { hiringManagerId: input.hiringManagerId, department: typeof input.department === 'string' ? input.department.trim() : undefined };
    if ((!id || 'hiringManagerId' in input || 'department' in input) && !jobInReach(reach, next)) {
      throw new ApiError(403, 'Set a hiring manager within your team, or your own department');
    }
  }
  const data: Record<string, unknown> = {};
  for (const k of ['title', 'department', 'location', 'employmentType', 'description', 'currency'] as const) {
    if (typeof input[k] === 'string') data[k] = (input[k] as string).trim().slice(0, k === 'description' ? 10_000 : 120);
  }
  for (const k of ['openings', 'salaryMin', 'salaryMax'] as const) if (input[k] !== undefined && input[k] !== '') data[k] = Number(input[k]);
  if (data.openings !== undefined && (!Number.isInteger(data.openings) || (data.openings as number) < 1)) throw new ApiError(400, 'Openings must be a whole number of 1 or more');
  if (input.published !== undefined) data.published = Boolean(input.published);
  if (['draft', 'open', 'on_hold', 'closed'].includes(String(input.status))) data.status = input.status;
  if (isId(input.hiringManagerId)) data.hiringManagerId = oid(String(input.hiringManagerId));
  if (Array.isArray(input.stages)) data.stages = input.stages.map((s) => String(s).trim()).filter(Boolean).slice(0, 15);
  if (id) {
    const doc = await HrmsJobOpening.findOneAndUpdate({ _id: id, taskflowOrganizationId: orgOid }, { $set: data }, { new: true }).lean();
    if (!doc) throw new ApiError(404, 'Job not found');
    return doc;
  }
  if (!data.title) throw new ApiError(400, 'Title is required');
  if (!data.stages) data.stages = (await getHrSettings(String(orgOid))).recruitmentStages;
  return (await HrmsJobOpening.create({ ...data, taskflowOrganizationId: orgOid })).toObject();
}

export async function listCandidates(ws: string | null | undefined, jobId: string, view?: RecruitmentView) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const filter: Record<string, unknown> = { taskflowOrganizationId: orgOid, jobId };
  let interviewerOnly = false;
  if (view && !(view.canRead && view.reach === null)) {
    const job = isId(jobId) ? await HrmsJobOpening.findOne({ _id: jobId, taskflowOrganizationId: orgOid }).select('hiringManagerId department').lean() : null;
    if (!(view.canRead && jobInReach(view.reach, job))) {
      // Only the candidates they interview, without pay expectations.
      filter['interviews.interviewerIds'] = oid(view.userId);
      interviewerOnly = true;
    }
  }
  const rows = await HrmsCandidate.find(filter).populate('interviews.interviewerIds', 'name').sort({ updatedAt: -1 }).lean();
  return interviewerOnly ? rows.map(({ expectedSalary: _pay, ...c }) => c) : rows;
}

export async function saveCandidate(ws: string | null | undefined, input: Record<string, unknown>, id?: string, reach: Reach = null) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const data: Record<string, unknown> = {};
  for (const k of ['name', 'email', 'phone', 'source', 'resumeUrl', 'notes', 'rejectionReason'] as const) {
    if (typeof input[k] === 'string') data[k] = (input[k] as string).trim().slice(0, k === 'notes' ? 5000 : 300);
  }
  if (input.expectedSalary !== undefined && input.expectedSalary !== '') data.expectedSalary = Number(input.expectedSalary);
  if (['active', 'rejected', 'withdrawn'].includes(String(input.status))) data.status = input.status;
  if (id) {
    const existing = await HrmsCandidate.findOne({ _id: id, taskflowOrganizationId: orgOid });
    if (!existing) throw new ApiError(404, 'Candidate not found');
    await assertCandidateJobInReach(reach, existing.jobId);
    if (typeof input.stage === 'string') {
      const job = await HrmsJobOpening.findById(existing.jobId).select('stages').lean();
      if (!job?.stages.includes(input.stage)) throw new ApiError(400, 'Unknown stage for this job');
      data.stage = input.stage;
    }
    existing.set(data);
    await existing.save();
    return existing.toObject();
  }
  const job = await HrmsJobOpening.findOne({ _id: input.jobId, taskflowOrganizationId: orgOid }).lean();
  if (!job || !jobInReach(reach, job)) throw new ApiError(404, 'Job not found');
  if (!data.name) throw new ApiError(400, 'Name is required');
  return (await HrmsCandidate.create({ ...data, taskflowOrganizationId: orgOid, jobId: job._id, stage: job.stages[0] ?? 'Applied' })).toObject();
}

export async function addInterview(ws: string | null | undefined, candidateId: string, input: Record<string, unknown>, actorId: string, reach: Reach = null) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const c = await HrmsCandidate.findOne({ _id: candidateId, taskflowOrganizationId: orgOid });
  if (!c) throw new ApiError(404, 'Candidate not found');
  await assertCandidateJobInReach(reach, c.jobId);
  const at = new Date(String(input.at ?? ''));
  if (Number.isNaN(at.getTime())) throw new ApiError(400, 'Interview time required');
  const interviewerIds = (Array.isArray(input.interviewerIds) ? input.interviewerIds : []).filter(isId).map((x) => oid(String(x)));
  c.interviews.push({
    at,
    mode: String(input.mode ?? 'video'),
    interviewerIds,
    rating: input.rating ? Number(input.rating) : undefined,
    feedback: input.feedback ? String(input.feedback).slice(0, 5000) : undefined,
    recommendation: input.recommendation as never,
    createdBy: oid(actorId),
  });
  await c.save();
  await Promise.all(
    interviewerIds.map((u) =>
      notifyUser({
        userId: String(u),
        eventKey: 'system_alert',
        title: `Interview: ${c.name}`,
        body: at.toLocaleString(),
        link: '/hrms/recruitment',
      }).catch(() => undefined)
    )
  );
  return c.toObject();
}

/** Hire: creates the employee record (and optionally starts an onboarding checklist). */
export async function hireCandidate(
  ws: string | null | undefined,
  candidateId: string,
  input: {
    employeeCode?: string;
    joinedDate?: string;
    annualCtc?: number;
    currency?: string;
    designation?: string;
    managerId?: string;
    onboardingTemplateId?: string;
    /**
     * The new hire's sign-in account (AUT-35). create: make it now (needs the add-users permission);
     * request: ask someone who can add users. Either way an existing account with that email is linked.
     */
    account?: { action?: 'create' | 'request' | 'none'; roleId?: string };
  },
  actorId: string,
  permissions: string[],
  reach: Reach = null,
  actorRole?: string
) {
  const access = payAccessFor(permissions);
  assertCanSetPay({ annualCtc: input.annualCtc }, access);
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const c = await HrmsCandidate.findOne({ _id: candidateId, taskflowOrganizationId: orgOid }).lean();
  if (!c) throw new ApiError(404, 'Candidate not found');
  await assertCandidateJobInReach(reach, c.jobId);
  if (reach !== null && !reaches(reach, input.managerId)) throw new ApiError(403, 'Choose a manager within your team for the new hire');
  if (c.status === 'hired') throw new ApiError(409, 'Already hired');
  if (c.status !== 'active') throw new ApiError(409, `This candidate is ${c.status}; make them active before hiring`);

  // Check everything first: a hire that fails halfway leaves an employee without a checklist.
  // An accepted offer gives the terms; HR can make one compulsory (AUT-37).
  const hrSettings = (await getHrSettings(String(orgOid))) as { requireAcceptedOffer?: boolean };
  const { acceptedOfferFor } = await import('./offers.service');
  const offer = await acceptedOfferFor(c._id);
  if (hrSettings.requireAcceptedOffer && !offer) throw new ApiError(409, 'This candidate needs an accepted offer before they can be hired');
  const joinedDate = input.joinedDate ? new Date(input.joinedDate) : offer?.joiningDate ? new Date(offer.joiningDate) : new Date();
  if (Number.isNaN(joinedDate.getTime())) throw new ApiError(400, 'Joining date is not valid');
  const annualCtc = input.annualCtc === undefined ? (offer?.annualCtc ?? c.expectedSalary ?? 0) : Number(input.annualCtc);
  if (offer && !input.designation && offer.designation) input = { ...input, designation: offer.designation };
  if (offer && !input.currency && offer.currency) input = { ...input, currency: offer.currency };
  if (!Number.isFinite(annualCtc) || annualCtc < 0) throw new ApiError(400, 'CTC must be zero or more');
  await assertValidManager(orgOid, input.managerId);
  if (input.onboardingTemplateId) {
    const template = isId(input.onboardingTemplateId)
      ? await HrmsChecklistTemplate.findOne({ _id: input.onboardingTemplateId, taskflowOrganizationId: orgOid }).select('kind active').lean()
      : null;
    if (!template || template.kind !== 'onboarding' || template.active === false) throw new ApiError(400, 'Choose an active onboarding template');
  }

  const accountAction = input.account?.action ?? 'none';
  if (accountAction !== 'none') {
    if (!['create', 'request'].includes(accountAction)) throw new ApiError(400, 'Account action must be create, request or none');
    if (!c.email) throw new ApiError(400, 'Add the candidate’s email before asking for an account');
    const roleId = input.account?.roleId;
    if (roleId && !(isId(roleId) && (await Role.exists({ _id: roleId })))) throw new ApiError(400, 'Choose a valid role for the account');
    if (accountAction === 'create') {
      if (!roleId) throw new ApiError(400, 'Choose the role for the new account');
      if (actorRole !== 'admin' && !userHasPermission(permissions, TASK_FLOW_PERMISSIONS.AUTH.USER.CREATE)) {
        throw new ApiError(403, 'Creating accounts needs the add users permission. Choose "request an account" instead.');
      }
    }
  }

  const job = await HrmsJobOpening.findById(c.jobId).lean();
  const stages = job?.stages ?? [];
  // Take one of the opening's places first: never more hires than openings, even at the same moment.
  await claimOpening(c.jobId);
  // Claim the candidate, so a double click or two people hiring at once create one employee.
  const claimed = await HrmsCandidate.updateOne(
    { _id: c._id, status: 'active' },
    { $set: { status: 'hired', ...(stages.length ? { stage: stages[stages.length - 1] } : {}) } }
  );
  if (!claimed.modifiedCount) {
    await releaseOpening(c.jobId);
    throw new ApiError(409, 'Already hired');
  }

  let employee;
  try {
    employee = await createWithCode(orgOid, input.employeeCode, (code) =>
      HrmsEmployee.create({
        taskflowOrganizationId: orgOid,
        employeeCode: code,
        name: c.name,
        email: c.email,
        phone: c.phone,
        department: job?.department,
        designation: input.designation?.trim() || job?.title,
        managerId: input.managerId || undefined,
        employmentType: job?.employmentType === 'contract' || job?.employmentType === 'intern' || job?.employmentType === 'part_time' ? job.employmentType : 'full_time',
        status: 'probation',
        joinedDate,
        location: job?.location,
        annualCtc,
        currency: input.currency || job?.currency || 'USD',
      })
    );
  } catch (err) {
    await HrmsCandidate.updateOne({ _id: c._id }, { $set: { status: 'active', stage: c.stage } });
    await releaseOpening(c.jobId);
    throw err;
  }
  await HrmsCandidate.updateOne({ _id: c._id }, { $set: { hiredEmployeeId: employee._id } });
  // The last place filled closes the opening (and takes it off the careers page).
  await HrmsJobOpening.updateOne({ _id: c.jobId, $expr: { $gte: ['$filled', '$openings'] } }, { $set: { status: 'closed' } });
  const checklist = input.onboardingTemplateId
    ? await startChecklist(String(orgOid), { employeeId: String(employee._id), templateId: input.onboardingTemplateId }, actorId)
    : null;
  const account = await setUpHireAccount(String(orgOid), employee, accountAction, input.account?.roleId, { id: actorId, permissions, role: actorRole });
  const fresh = await HrmsEmployee.findById(employee._id).lean();
  return { employee: withoutPay(fresh ?? employee.toObject(), access), checklist, account };
}

/**
 * Take one place in a job opening (AUT-37). Openings created before places were counted start from
 * the number of people already hired into them.
 */
async function claimOpening(jobId: unknown) {
  const job = await HrmsJobOpening.findById(jobId).select('filled openings').lean();
  if (!job) throw new ApiError(404, 'Job not found');
  if (job.filled == null) {
    const hired = await HrmsCandidate.countDocuments({ jobId, status: 'hired' });
    await HrmsJobOpening.updateOne({ _id: jobId, filled: { $exists: false } }, { $set: { filled: hired } });
  }
  const taken = await HrmsJobOpening.updateOne({ _id: jobId, $expr: { $lt: ['$filled', '$openings'] } }, { $inc: { filled: 1 } });
  if (!taken.modifiedCount) {
    throw new ApiError(409, `All ${job.openings} opening(s) for this job are filled. Add openings to the job to hire more people.`);
  }
}

async function releaseOpening(jobId: unknown) {
  await HrmsJobOpening.updateOne({ _id: jobId, filled: { $gt: 0 } }, { $inc: { filled: -1 } });
}

type HireAccountResult = {
  status: 'created' | 'linked' | 'requested' | 'none' | 'failed';
  userId?: string;
  message?: string;
  role?: { applied: boolean; requested: string; current: string; message?: string };
};

/**
 * After a hire: connect the new employee to a sign-in account (AUT-35). The hire itself never fails
 * because of this; anything that goes wrong is reported, and turned into a request for an account.
 */
async function setUpHireAccount(
  orgId: string,
  employee: { _id: unknown; name: string; email?: string | null },
  action: 'create' | 'request' | 'none',
  roleId: string | undefined,
  actor: GrantActor
): Promise<HireAccountResult> {
  if (action === 'none' || !employee.email) return { status: 'none' };
  const employeeId = String(employee._id);
  const email = String(employee.email).toLowerCase().trim();
  const linkUser = async (userId: string) => {
    const orgOid = toOrgOid(orgId);
    if (await HrmsEmployee.exists({ taskflowOrganizationId: orgOid, userId, _id: { $ne: employee._id } })) {
      throw new ApiError(409, 'That account is already linked to another employee');
    }
    // The linked account can fall under team or level access rules: checked like any other link.
    await withRuleGainCheck(
      orgOid,
      actor,
      () => HrmsEmployee.updateOne({ _id: employee._id }, { $set: { userId: new mongoose.Types.ObjectId(userId), 'accountRequest.status': 'done', 'accountRequest.doneAt': new Date() } }),
      () => HrmsEmployee.updateOne({ _id: employee._id }, { $unset: { userId: 1 } })
    );
  };
  try {
    if (action === 'create') {
      const { invite } = await import('../users/users.service');
      try {
        const out = await invite({ name: employee.name, email, roleId: roleId! }, orgId, actor);
        const userId = String((out.user as { _id: unknown })._id);
        await linkUser(userId);
        return { status: out.inviteKind === 'new_user' ? 'created' : 'linked', userId, role: out.role, message: out.inviteKind === 'new_user' ? 'Account created; a set-password email was sent.' : out.role.message };
      } catch (err) {
        // Already in this workspace: just connect them.
        if (err instanceof ApiError && err.statusCode === 409 && /already a member/.test(err.message)) {
          const u = await User.findOne({ email }).select('_id').lean();
          if (u) {
            await linkUser(String(u._id));
            return { status: 'linked', userId: String(u._id), message: 'This person already had an account in this workspace; it is now linked.' };
          }
        }
        throw err;
      }
    }
    // request: an account that already exists in this workspace is linked straight away.
    const existing = await User.findOne({ email }).select('_id').lean();
    if (existing && (await OrganizationMember.exists({ organization: toOrgOid(orgId), user: existing._id, status: 'active' }))) {
      await linkUser(String(existing._id));
      return { status: 'linked', userId: String(existing._id), message: 'This person already had an account in this workspace; it is now linked.' };
    }
    await requestAccount(orgId, employeeId, roleId, actor.id, { name: employee.name, email });
    return { status: 'requested', message: 'People who can add users were asked to create the account.' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not set up the account';
    // Don't lose it: ask for the account instead.
    await requestAccount(orgId, employeeId, roleId, actor.id, { name: employee.name, email }).catch(() => undefined);
    return { status: 'failed', message: `${message}. An account request was raised instead.` };
  }
}

// ── Appraisals ───────────────────────────────────────────────────────────

export async function listCycles(ws: string | null | undefined) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  return HrmsReviewCycle.find({ taskflowOrganizationId: orgOid }).sort({ periodStart: -1 }).lean();
}

export async function saveCycle(ws: string | null | undefined, input: Record<string, unknown>, id?: string, reach: Reach = null) {
  assertReachesEveryone(reach, 'A review cycle');
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const data: Record<string, unknown> = {};
  if (typeof input.name === 'string') data.name = input.name.trim().slice(0, 80);
  for (const k of ['periodStart', 'periodEnd'] as const) if (input[k]) data[k] = new Date(String(input[k]));
  if (['draft', 'active', 'closed'].includes(String(input.status))) data.status = input.status;
  if (input.ratingScale !== undefined) data.ratingScale = Number(input.ratingScale);
  if (typeof input.selfReview === 'boolean') data.selfReview = input.selfReview;
  if (Array.isArray(input.questions)) data.questions = input.questions.map((q) => String(q).trim()).filter(Boolean).slice(0, 20);
  if (id) {
    const doc = await HrmsReviewCycle.findOneAndUpdate({ _id: id, taskflowOrganizationId: orgOid }, { $set: data }, { new: true }).lean();
    if (!doc) throw new ApiError(404, 'Cycle not found');
    return doc;
  }
  if (!data.name || !data.periodStart || !data.periodEnd) throw new ApiError(400, 'name, periodStart and periodEnd are required');
  return (await HrmsReviewCycle.create({ ...data, taskflowOrganizationId: orgOid })).toObject();
}

/** Create a review for each active employee (reviewer = their manager, or the person launching). */
export async function launchCycle(ws: string | null | undefined, cycleId: string, actorId: string, reach: Reach = null) {
  assertReachesEveryone(reach, 'A review cycle');
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const cycle = await HrmsReviewCycle.findOne({ _id: cycleId, taskflowOrganizationId: orgOid });
  if (!cycle) throw new ApiError(404, 'Cycle not found');
  const employees = await HrmsEmployee.find({ taskflowOrganizationId: orgOid, status: { $in: ['active', 'probation'] } }).lean();
  let created = 0;
  for (const e of employees) {
    const reviewer = (await managerUserIdOf(e)) ?? actorId;
    const res = await HrmsReview.updateOne(
      { cycleId: cycle._id, employeeId: e._id },
      {
        $setOnInsert: {
          taskflowOrganizationId: orgOid,
          employeeUserId: e.userId,
          reviewerId: oid(reviewer),
          status: cycle.selfReview && e.userId ? 'pending_self' : 'pending_manager',
        },
      },
      { upsert: true }
    );
    if (res.upsertedCount) {
      created++;
      const notify = cycle.selfReview && e.userId ? String(e.userId) : reviewer;
      void notifyUser({ userId: notify, eventKey: 'approval_requested', title: `Performance review: ${cycle.name}`, body: e.name, link: '/hrms/appraisals' }).catch(() => undefined);
    }
  }
  cycle.status = 'active';
  await cycle.save();
  return { created };
}

export async function listReviews(ws: string | null | undefined, query: { cycleId?: string; mine?: string }, userId: string, canManage: boolean, reach: Reach = null) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const filter: Record<string, unknown> = { taskflowOrganizationId: orgOid };
  if (query.cycleId) filter.cycleId = query.cycleId;
  const mine = [{ employeeUserId: oid(userId) }, { reviewerId: oid(userId) }];
  if (query.mine === '1' || !canManage) filter.$or = mine;
  else if (reach !== null) filter.$or = [...mine, employeeFilter(reach, 'employeeId')];
  return HrmsReview.find(filter).populate('employeeId', 'name designation').populate('reviewerId', 'name').populate('cycleId', 'name ratingScale questions').lean();
}

/** Employee fills self part; reviewer fills manager part and final rating. */
export async function submitReview(ws: string | null | undefined, reviewId: string, input: Record<string, unknown>, userId: string, canManageAll: boolean, reach: Reach = null) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const r = await HrmsReview.findOne({ _id: reviewId, taskflowOrganizationId: orgOid });
  if (!r) throw new ApiError(404, 'Review not found');
  const canManage = canManageAll && reaches(reach, r.employeeId);
  const isEmployee = String(r.employeeUserId) === userId;
  const isReviewer = String(r.reviewerId) === userId || canManage;
  if (Array.isArray(input.goals) && (isReviewer || r.status === 'pending_self')) {
    r.set(
      'goals',
      input.goals.map((g: Record<string, unknown>) => ({
        title: String(g.title ?? '').slice(0, 200),
        weight: Number(g.weight) || 1,
        selfScore: g.selfScore != null ? Number(g.selfScore) : undefined,
        managerScore: isReviewer && g.managerScore != null ? Number(g.managerScore) : undefined,
        comment: g.comment ? String(g.comment).slice(0, 2000) : undefined,
      }))
    );
  }
  if (r.status === 'pending_self' && isEmployee) {
    if (Array.isArray(input.selfAnswers)) r.selfAnswers = input.selfAnswers.map((a) => String(a).slice(0, 5000));
    if (input.submit) {
      r.status = 'pending_manager';
      if (r.reviewerId) void notifyUser({ userId: String(r.reviewerId), eventKey: 'approval_requested', title: 'Self-review submitted', body: 'Ready for your review', link: '/hrms/appraisals' }).catch(() => undefined);
    }
  } else if (r.status === 'pending_manager' && isReviewer) {
    if (Array.isArray(input.managerAnswers)) r.managerAnswers = input.managerAnswers.map((a) => String(a).slice(0, 5000));
    if (input.finalRating !== undefined) r.finalRating = Number(input.finalRating);
    if (input.submit) {
      if (r.finalRating == null) throw new ApiError(400, 'Set a final rating before completing');
      r.status = 'completed';
      r.completedAt = new Date();
      if (r.employeeUserId) void notifyUser({ userId: String(r.employeeUserId), eventKey: 'approval_decided', title: 'Your performance review is complete', body: '', link: '/hrms/appraisals' }).catch(() => undefined);
    }
  } else {
    throw new ApiError(403, 'This review is not waiting on you');
  }
  await r.save();
  return r.toObject();
}
