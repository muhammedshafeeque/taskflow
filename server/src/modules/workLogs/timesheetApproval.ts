import mongoose, { Schema } from 'mongoose';
import { Router, type Request, type Response } from 'express';
import { ApiError } from '../../utils/ApiError';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAnyPermission } from '../../middleware/requirePermission';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import { WorkLog } from './workLog.model';
import { HrmsEmployee } from '../hrms/models/hrmsEmployee.model';
import { notifyUser } from '../notifications/notificationDispatch.service';
import { managerUserIdOf } from '../hrms/managers';
import { usersWithPermission } from '../auth/usersWithPermission';
import { reachFor, reachOf, type ScopeLevel } from '../hrms/dataScope';
import { toOrgOid } from '../crm/crmWorkspace';

/**
 * Weekly timesheets: people submit a week of time logs, an approver (their
 * manager's account, else anyone with taskflow.timesheet.approve) accepts or
 * returns it. Approved logs can't be edited.
 */
const submissionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
    /** Monday 00:00 UTC of the week. */
    weekStart: { type: Date, required: true },
    status: { type: String, enum: ['submitted', 'approved', 'rejected'], default: 'submitted', index: true },
    totalMinutes: { type: Number, default: 0 },
    billableMinutes: { type: Number, default: 0 },
    note: { type: String },
    approverIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: { type: Date },
    decisionNote: { type: String },
  },
  { timestamps: true }
);
submissionSchema.index({ userId: 1, weekStart: 1 }, { unique: true });
export const TimesheetSubmission = mongoose.model('TimesheetSubmission', submissionSchema);

export function weekStartOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (x.getUTCDay() + 6) % 7; // Monday = 0
  x.setUTCDate(x.getUTCDate() - day);
  return x;
}

const T = TASK_FLOW_PERMISSIONS.TASKFLOW.TIMESHEET;

async function approversFor(userId: string, orgId?: string): Promise<string[]> {
  const emp = await HrmsEmployee.findOne({ userId }).select('managerId').lean();
  const manager = emp ? await managerUserIdOf(emp) : undefined;
  if (manager && manager !== userId) return [manager];
  const approvers = (await usersWithPermission(T.APPROVE, orgId)).filter((u) => u !== userId);
  if (!orgId || !approvers.length) return approvers;
  // Only approvers whose timesheet reach includes this person.
  const [all, dept, team] = await Promise.all([T.SCOPE.ALL, T.SCOPE.DEPARTMENT, T.SCOPE.TEAM].map((p) => usersWithPermission(p, orgId).then((ids) => new Set(ids))));
  const orgOid = toOrgOid(orgId);
  const out: string[] = [];
  for (const a of approvers) {
    const level: ScopeLevel = all.has(a) ? 'all' : dept.has(a) ? 'department' : team.has(a) ? 'team' : 'own';
    const reach = await reachOf(orgOid, a, level);
    if (reach === null || reach.userIds.has(userId)) out.push(a);
  }
  return out;
}

type R = Request & { activeOrganizationId?: string; user?: { id: string; permissions?: string[] } };
const ok = (res: Response, data: unknown) => res.json({ success: true, data });

export const timesheetApprovalRouter = Router();

/** My weeks (or a user's, for approvers). */
timesheetApprovalRouter.get(
  '/submissions',
  asyncHandler(async (req: R, res) => {
    const isApprover = userHasPermission(req.user?.permissions ?? [], T.APPROVE);
    const filter: Record<string, unknown> = {};
    if (req.query.scope === 'approve') {
      filter.status = 'submitted';
      const me = new mongoose.Types.ObjectId(req.user!.id);
      filter.userId = { $ne: me };
      if (!isApprover || !req.activeOrganizationId) filter.approverIds = me;
      else {
        // Named approver, or anyone in this workspace within the approver's timesheet reach.
        const reach = await reachFor(req, 'timesheet');
        const inReach = reach === null ? {} : { userId: { $in: [...reach.userIds].map((u) => new mongoose.Types.ObjectId(u)), $ne: me } };
        filter.$or = [{ approverIds: me }, { taskflowOrganizationId: new mongoose.Types.ObjectId(req.activeOrganizationId), ...inReach }];
      }
    } else filter.userId = new mongoose.Types.ObjectId(req.user!.id);
    ok(res, await TimesheetSubmission.find(filter).populate('userId', 'name email').sort({ weekStart: -1 }).limit(100).lean());
  })
);

