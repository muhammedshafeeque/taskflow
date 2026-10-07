import { Router, type Request, type Response, type NextFunction } from 'express';
import mongoose from 'mongoose';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { requireAnyPermission } from '../../middleware/requirePermission';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { User } from '../auth/user.model';
import { HrmsEmployee } from '../hrms/models/hrmsEmployee.model';
import { HrmsLeaveRequest } from '../hrms/models/hrmsLeaveRequest.model';
import { HrmsAttendance } from '../hrms/models/hrmsAttendance.model';
import { HrmsPayrollRun } from '../hrms/models/hrmsPayroll.model';
import { HrmsSettings } from '../hrms/models/hrmsPolicy.model';
import { Asset } from '../assets/models/asset.model';
import { AssetLicense } from '../assets/models/assetLicense.model';
import { AccountExpense } from '../accounts/models/accountExpense.model';
import { CoreCompanySettings } from '../core/models/coreCompanySettings.model';
import * as hrms from '../hrms/hrms.service';
import * as policy from '../hrms/policy.service';
import { renderPayslipHtml } from '../hrms/payroll.service';
import { createExpense } from '../accounts/accounts.service';
import { notifyUser } from '../notifications/notificationDispatch.service';
import { usersWithPermission } from '../auth/usersWithPermission';
import { getAccountsSettings } from '../ledger/ledger.service';

/**
 * Self-service for any employee: everything here is scoped to the signed-in
 * user's own employee record. Access is granted per capability via the
 * taskflow.self.* permissions on whatever roles the company defines.
 */
const S = TASK_FLOW_PERMISSIONS.TASKFLOW.SELF;
type R = Request & { activeOrganizationId?: string; user?: { id: string; email?: string; name?: string; permissions?: string[] }; employee?: InstanceType<typeof HrmsEmployee> };

/** Resolve the caller's employee record (linked by user id, else by work email, then linked). */
async function loadEmployee(req: R, _res: Response, next: NextFunction) {
  try {
    const orgOid = toOrgOid(requireWorkspaceId(req.activeOrganizationId));
    let emp = await HrmsEmployee.findOne({ taskflowOrganizationId: orgOid, userId: req.user!.id });
    if (!emp) {
      const user = await User.findById(req.user!.id).select('email').lean();
      if (user?.email) {
        emp = await HrmsEmployee.findOne({ taskflowOrganizationId: orgOid, email: user.email.toLowerCase(), userId: null });
        if (emp) {
          emp.userId = new mongoose.Types.ObjectId(req.user!.id);
          await emp.save();
        }
      }
    }
    if (!emp) return next(new ApiError(404, 'No employee record is linked to your account yet — ask HR to add you.'));
    req.employee = emp;
    next();
  } catch (err) {
    next(err);
  }
}

const ok = (res: Response, data: unknown) => res.json({ success: true, data });

export const selfServiceRouter = Router();
const r = selfServiceRouter;

r.get(
  '/profile',
  requireAnyPermission([S.PROFILE.READ]),
  loadEmployee,
  asyncHandler(async (req: R, res) => {
    const e = await HrmsEmployee.findById(req.employee!._id).populate('managerId', 'name designation email').lean();
    const { annualCtc: _ctc, hourlyCostRate: _rate, notes: _notes, ...safe } = e as Record<string, unknown>;
    void _ctc;
    void _rate;
    void _notes;
    ok(res, safe);
  })
);

