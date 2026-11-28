import { Router, type Request, type Response } from 'express';
import * as payroll from './payroll.service';
import { hrPeopleRouter } from './hrPeople.routes';
import { CoreCompanySettings } from '../core/models/coreCompanySettings.model';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAnyPermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import * as ctrl from './hrms.controller';
import * as jobChanges from './jobChange.service';
import { Role } from '../roles/role.model';
import { grantActorOf } from '../auth/grantGuard';
import { assertReachesEveryone, reachFor } from './dataScope';

const H = TASK_FLOW_PERMISSIONS.TASKFLOW.HR;

const readAny = [
  H.DASHBOARD.READ,
  H.EMPLOYEE.LIST,
  H.ATTENDANCE.READ,
  H.LEAVE.READ,
  H.PAYROLL.READ,
];
const empManage = [H.EMPLOYEE.CREATE, H.EMPLOYEE.UPDATE];
const empList = [H.EMPLOYEE.LIST, H.EMPLOYEE.READ, H.DASHBOARD.READ];
const leaveRead = [H.LEAVE.READ, H.LEAVE.MANAGE, H.DASHBOARD.READ];
const leaveManage = [H.LEAVE.MANAGE];
const attRead = [H.ATTENDANCE.READ, H.ATTENDANCE.MANAGE, H.DASHBOARD.READ];
const attManage = [H.ATTENDANCE.MANAGE];
const payrollRead = [H.PAYROLL.READ, H.PAYROLL.MANAGE, H.PAYROLL.APPROVE];

const router = Router();
router.use(authMiddleware);

router.get('/dashboard', requireAnyPermission(readAny), asyncHandler(ctrl.getDashboard));

router.get('/employees', requireAnyPermission(empList), asyncHandler(ctrl.listEmployees));
router.post('/employees', requireAnyPermission(empManage), asyncHandler(ctrl.createEmployee));
router.patch('/employees/:id', requireAnyPermission(empManage), asyncHandler(ctrl.updateEmployee));
router.delete('/employees/:id', requireAnyPermission([H.EMPLOYEE.UPDATE]), asyncHandler(ctrl.deleteEmployee));
router.post('/employees/:id/restore', requireAnyPermission([H.EMPLOYEE.UPDATE]), asyncHandler(ctrl.restoreEmployee));

router.get('/employees/:id/open-work', requireAnyPermission([H.EMPLOYEE.UPDATE]), asyncHandler(ctrl.getOpenWork));
router.post('/employees/:id/reassign', requireAnyPermission([H.EMPLOYEE.UPDATE]), asyncHandler(ctrl.reassignWork));

router.get('/leave', requireAnyPermission(leaveRead), asyncHandler(ctrl.listLeave));
router.post('/leave', requireAnyPermission(leaveManage), asyncHandler(ctrl.createLeave));
router.patch('/leave/:id/decision', requireAnyPermission(leaveManage), asyncHandler(ctrl.decideLeave));

router.get('/attendance', requireAnyPermission(attRead), asyncHandler(ctrl.listAttendance));
router.post('/attendance', requireAnyPermission(attManage), asyncHandler(ctrl.markAttendance));
router.post('/attendance/bulk', requireAnyPermission(attManage), asyncHandler(ctrl.markAttendanceBulk));

// Promotions, transfers, conversions and pay changes (AUT-24).
const J = H.JOB_CHANGE;
type JR = Request & { activeOrganizationId?: string; user?: { id: string; permissions?: string[] } };
const hrReach = (req: JR) => reachFor(req as never, 'hr');
const jok = (res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data });
router.get('/job-changes', requireAnyPermission([J.REQUEST, J.APPROVE]), asyncHandler(async (req: JR, res) =>
  jok(res, await jobChanges.listJobChanges(req.activeOrganizationId, req.query as Record<string, string>, req.user?.permissions ?? [], await hrReach(req)))));
// Roles to pick from when a change includes one (the same people may change roles in Auth → Users).
router.get('/job-changes/roles', requireAnyPermission([J.REQUEST]), requireAnyPermission([TASK_FLOW_PERMISSIONS.AUTH.USER.UPDATE]), asyncHandler(async (_req, res) =>
  jok(res, await Role.find({}).select('name').sort({ name: 1 }).lean())));
router.post('/job-changes', requireAnyPermission([J.REQUEST]), asyncHandler(async (req: JR, res) =>
  jok(res, await jobChanges.requestJobChange(req.activeOrganizationId, req.body ?? {}, grantActorOf(req), await hrReach(req)), 201)));
