import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission, requireAnyPermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import * as ctrl from './resources.controller';

const R = TASK_FLOW_PERMISSIONS.TASKFLOW.RESOURCES;
const router = Router();

router.use(authMiddleware);

router.get(
  '/dashboard',
  requireAnyPermission([R.DASHBOARD.READ, R.UTILIZATION.READ, R.BENCH.READ, R.ALLOCATION.READ]),
  asyncHandler(ctrl.getDashboard)
);

router.get('/options', requireAnyPermission([R.ALLOCATION.READ, R.ALLOCATION.MANAGE, R.FORECAST.MANAGE]), asyncHandler(ctrl.listOptions));

router.get('/allocations', requirePermission(R.ALLOCATION.READ), asyncHandler(ctrl.listAllocations));
router.post('/allocations', requirePermission(R.ALLOCATION.MANAGE), asyncHandler(ctrl.createAllocation));
router.patch('/allocations/:id', requirePermission(R.ALLOCATION.MANAGE), asyncHandler(ctrl.updateAllocation));
router.delete('/allocations/:id', requirePermission(R.ALLOCATION.MANAGE), asyncHandler(ctrl.deleteAllocation));
router.get('/conflicts', requirePermission(R.ALLOCATION.READ), asyncHandler(ctrl.getConflicts));

router.get('/utilization', requirePermission(R.UTILIZATION.READ), asyncHandler(ctrl.getUtilization));
router.get('/bench', requirePermission(R.BENCH.READ), asyncHandler(ctrl.getBench));

router.get('/forecast', requirePermission(R.FORECAST.READ), asyncHandler(ctrl.getForecast));
router.get('/demands', requirePermission(R.FORECAST.READ), asyncHandler(ctrl.listDemands));
router.post('/demands', requirePermission(R.FORECAST.MANAGE), asyncHandler(ctrl.createDemand));
router.patch('/demands/:id', requirePermission(R.FORECAST.MANAGE), asyncHandler(ctrl.updateDemand));
router.delete('/demands/:id', requirePermission(R.FORECAST.MANAGE), asyncHandler(ctrl.deleteDemand));

router.get(
  '/profiles',
  requireAnyPermission([R.ALLOCATION.READ, R.BENCH.READ, R.UTILIZATION.READ]),
  asyncHandler(ctrl.listProfiles)
);
router.put('/profiles', requirePermission(R.ALLOCATION.MANAGE), asyncHandler(ctrl.upsertProfile));

export const resourcesRoutes = router;
