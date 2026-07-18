import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAnyPermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import * as ctrl from './assets.controller';

const A = TASK_FLOW_PERMISSIONS.TASKFLOW.ASSETS;

const readAny = [
  A.DASHBOARD.READ,
  A.INVENTORY.LIST,
  A.LICENSE.LIST,
  A.SERVER.LIST,
  A.WARRANTY.READ,
];
const invList = [A.INVENTORY.LIST, A.SERVER.LIST, A.WARRANTY.READ, A.DASHBOARD.READ];
const invManage = [A.INVENTORY.MANAGE, A.SERVER.MANAGE, A.WARRANTY.MANAGE];
const licList = [A.LICENSE.LIST, A.DASHBOARD.READ];
const licManage = [A.LICENSE.MANAGE];

const router = Router();
router.use(authMiddleware);

router.get('/dashboard', requireAnyPermission(readAny), asyncHandler(ctrl.getDashboard));

router.get('/assets', requireAnyPermission(invList), asyncHandler(ctrl.listAssets));
router.post('/assets', requireAnyPermission(invManage), asyncHandler(ctrl.createAsset));
router.patch('/assets/:id', requireAnyPermission(invManage), asyncHandler(ctrl.updateAsset));
router.delete('/assets/:id', requireAnyPermission(invManage), asyncHandler(ctrl.deleteAsset));

router.get('/licenses', requireAnyPermission(licList), asyncHandler(ctrl.listLicenses));
router.post('/licenses', requireAnyPermission(licManage), asyncHandler(ctrl.createLicense));
router.patch('/licenses/:id', requireAnyPermission(licManage), asyncHandler(ctrl.updateLicense));
router.delete('/licenses/:id', requireAnyPermission(licManage), asyncHandler(ctrl.deleteLicense));

export const assetsRoutes = router;
