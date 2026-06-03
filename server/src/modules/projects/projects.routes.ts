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
  saveSettingsTemplateHandler,
  releaseVersionHandler,
  inviteToProjectHandler,
  getMembers,
  getInvitations,
  cancelInvitationParamHandler,
  timesheetHandler,
  sprintReportHandler,
  getProjectIssueGraph,
  updateMemberDesignation,
  removeMember,
} from './projects.controller';
import { importsRoutes } from '../imports/imports.routes';
import { asyncHandler } from '../../utils/asyncHandler';
import { milestonesRoutes } from '../milestones/milestones.routes';
import { roadmapsRoutes } from '../roadmaps/roadmaps.routes';
import { testCasesRoutes } from '../testCases/testCases.routes';
import { testPlansRoutes } from '../testPlans/testPlans.routes';
import { traceabilityRoutes } from '../traceability/traceability.routes';
import * as projectDesignationController from './projectDesignation.controller';
import { PROJECT_PERMISSIONS, TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';

const router = Router();

router.use(authMiddleware);

router.get('/', asyncHandler(getProjects));
router.post('/', requirePermission(TASK_FLOW_PERMISSIONS.PROJECT.PROJECT.CREATE), createProjectHandler);
router.get('/:id/my-permissions', ...idParamHandler, asyncHandler(getMyPermissions));
router.get('/:id/members', ...idParamHandler, requireProjectPermission(PROJECT_PERMISSIONS.ISSUE.ISSUE.READ), asyncHandler(getMembers));
router.get('/:id/invitations', ...idParamHandler, requireProjectPermission(PROJECT_PERMISSIONS.MEMBER.INVITATIONS_MANAGE), asyncHandler(getInvitations));
router.post('/:id/invite', ...idParamHandler, requireProjectPermission(PROJECT_PERMISSIONS.MEMBER.INVITATIONS_MANAGE), inviteToProjectHandler);
router.delete('/:id/invitations/:invitationId', requireProjectPermission(PROJECT_PERMISSIONS.MEMBER.INVITATIONS_MANAGE), ...cancelInvitationParamHandler);
router.post(
  '/:id/save-settings-template',
  ...idParamHandler,
  requireProjectPermission(PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.UPDATE),
  ...saveSettingsTemplateHandler
);
router.get('/:id', ...idParamHandler, asyncHandler(getProjectById));
router.patch('/:id', ...idParamHandler, requireProjectPermission(PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.UPDATE), ...updateProjectHandler);
router.post('/:id/versions/release', releaseVersionHandler);
router.get('/:id/timesheet', ...idParamHandler, requireProjectPermission(PROJECT_PERMISSIONS.ISSUE.ISSUE.READ), ...timesheetHandler);

// Member and Designation management
router.patch('/:projectId/members/:memberId', requireProjectPermission(PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.UPDATE), asyncHandler(updateMemberDesignation));
router.delete('/:projectId/members/:memberId', requireProjectPermission(PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.UPDATE), asyncHandler(removeMember));

router.get('/:projectId/designations', requireProjectPermission(PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.READ), ...projectDesignationController.listDesignationsHandler);
router.post('/:projectId/designations', requireProjectPermission(PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.UPDATE), ...projectDesignationController.createDesignationHandler);
router.patch('/:projectId/designations/:id', requireProjectPermission(PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.UPDATE), ...projectDesignationController.updateDesignationHandler);
router.delete('/:projectId/designations/:id', requireProjectPermission(PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.UPDATE), ...projectDesignationController.deleteDesignationHandler);

router.use('/:id/milestones', idParamHandler[0], milestonesRoutes);
router.use('/:id/roadmaps', idParamHandler[0], roadmapsRoutes);
router.use('/:id/test-cases', idParamHandler[0], testCasesRoutes);
router.use('/:id/test-plans', idParamHandler[0], testPlansRoutes);
router.use('/:id/traceability', idParamHandler[0], traceabilityRoutes);
router.get('/:id/sprints/:sprintId/report', requireProjectPermission(PROJECT_PERMISSIONS.SPRINT.SPRINT.READ), ...sprintReportHandler);
router.get('/:id/link-graph', ...idParamHandler, requireProjectPermission(PROJECT_PERMISSIONS.ISSUE.ISSUE.READ), asyncHandler(getProjectIssueGraph));
router.use('/:id/imports', idParamHandler[0], importsRoutes);
router.delete('/:id', ...idParamHandler, requireProjectPermission(PROJECT_PERMISSIONS.SCOPE.DELETE), asyncHandler(deleteProject));

export const projectsRoutes = router;
