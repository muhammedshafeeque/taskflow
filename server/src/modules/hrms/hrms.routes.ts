import { Router, type Request, type Response } from 'express';
import * as payroll from './payroll.service';
import { hrPeopleRouter } from './hrPeople.routes';
import { CoreCompanySettings } from '../core/models/coreCompanySettings.model';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAnyPermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import * as ctrl from './hrms.controller';

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
const payrollRead = [H.PAYROLL.READ, H.PAYROLL.MANAGE];

const router = Router();
router.use(authMiddleware);

router.get('/dashboard', requireAnyPermission(readAny), asyncHandler(ctrl.getDashboard));

router.get('/employees', requireAnyPermission(empList), asyncHandler(ctrl.listEmployees));
router.post('/employees', requireAnyPermission(empManage), asyncHandler(ctrl.createEmployee));
router.patch('/employees/:id', requireAnyPermission(empManage), asyncHandler(ctrl.updateEmployee));
router.delete('/employees/:id', requireAnyPermission([H.EMPLOYEE.UPDATE]), asyncHandler(ctrl.deleteEmployee));

router.get('/leave', requireAnyPermission(leaveRead), asyncHandler(ctrl.listLeave));
router.post('/leave', requireAnyPermission([...leaveManage, H.EMPLOYEE.LIST]), asyncHandler(ctrl.createLeave));
router.patch('/leave/:id/decision', requireAnyPermission(leaveManage), asyncHandler(ctrl.decideLeave));

router.get('/attendance', requireAnyPermission(attRead), asyncHandler(ctrl.listAttendance));
router.post('/attendance', requireAnyPermission(attManage), asyncHandler(ctrl.markAttendance));

router.use('/', hrPeopleRouter);
router.get('/payroll', requireAnyPermission(payrollRead), asyncHandler(ctrl.getPayroll));

// Payroll v2: settings, monthly runs, adjustments, payslips
const payrollManage = [H.PAYROLL.MANAGE];
type WsReq = Request & { activeOrganizationId?: string; user?: { id: string } };
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
  res.json({ success: true, data: await payroll.generatePayrollRun(req.activeOrganizationId, String(req.body?.period ?? '')) });
}));
router.get('/payroll/runs/:id', requireAnyPermission(payrollRead), asyncHandler(async (req: WsReq, res: Response) => {
  res.json({ success: true, data: await payroll.getPayrollRunById(req.activeOrganizationId, req.params.id) });
}));
router.put('/payroll/runs/:id/payslips/:employeeId/adjustments', requireAnyPermission(payrollManage), asyncHandler(async (req: WsReq, res: Response) => {
  const data = await payroll.setPayslipAdjustments(req.activeOrganizationId, req.params.id, req.params.employeeId, req.body?.adjustments ?? []);
  res.json({ success: true, data });
}));
router.post('/payroll/runs/:id/finalize', requireAnyPermission(payrollManage), asyncHandler(async (req: WsReq, res: Response) => {
  res.json({ success: true, data: await payroll.setPayrollRunStatus(req.activeOrganizationId, req.params.id, 'finalized', req.user!.id) });
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
