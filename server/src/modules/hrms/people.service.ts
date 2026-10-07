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
import { getHrSettings } from './policy.service';

const oid = (id: string) => new mongoose.Types.ObjectId(id);
const isId = (v: unknown) => typeof v === 'string' && mongoose.Types.ObjectId.isValid(v);

async function managerUserId(employee: { managerId?: unknown }): Promise<string | undefined> {
  if (!employee.managerId) return undefined;
  const mgr = await HrmsEmployee.findById(employee.managerId).select('userId').lean();
  return mgr?.userId ? String(mgr.userId) : undefined;
}

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
  actorId: string
) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const [employee, template] = await Promise.all([
    HrmsEmployee.findOne({ _id: input.employeeId, taskflowOrganizationId: orgOid }).lean(),
    HrmsChecklistTemplate.findOne({ _id: input.templateId, taskflowOrganizationId: orgOid }).lean(),
  ]);
  if (!employee) throw new ApiError(404, 'Employee not found');
  if (!template) throw new ApiError(404, 'Template not found');
  const start = input.startDate ? new Date(input.startDate) : template.kind === 'offboarding' && employee.exitDate ? new Date(employee.exitDate) : new Date(employee.joinedDate);
  const manager = await managerUserId(employee);
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

export async function listChecklists(ws: string | null | undefined, query: { status?: string; employeeId?: string; mine?: string }, userId: string) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const filter: Record<string, unknown> = { taskflowOrganizationId: orgOid };
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
  user: { id: string; canManage: boolean }
) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const cl = await HrmsChecklist.findOne({ _id: checklistId, taskflowOrganizationId: orgOid });
  if (!cl) throw new ApiError(404, 'Checklist not found');
  const task = cl.tasks.id(taskId);
  if (!task) throw new ApiError(404, 'Task not found');
  if (!user.canManage && String(task.assigneeId) !== user.id) throw new ApiError(403, 'This task is assigned to someone else');
  task.done = done;
  task.doneAt = done ? new Date() : undefined;
  task.doneBy = done ? oid(user.id) : undefined;
  cl.status = cl.tasks.every((t) => t.done) ? 'completed' : 'open';
  await cl.save();
  return cl.toObject();
}

// ── Recruitment ──────────────────────────────────────────────────────────

export async function listJobs(ws: string | null | undefined, status?: string) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const jobs = await HrmsJobOpening.find({ taskflowOrganizationId: orgOid, ...(status ? { status } : {}) })
    .populate('hiringManagerId', 'name')
    .sort({ createdAt: -1 })
    .lean();
  const counts = await HrmsCandidate.aggregate<{ _id: mongoose.Types.ObjectId; active: number; hired: number }>([
    { $match: { taskflowOrganizationId: orgOid } },
    { $group: { _id: '$jobId', active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } }, hired: { $sum: { $cond: [{ $eq: ['$status', 'hired'] }, 1, 0] } } } },
  ]);
  return jobs.map((j) => ({ ...j, candidates: counts.find((c) => String(c._id) === String(j._id)) ?? { active: 0, hired: 0 } }));
}

export async function saveJob(ws: string | null | undefined, input: Record<string, unknown>, id?: string) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const data: Record<string, unknown> = {};
  for (const k of ['title', 'department', 'location', 'employmentType', 'description', 'currency'] as const) {
    if (typeof input[k] === 'string') data[k] = (input[k] as string).trim().slice(0, k === 'description' ? 10_000 : 120);
  }
  for (const k of ['openings', 'salaryMin', 'salaryMax'] as const) if (input[k] !== undefined && input[k] !== '') data[k] = Number(input[k]);
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

export async function listCandidates(ws: string | null | undefined, jobId: string) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  return HrmsCandidate.find({ taskflowOrganizationId: orgOid, jobId }).populate('interviews.interviewerIds', 'name').sort({ updatedAt: -1 }).lean();
}

export async function saveCandidate(ws: string | null | undefined, input: Record<string, unknown>, id?: string) {
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
  if (!job) throw new ApiError(404, 'Job not found');
  if (!data.name) throw new ApiError(400, 'Name is required');
  return (await HrmsCandidate.create({ ...data, taskflowOrganizationId: orgOid, jobId: job._id, stage: job.stages[0] ?? 'Applied' })).toObject();
}