timesheetApprovalRouter.post(
  '/submit',
  requireAnyPermission([T.SUBMIT]),
  asyncHandler(async (req: R, res) => {
    const week = weekStartOf(req.body?.weekStart ? new Date(String(req.body.weekStart)) : new Date());
    const end = new Date(week.getTime() + 7 * 86_400_000);
    const userId = new mongoose.Types.ObjectId(req.user!.id);
    const logs = await WorkLog.find({ author: userId, date: { $gte: week, $lt: end } }).select('minutesSpent billable approvalStatus').lean();
    if (!logs.length) throw new ApiError(400, 'No time logged that week');
    if (logs.some((l) => l.approvalStatus === 'approved')) throw new ApiError(409, 'That week is already approved');
    const approverIds = await approversFor(req.user!.id, req.activeOrganizationId);
    const totalMinutes = logs.reduce((s, l) => s + l.minutesSpent, 0);
    const billableMinutes = logs.filter((l) => l.billable !== false).reduce((s, l) => s + l.minutesSpent, 0);
    const sub = await TimesheetSubmission.findOneAndUpdate(
      { userId, weekStart: week },
      {
        $set: {
          status: 'submitted',
          totalMinutes,
          billableMinutes,
          note: req.body?.note ? String(req.body.note).slice(0, 1000) : undefined,
          approverIds: approverIds.map((a) => new mongoose.Types.ObjectId(a)),
          taskflowOrganizationId: req.activeOrganizationId,
          decidedBy: null,
          decidedAt: null,
          decisionNote: null,
        },
      },
      { upsert: true, new: true }
    ).lean();
    await WorkLog.updateMany({ author: userId, date: { $gte: week, $lt: end } }, { $set: { approvalStatus: 'submitted' } });
    await Promise.all(
      approverIds.map((a) =>
        notifyUser({
          userId: a,
          eventKey: 'approval_requested',
          title: 'Timesheet submitted',
          body: `${(totalMinutes / 60).toFixed(1)}h for the week of ${week.toDateString()}`,
          link: '/timesheet?tab=approvals',
        }).catch(() => undefined)
      )
    );
    ok(res, sub);
  })
);

timesheetApprovalRouter.post(
  '/submissions/:id/decision',
  asyncHandler(async (req: R, res) => {
    const sub = await TimesheetSubmission.findById(req.params.id);
    if (!sub) throw new ApiError(404, 'Timesheet not found');
    const named = sub.approverIds.some((a) => String(a) === req.user!.id);
    let allowed = named;
    if (!allowed && userHasPermission(req.user?.permissions ?? [], T.APPROVE) && req.activeOrganizationId && String(sub.taskflowOrganizationId) === req.activeOrganizationId) {
      const reach = await reachFor(req, 'timesheet');
      allowed = reach === null || reach.userIds.has(String(sub.userId));
    }
    if (!allowed || String(sub.userId) === req.user!.id) throw new ApiError(403, 'You cannot approve this timesheet');
    if (sub.status !== 'submitted') throw new ApiError(409, `Timesheet is already ${sub.status}`);
    const decision = req.body?.decision === 'approved' ? 'approved' : 'rejected';
    sub.status = decision;
    sub.decidedBy = new mongoose.Types.ObjectId(req.user!.id);
    sub.decidedAt = new Date();
    sub.decisionNote = req.body?.note ? String(req.body.note).slice(0, 1000) : undefined;
    await sub.save();
    const end = new Date(sub.weekStart.getTime() + 7 * 86_400_000);
    await WorkLog.updateMany({ author: sub.userId, date: { $gte: sub.weekStart, $lt: end } }, { $set: { approvalStatus: decision } });
    void notifyUser({
      userId: String(sub.userId),
      eventKey: decision === 'approved' ? 'timesheet_approved' : 'timesheet_rejected',
      title: decision === 'approved' ? 'Timesheet approved' : 'Timesheet returned',
      body: `Week of ${sub.weekStart.toDateString()}${sub.decisionNote ? ` — ${sub.decisionNote}` : ''}`,
      link: '/timesheet',
    }).catch(() => undefined);
    ok(res, sub.toObject());
  })
);
