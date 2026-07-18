import { Router } from 'express';
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

router.get('/payroll', requireAnyPermission(payrollRead), asyncHandler(ctrl.getPayroll));

export const hrmsRoutes = router;
