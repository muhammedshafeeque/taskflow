import { Router } from 'express';
import * as designationTemplates from './designationTemplates.service';
import { Project } from './project.model';
import { ProjectDesignation } from './projectDesignation.model';
import { User } from '../auth/user.model';
import { ApiError } from '../../utils/ApiError';
import { governanceRouter } from './projectGovernance';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/requirePermission';
import { requireTaskflowUser } from '../../middleware/requireTaskflowUser';
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
  resolvedFieldsHandler,
  estimateApprovalsHandler,
  projectRulesDryRunHandler,
  enableEstimateApprovalHandler,
  updateMemberDesignation,
  removeMember,
} from './projects.controller';
import {
  getProjectTimeline,
  snapshotProjectBaseline,
} from '../timeline/timeline.controller';
import { importsRoutes } from '../imports/imports.routes';
import { adoIntegrationRoutes } from '../integrations/ado/adoIntegration.routes';
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
router.use(requireTaskflowUser);

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
router.get('/:id/resolved-fields', ...idParamHandler, requireProjectPermission(PROJECT_PERMISSIONS.ISSUE.ISSUE.READ), ...resolvedFieldsHandler);
router.get('/:id/estimate-approvals', ...idParamHandler, requireProjectPermission(PROJECT_PERMISSIONS.ISSUE.ESTIMATE.VIEW), ...estimateApprovalsHandler);
router.post('/:id/rules/dry-run', ...idParamHandler, requireProjectPermission(PROJECT_PERMISSIONS.ISSUE.RULE.MANAGE), ...projectRulesDryRunHandler);
router.post('/:id/enable-estimate-approval', ...idParamHandler, requireProjectPermission(PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.UPDATE), ...enableEstimateApprovalHandler);
router.patch('/:id', ...idParamHandler, requireProjectPermission(PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.UPDATE), ...updateProjectHandler);
router.post('/:id/versions/release', releaseVersionHandler);
router.get('/:id/timesheet', ...idParamHandler, requireProjectPermission(PROJECT_PERMISSIONS.ISSUE.ISSUE.READ), ...timesheetHandler);

// Member and Designation management
router.patch('/:projectId/members/:memberId', requireProjectPermission(PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.UPDATE), asyncHandler(updateMemberDesignation));
router.delete('/:projectId/members/:memberId', requireProjectPermission(PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.UPDATE), asyncHandler(removeMember));

router.get('/:projectId/designations', requireProjectPermission(PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.READ), ...projectDesignationController.listDesignationsHandler);
// Company designation templates for this project: what is offered, copying some in, and a suggestion for an invite.
router.get('/:projectId/designations/templates', requireProjectPermission(PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.UPDATE), asyncHandler(async (req, res) => {
  const project = await Project.findById(req.params.projectId).select('taskflowOrganizationId').lean();
  const have = await ProjectDesignation.find({ projectId: req.params.projectId }).select('code templateId').lean();
  const templates = await designationTemplates.listTemplates(project?.taskflowOrganizationId ? String(project.taskflowOrganizationId) : null, true);
  res.json({ success: true, data: templates.map((t) => ({ ...t, inProject: have.some((d) => d.code === t.code || String(d.templateId) === String(t._id)) })) });
}));
router.post('/:projectId/designations/from-templates', requireProjectPermission(PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.UPDATE), asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.templateIds) ? req.body.templateIds.map(String) : [];
  if (!ids.length) throw new ApiError(400, 'Choose at least one template');
  res.json({ success: true, data: await designationTemplates.addTemplatesToProject(req.params.projectId, ids) });
}));
router.get('/:projectId/designations/suggest', requireProjectPermission(PROJECT_PERMISSIONS.MEMBER.INVITATIONS_MANAGE), asyncHandler(async (req, res) => {
  let userId = String(req.query.userId ?? '');
  if (!userId && req.query.email) {
    const u = await User.findOne({ email: String(req.query.email).toLowerCase().trim() }).select('_id').lean();
    userId = u ? String(u._id) : '';
  }
  res.json({ success: true, data: userId ? await designationTemplates.suggestDesignation(req.params.projectId, userId) : null });
}));
router.post('/:projectId/designations', requireProjectPermission(PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.UPDATE), ...projectDesignationController.createDesignationHandler);
router.patch('/:projectId/designations/:id', requireProjectPermission(PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.UPDATE), ...projectDesignationController.updateDesignationHandler);
router.delete('/:projectId/designations/:id', requireProjectPermission(PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.UPDATE), ...projectDesignationController.deleteDesignationHandler);

router.use('/:id/milestones', idParamHandler[0], milestonesRoutes);
router.use('/:id/governance', idParamHandler[0], governanceRouter);
router.use('/:id/roadmaps', idParamHandler[0], roadmapsRoutes);
router.use('/:id/test-cases', idParamHandler[0], testCasesRoutes);
router.use('/:id/test-plans', idParamHandler[0], testPlansRoutes);
router.use('/:id/traceability', idParamHandler[0], traceabilityRoutes);
router.get('/:id/sprints/:sprintId/report', requireProjectPermission(PROJECT_PERMISSIONS.SPRINT.SPRINT.READ), ...sprintReportHandler);
router.get('/:id/link-graph', ...idParamHandler, requireProjectPermission(PROJECT_PERMISSIONS.ISSUE.ISSUE.READ), asyncHandler(getProjectIssueGraph));
router.get('/:id/timeline', ...idParamHandler, requireProjectPermission(PROJECT_PERMISSIONS.ISSUE.ISSUE.READ), asyncHandler(getProjectTimeline));
router.post('/:id/timeline/baseline', ...idParamHandler, requireProjectPermission(PROJECT_PERMISSIONS.ISSUE.ISSUE.UPDATE), asyncHandler(snapshotProjectBaseline));
router.use('/:id/imports', idParamHandler[0], importsRoutes);
router.use(
  '/:id/ado-integration',
  idParamHandler[0],
  requireProjectPermission(PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.UPDATE),
  adoIntegrationRoutes
);
router.delete('/:id', ...idParamHandler, requireProjectPermission(PROJECT_PERMISSIONS.SCOPE.DELETE), asyncHandler(deleteProject));

export const projectsRoutes = router;
