import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission, requireAnyPermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import * as ctrl from './resources.controller';

const R = TASK_FLOW_PERMISSIONS.TASKFLOW.RESOURCES;
const ANY_READ = [
  R.DASHBOARD.READ,
  R.UTILIZATION.READ,
  R.BENCH.READ,
  R.ENGAGEMENT.READ,
  R.ALLOCATION.READ,
  R.FORECAST.READ,
];
const router = Router();

router.use(authMiddleware);

router.get(
  '/dashboard',
  requireAnyPermission([R.DASHBOARD.READ, R.UTILIZATION.READ, R.BENCH.READ, R.ALLOCATION.READ]),
  asyncHandler(ctrl.getDashboard)
);

router.get('/options', requireAnyPermission([...ANY_READ, R.ALLOCATION.MANAGE, R.FORECAST.MANAGE]), asyncHandler(ctrl.listOptions));

router.get('/allocations', requirePermission(R.ALLOCATION.READ), asyncHandler(ctrl.listAllocations));
router.get('/allocations/check', requireAnyPermission([R.ALLOCATION.READ, R.ALLOCATION.MANAGE, R.FORECAST.MANAGE]), asyncHandler(ctrl.checkAllocation));
router.post('/allocations', requirePermission(R.ALLOCATION.MANAGE), asyncHandler(ctrl.createAllocation));
router.patch('/allocations/:id', requirePermission(R.ALLOCATION.MANAGE), asyncHandler(ctrl.updateAllocation));
router.delete('/allocations/:id', requirePermission(R.ALLOCATION.MANAGE), asyncHandler(ctrl.deleteAllocation));
router.get('/conflicts', requirePermission(R.ALLOCATION.READ), asyncHandler(ctrl.getConflicts));
router.get('/schedule', requireAnyPermission([R.ALLOCATION.READ, R.UTILIZATION.READ]), asyncHandler(ctrl.getSchedule));

router.get('/utilization', requirePermission(R.UTILIZATION.READ), asyncHandler(ctrl.getUtilization));
router.get('/bench', requirePermission(R.BENCH.READ), asyncHandler(ctrl.getBench));
router.get('/skills', requireAnyPermission([R.BENCH.READ, R.ALLOCATION.READ, R.FORECAST.READ]), asyncHandler(ctrl.getSkills));
router.get(
  '/engagement',
  requireAnyPermission([R.ENGAGEMENT.READ, R.UTILIZATION.READ]),
  asyncHandler(ctrl.getEngagement)
);
const ENGAGEMENT_ENTRY = [R.ENGAGEMENT.READ, R.ENGAGEMENT.MANAGE, R.UTILIZATION.READ, R.ALLOCATION.MANAGE];
router.get('/engagement/entries', requireAnyPermission(ENGAGEMENT_ENTRY), asyncHandler(ctrl.listEngagementEntries));
// Writes are open to engagement viewers for their own entries; the service limits others' entries to managers.
router.post('/engagement/entries', requireAnyPermission(ENGAGEMENT_ENTRY), asyncHandler(ctrl.createEngagementEntry));
router.patch('/engagement/entries/:id', requireAnyPermission(ENGAGEMENT_ENTRY), asyncHandler(ctrl.updateEngagementEntry));
router.delete('/engagement/entries/:id', requireAnyPermission(ENGAGEMENT_ENTRY), asyncHandler(ctrl.deleteEngagementEntry));
router.get('/teams', requireAnyPermission([...ANY_READ, R.TEAM.MANAGE]), asyncHandler(ctrl.listTeams));
router.post('/teams', requirePermission(R.TEAM.MANAGE), asyncHandler(ctrl.createTeam));
router.patch('/teams/:id', requirePermission(R.TEAM.MANAGE), asyncHandler(ctrl.updateTeam));
router.delete('/teams/:id', requirePermission(R.TEAM.MANAGE), asyncHandler(ctrl.deleteTeam));
router.get('/settings', requireAnyPermission([...ANY_READ, R.ALLOCATION.MANAGE, R.SETTINGS.MANAGE]), asyncHandler(ctrl.getSettings));
router.put('/settings', requireAnyPermission([R.SETTINGS.MANAGE, R.ALLOCATION.MANAGE]), asyncHandler(ctrl.updateSettings));

router.get('/forecast', requirePermission(R.FORECAST.READ), asyncHandler(ctrl.getForecast));
router.get('/demands', requirePermission(R.FORECAST.READ), asyncHandler(ctrl.listDemands));
router.post('/demands', requirePermission(R.FORECAST.MANAGE), asyncHandler(ctrl.createDemand));
router.patch('/demands/:id', requirePermission(R.FORECAST.MANAGE), asyncHandler(ctrl.updateDemand));
router.delete('/demands/:id', requirePermission(R.FORECAST.MANAGE), asyncHandler(ctrl.deleteDemand));
router.get('/demands/:id/candidates', requireAnyPermission([R.FORECAST.MANAGE, R.ALLOCATION.MANAGE]), asyncHandler(ctrl.getDemandCandidates));
// Booking someone creates an allocation, so it needs allocation rights too.
router.post('/demands/:id/fulfil', requirePermission(R.ALLOCATION.MANAGE), asyncHandler(ctrl.fulfilDemand));

router.get(
  '/profiles',
  requireAnyPermission([R.ALLOCATION.READ, R.BENCH.READ, R.UTILIZATION.READ]),
  asyncHandler(ctrl.listProfiles)
);
router.put('/profiles', requireAnyPermission([R.PROFILE.MANAGE, R.ALLOCATION.MANAGE]), asyncHandler(ctrl.upsertProfile));
router.put('/profiles/bulk', requireAnyPermission([R.PROFILE.MANAGE, R.ALLOCATION.MANAGE]), asyncHandler(ctrl.bulkUpdateProfiles));

export const resourcesRoutes = router;