export async function addInterview(ws: string | null | undefined, candidateId: string, input: Record<string, unknown>, actorId: string) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const c = await HrmsCandidate.findOne({ _id: candidateId, taskflowOrganizationId: orgOid });
  if (!c) throw new ApiError(404, 'Candidate not found');
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
  input: { employeeCode?: string; joinedDate?: string; annualCtc?: number; currency?: string; designation?: string; onboardingTemplateId?: string },
  actorId: string
) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const c = await HrmsCandidate.findOne({ _id: candidateId, taskflowOrganizationId: orgOid });
  if (!c) throw new ApiError(404, 'Candidate not found');
  if (c.status === 'hired') throw new ApiError(409, 'Already hired');
  const job = await HrmsJobOpening.findById(c.jobId).lean();
  const code = String(input.employeeCode ?? '').trim();
  if (!code) throw new ApiError(400, 'Employee code is required');
  const employee = await HrmsEmployee.create({
    taskflowOrganizationId: orgOid,
    employeeCode: code,
    name: c.name,
    email: c.email,
    phone: c.phone,
    department: job?.department,
    designation: input.designation ?? job?.title,
    employmentType: job?.employmentType === 'contract' || job?.employmentType === 'intern' || job?.employmentType === 'part_time' ? job.employmentType : 'full_time',
    status: 'probation',
    joinedDate: input.joinedDate ? new Date(input.joinedDate) : new Date(),
    location: job?.location,
    annualCtc: input.annualCtc ?? c.expectedSalary ?? 0,
    currency: input.currency ?? job?.currency ?? 'USD',
  });
  c.status = 'hired';
  c.hiredEmployeeId = employee._id;
  const stages = job?.stages ?? [];
  if (stages.length) c.stage = stages[stages.length - 1];
  await c.save();
  let checklist = null;
  if (input.onboardingTemplateId) {
    checklist = await startChecklist(String(orgOid), { employeeId: String(employee._id), templateId: input.onboardingTemplateId }, actorId);
  }
  return { employee: employee.toObject(), checklist };
}

// ── Appraisals ───────────────────────────────────────────────────────────

export async function listCycles(ws: string | null | undefined) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  return HrmsReviewCycle.find({ taskflowOrganizationId: orgOid }).sort({ periodStart: -1 }).lean();
}

export async function saveCycle(ws: string | null | undefined, input: Record<string, unknown>, id?: string) {
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
export async function launchCycle(ws: string | null | undefined, cycleId: string, actorId: string) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const cycle = await HrmsReviewCycle.findOne({ _id: cycleId, taskflowOrganizationId: orgOid });
  if (!cycle) throw new ApiError(404, 'Cycle not found');
  const employees = await HrmsEmployee.find({ taskflowOrganizationId: orgOid, status: { $in: ['active', 'probation'] } }).lean();
  let created = 0;
  for (const e of employees) {
    const reviewer = (await managerUserId(e)) ?? actorId;
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

export async function listReviews(ws: string | null | undefined, query: { cycleId?: string; mine?: string }, userId: string, canManage: boolean) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const filter: Record<string, unknown> = { taskflowOrganizationId: orgOid };
  if (query.cycleId) filter.cycleId = query.cycleId;
  if (query.mine === '1' || !canManage) filter.$or = [{ employeeUserId: oid(userId) }, { reviewerId: oid(userId) }];
  return HrmsReview.find(filter).populate('employeeId', 'name designation').populate('reviewerId', 'name').populate('cycleId', 'name ratingScale questions').lean();
}

/** Employee fills self part; reviewer fills manager part and final rating. */
export async function submitReview(ws: string | null | undefined, reviewId: string, input: Record<string, unknown>, userId: string, canManage: boolean) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const r = await HrmsReview.findOne({ _id: reviewId, taskflowOrganizationId: orgOid });
  if (!r) throw new ApiError(404, 'Review not found');
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