// Leave
r.get('/leave/types', requireAnyPermission([S.LEAVE.APPLY]), asyncHandler(async (req: R, res) => ok(res, await policy.listLeaveTypes(req.activeOrganizationId, true))));
r.get('/leave/balances', requireAnyPermission([S.LEAVE.APPLY]), loadEmployee, asyncHandler(async (req: R, res) => ok(res, await policy.getBalances(req.activeOrganizationId, String(req.employee!._id)))));
r.get(
  '/leave',
  requireAnyPermission([S.LEAVE.APPLY]),
  loadEmployee,
  asyncHandler(async (req: R, res) =>
    ok(res, await HrmsLeaveRequest.find({ employeeId: req.employee!._id }).populate('leaveTypeId', 'name color paid').sort({ startDate: -1 }).limit(100).lean())
  )
);
r.post(
  '/leave',
  requireAnyPermission([S.LEAVE.APPLY]),
  loadEmployee,
  asyncHandler(async (req: R, res) => {
    const body = req.body ?? {};
    const leave = await hrms.createLeave(req.activeOrganizationId, {
      employeeId: String(req.employee!._id),
      leaveTypeId: body.leaveTypeId,
      startDate: body.startDate,
      endDate: body.endDate,
      halfDay: Boolean(body.halfDay),
      reason: body.reason ? String(body.reason).slice(0, 1000) : undefined,
    });
    // Approver: the manager's account, else HR's configured approvers, else anyone who can manage leave.
    const e = req.employee!;
    const manager = e.managerId ? await HrmsEmployee.findById(e.managerId).select('userId').lean() : null;
    const settings = await HrmsSettings.findOne({ taskflowOrganizationId: e.taskflowOrganizationId }).select('leaveApproverUserIds').lean();
    const approvers = manager?.userId
      ? [String(manager.userId)]
      : settings?.leaveApproverUserIds?.length
        ? settings.leaveApproverUserIds.map(String)
        : await usersWithPermission(TASK_FLOW_PERMISSIONS.TASKFLOW.HR.LEAVE.MANAGE, req.activeOrganizationId);
    await Promise.all(
      approvers
        .filter((u) => u !== req.user!.id)
        .map((userId) =>
          notifyUser({
            userId,
            eventKey: 'approval_requested',
            title: `Leave request: ${e.name}`,
            body: `${(leave as { days?: number }).days} day(s) from ${new Date(body.startDate).toDateString()}`,
            link: '/hrms/leave',
          }).catch(() => undefined)
        )
    );
    ok(res, leave);
  })
);
r.post(
  '/leave/:id/cancel',
  requireAnyPermission([S.LEAVE.APPLY]),
  loadEmployee,
  asyncHandler(async (req: R, res) => {
    const leave = await HrmsLeaveRequest.findOne({ _id: req.params.id, employeeId: req.employee!._id }).lean();
    if (!leave) throw new ApiError(404, 'Leave request not found');
    if (leave.status !== 'pending' && !(leave.status === 'approved' && new Date(leave.startDate) > new Date())) {
      throw new ApiError(400, 'Only pending or future approved leave can be cancelled');
    }
    ok(res, await hrms.decideLeave(req.params.id, req.activeOrganizationId, 'cancelled', req.user!.id));
  })
);

// Attendance
r.get(
  '/attendance',
  requireAnyPermission([S.ATTENDANCE.MARK]),
  loadEmployee,
  asyncHandler(async (req: R, res) => {
    const from = new Date(Date.now() - 31 * 86_400_000);
    ok(res, await HrmsAttendance.find({ employeeId: req.employee!._id, date: { $gte: from } }).sort({ date: -1 }).lean());
  })
);
r.post(
  '/attendance',
  requireAnyPermission([S.ATTENDANCE.MARK]),
  loadEmployee,
  asyncHandler(async (req: R, res) => {
    const status = String(req.body?.status ?? 'present');
    if (!['present', 'remote', 'half_day'].includes(status)) throw new ApiError(400, 'You can mark present, remote or half day');
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const doc = await HrmsAttendance.findOneAndUpdate(
      { employeeId: req.employee!._id, date: today },
      {
        $set: { status, hoursWorked: status === 'half_day' ? 4 : Number(req.body?.hoursWorked) || 8, note: req.body?.note ? String(req.body.note).slice(0, 300) : undefined },
        $setOnInsert: { taskflowOrganizationId: req.employee!.taskflowOrganizationId },
      },
      { upsert: true, new: true }
    ).lean();
    ok(res, doc);
  })
);

