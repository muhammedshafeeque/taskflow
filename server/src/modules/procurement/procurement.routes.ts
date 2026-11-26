import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAnyPermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import * as ctrl from './procurement.controller';

const P = TASK_FLOW_PERMISSIONS.TASKFLOW.PROCUREMENT;

const readAny = [P.DASHBOARD.READ, P.VENDOR.LIST, P.PO.LIST, P.LICENSE.LIST];
const vendorList = [P.VENDOR.LIST, P.VENDOR.MANAGE, P.DASHBOARD.READ, P.PO.LIST];
const vendorManage = [P.VENDOR.MANAGE];
const poList = [P.PO.LIST, P.PO.CREATE, P.PO.APPROVE, P.PO.MANAGE, P.DASHBOARD.READ];
const poCreate = [P.PO.CREATE, P.PO.MANAGE];
const poManage = [P.PO.MANAGE];
const poTransition = [P.PO.MANAGE, P.PO.APPROVE, P.PO.CREATE];
const settingsRead = [...poList, P.SETTINGS.READ, P.SETTINGS.MANAGE];
const settingsManage = [P.SETTINGS.MANAGE, P.PO.MANAGE];

const router = Router();
router.use(authMiddleware);

router.get('/dashboard', requireAnyPermission(readAny), asyncHandler(ctrl.getDashboard));
router.get('/settings', requireAnyPermission(settingsRead), asyncHandler(ctrl.getSettings));
router.put('/settings', requireAnyPermission(settingsManage), asyncHandler(ctrl.updateSettings));
router.get('/approvers', requireAnyPermission(settingsManage), asyncHandler(ctrl.listApprovers));

router.get('/vendors', requireAnyPermission(vendorList), asyncHandler(ctrl.listVendors));
router.post('/vendors', requireAnyPermission(vendorManage), asyncHandler(ctrl.createVendor));

router.get('/pos', requireAnyPermission(poList), asyncHandler(ctrl.listPurchaseOrders));
router.post('/pos', requireAnyPermission(poCreate), asyncHandler(ctrl.createPurchaseOrder));
router.patch('/pos/:id', requireAnyPermission(poManage), asyncHandler(ctrl.updatePurchaseOrder));
router.patch('/pos/:id/status', requireAnyPermission(poTransition), asyncHandler(ctrl.transitionPurchaseOrder));
router.delete('/pos/:id', requireAnyPermission(poManage), asyncHandler(ctrl.deletePurchaseOrder));

export const procurementRoutes = router;