router.post('/job-changes/:id/decision', requireAnyPermission([J.APPROVE]), asyncHandler(async (req: JR, res) =>
  jok(res, await jobChanges.decideJobChange(req.activeOrganizationId, req.params.id, req.body?.decision, req.body?.note, grantActorOf(req), await hrReach(req)))));
router.post('/job-changes/:id/cancel', requireAnyPermission([J.REQUEST, J.APPROVE]), asyncHandler(async (req: JR, res) =>
  jok(res, await jobChanges.cancelJobChange(req.activeOrganizationId, req.params.id, grantActorOf(req), await hrReach(req)))));
router.get('/employees/:id/history', requireAnyPermission([H.EMPLOYEE.READ, H.EMPLOYEE.LIST, J.REQUEST, J.APPROVE]), asyncHandler(async (req: JR, res) =>
  jok(res, await jobChanges.employeeHistory(req.activeOrganizationId, req.params.id, req.user?.permissions ?? [], await hrReach(req)))));

router.use('/', hrPeopleRouter);
// Payroll covers the whole company, so it needs HR access that reaches everyone.
router.use('/payroll', asyncHandler(async (req, _res, next) => {
  assertReachesEveryone(await reachFor(req as never, 'hr'), 'Payroll');
  next();
}));
router.get('/payroll', requireAnyPermission(payrollRead), asyncHandler(ctrl.getPayroll));

// Payroll v2: settings, monthly runs, adjustments, payslips
const payrollManage = [H.PAYROLL.MANAGE];
type WsReq = Request & { activeOrganizationId?: string; user?: { id: string; role?: string; permissions?: string[] } };
router.get('/payroll/settings', requireAnyPermission(payrollRead), asyncHandler(async (req: WsReq, res: Response) => {
  res.json({ success: true, data: await payroll.getPayrollSettings(req.activeOrganizationId) });
}));
router.put('/payroll/settings', requireAnyPermission(payrollManage), asyncHandler(async (req: WsReq, res: Response) => {
  res.json({ success: true, data: await payroll.updatePayrollSettings(req.activeOrganizationId, req.body ?? {}) });
}));
router.get('/payroll/runs', requireAnyPermission(payrollRead), asyncHandler(async (req: WsReq, res: Response) => {
  res.json({ success: true, data: await payroll.listPayrollRuns(req.activeOrganizationId) });
}));
router.post('/payroll/runs', requireAnyPermission(payrollManage), asyncHandler(async (req: WsReq, res: Response) => {
  res.json({ success: true, data: await payroll.generatePayrollRun(req.activeOrganizationId, String(req.body?.period ?? ''), req.user!.id) });
}));
router.get('/payroll/runs/:id', requireAnyPermission(payrollRead), asyncHandler(async (req: WsReq, res: Response) => {
  res.json({ success: true, data: await payroll.getPayrollRunById(req.activeOrganizationId, req.params.id) });
}));
router.put('/payroll/runs/:id/payslips/:employeeId/adjustments', requireAnyPermission(payrollManage), asyncHandler(async (req: WsReq, res: Response) => {
  const data = await payroll.setPayslipAdjustments(req.activeOrganizationId, req.params.id, req.params.employeeId, req.body?.adjustments ?? [], req.user!.id);
  res.json({ success: true, data });
}));
// Finalizing is approving: prepared by one person, approved by another (AUT-43).
router.post('/payroll/runs/:id/finalize', requireAnyPermission([H.PAYROLL.MANAGE, H.PAYROLL.APPROVE]), asyncHandler(async (req: WsReq, res: Response) => {
  res.json({ success: true, data: await payroll.setPayrollRunStatus(req.activeOrganizationId, req.params.id, 'finalized', req.user!.id, { permissions: req.user?.permissions ?? [], role: req.user?.role }) });
}));
router.post('/payroll/runs/:id/paid', requireAnyPermission(payrollManage), asyncHandler(async (req: WsReq, res: Response) => {
  res.json({ success: true, data: await payroll.setPayrollRunStatus(req.activeOrganizationId, req.params.id, 'paid', req.user!.id) });
}));
router.get('/payroll/runs/:id/payslips/:employeeId', requireAnyPermission(payrollRead), asyncHandler(async (req: WsReq, res: Response) => {
  const company = await CoreCompanySettings.findOne({ taskflowOrganizationId: req.activeOrganizationId }).select('companyName').lean();
  const html = await payroll.renderPayslipHtml(req.activeOrganizationId, req.params.id, req.params.employeeId, company?.companyName ?? 'Company');
  res.json({ success: true, data: { html } });
}));

export const hrmsRoutes = router;