// Payslips (finalized or paid runs only)
r.get(
  '/payslips',
  requireAnyPermission([S.PAYSLIP.READ]),
  loadEmployee,
  asyncHandler(async (req: R, res) => {
    const runs = await HrmsPayrollRun.find({ taskflowOrganizationId: req.employee!.taskflowOrganizationId, status: { $in: ['finalized', 'paid'] }, 'payslips.employeeId': req.employee!._id })
      .select('period status payslips.$')
      .sort({ period: -1 })
      .limit(36)
      .lean();
    ok(
      res,
      runs.map((run) => {
        const p = run.payslips[0];
        return { runId: String(run._id), period: run.period, status: run.status, gross: p?.gross, net: p?.net, currency: p?.currency };
      })
    );
  })
);
r.get(
  '/payslips/:runId',
  requireAnyPermission([S.PAYSLIP.READ]),
  loadEmployee,
  asyncHandler(async (req: R, res) => {
    const run = await HrmsPayrollRun.findOne({ _id: req.params.runId, status: { $in: ['finalized', 'paid'] } }).select('_id').lean();
    if (!run) throw new ApiError(404, 'Payslip not found');
    const company = await CoreCompanySettings.findOne({ taskflowOrganizationId: req.activeOrganizationId }).select('companyName').lean();
    ok(res, { html: await renderPayslipHtml(req.activeOrganizationId, req.params.runId, String(req.employee!._id), company?.companyName ?? '') });
  })
);

// Expense claims
r.get(
  '/expense-categories',
  requireAnyPermission([S.EXPENSE.CLAIM]),
  asyncHandler(async (req: R, res) => {
    const settings = await getAccountsSettings(req.activeOrganizationId);
    ok(res, (settings as { expenseCategories?: string[] }).expenseCategories ?? []);
  })
);
r.get(
  '/expenses',
  requireAnyPermission([S.EXPENSE.CLAIM]),
  asyncHandler(async (req: R, res) =>
    ok(res, await AccountExpense.find({ taskflowOrganizationId: toOrgOid(requireWorkspaceId(req.activeOrganizationId)), submittedBy: req.user!.id }).sort({ expenseDate: -1 }).limit(100).lean())
  )
);
r.post(
  '/expenses',
  requireAnyPermission([S.EXPENSE.CLAIM]),
  asyncHandler(async (req: R, res) => {
    const b = req.body ?? {};
    const amount = Number(b.amount);
    if (!(amount > 0)) throw new ApiError(400, 'Amount must be greater than zero');
    const doc = await createExpense(
      req.activeOrganizationId,
      {
        description: b.description,
        category: b.category,
        amount,
        currency: b.currency,
        expenseDate: b.expenseDate,
        projectId: b.projectId,
        notes: b.notes,
        receiptUrls: b.receiptUrls,
        reimbursable: true,
        status: 'submitted',
      },
      req.user!.id
    );
    const approvers = await usersWithPermission(TASK_FLOW_PERMISSIONS.TASKFLOW.ACCOUNTS.EXPENSE.UPDATE, req.activeOrganizationId);
    await Promise.all(
      approvers
        .filter((u) => u !== req.user!.id)
        .map((userId) =>
          notifyUser({ userId, eventKey: 'approval_requested', title: 'Expense claim submitted', body: `${b.description} · ${b.currency ?? ''} ${amount}`, link: '/accounts/expenses' }).catch(() => undefined)
        )
    );
    ok(res, doc);
  })
);

// Assets assigned to me
r.get(
  '/assets',
  requireAnyPermission([S.ASSET.READ]),
  asyncHandler(async (req: R, res) => {
    const orgOid = toOrgOid(requireWorkspaceId(req.activeOrganizationId));
    const [assets, licenses] = await Promise.all([
      Asset.find({ taskflowOrganizationId: orgOid, assignedUserId: req.user!.id }).lean(),
      AssetLicense.find({ taskflowOrganizationId: orgOid, assignedUserIds: req.user!.id }).select('name vendor renewalDate status').lean(),
    ]);
    ok(res, { assets, licenses });
  })
);

// Company directory (no pay data)
r.get(
  '/directory',
  requireAnyPermission([S.DIRECTORY.READ]),
  asyncHandler(async (req: R, res) => {
    const orgOid = toOrgOid(requireWorkspaceId(req.activeOrganizationId));
    const q = String(req.query.q ?? '').trim();
    const rx = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
    ok(
      res,
      await HrmsEmployee.find({
        taskflowOrganizationId: orgOid,
        status: { $ne: 'terminated' },
        ...(rx ? { $or: [{ name: rx }, { department: rx }, { designation: rx }, { email: rx }] } : {}),
      })
        .select('name email phone department designation location managerId employeeCode')
        .populate('managerId', 'name')
        .sort({ name: 1 })
        .limit(500)
        .lean()
    );
  })
);
