import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/requirePermission';
import { requireProjectPermission } from '../../middleware/requireProjectPermission';
import {
  createProjectHandler,
  getProjects,
  getProjectById,
  getMyPermissions,
  updateProjectHandler,
  deleteProject,
  idParamHandler,
  releaseVersionHandler,
  inviteToProjectHandler,
  getMembers,
  getInvitations,
  cancelInvitationParamHandler,
  timesheetHandler,
  sprintReportHandler,
} from './projects.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { milestonesRoutes } from '../milestones/milestones.routes';
import { roadmapsRoutes } from '../roadmaps/roadmaps.routes';
import { testCasesRoutes } from '../testCases/testCases.routes';
import { testPlansRoutes } from '../testPlans/testPlans.routes';
import { traceabilityRoutes } from '../traceability/traceability.routes';

const router = Router();

router.use(authMiddleware);

router.get('/', asyncHandler(getProjects));
router.post('/', requirePermission('projects:create'), createProjectHandler);
router.get('/:id/my-permissions', ...idParamHandler, asyncHandler(getMyPermissions));
router.get('/:id/members', ...idParamHandler, requireProjectPermission('project:view'), asyncHandler(getMembers));
router.get('/:id/invitations', ...idParamHandler, requireProjectPermission('project:manageMembers'), asyncHandler(getInvitations));
router.post('/:id/invite', ...idParamHandler, requireProjectPermission('project:manageMembers'), inviteToProjectHandler);
router.delete('/:id/invitations/:invitationId', requireProjectPermission('project:manageMembers'), ...cancelInvitationParamHandler);
router.get('/:id', ...idParamHandler, asyncHandler(getProjectById));
router.patch('/:id', ...idParamHandler, requireProjectPermission('project:edit'), ...updateProjectHandler);
router.post('/:id/versions/release', releaseVersionHandler);
router.get('/:id/timesheet', ...idParamHandler, requireProjectPermission('project:view'), ...timesheetHandler);
router.use('/:id/milestones', idParamHandler[0], milestonesRoutes);
router.use('/:id/roadmaps', idParamHandler[0], roadmapsRoutes);
router.use('/:id/test-cases', idParamHandler[0], testCasesRoutes);
router.use('/:id/test-plans', idParamHandler[0], testPlansRoutes);
router.use('/:id/traceability', idParamHandler[0], traceabilityRoutes);
router.get('/:id/sprints/:sprintId/report', requireProjectPermission('sprints:view'), ...sprintReportHandler);
router.delete('/:id', ...idParamHandler, requireProjectPermission('project:delete'), asyncHandler(deleteProject));

export const projectsRoutes = router;
