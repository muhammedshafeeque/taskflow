import { Request, Response } from 'express';
import type { AuthPayload } from '../../types/express';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { projectsValidation } from './projects.validation';
import * as projectsService from './projects.service';
import * as workLogsService from '../workLogs/workLogs.service';
import * as projectInvitationsService from './projectInvitations.service';
import * as sprintReportsService from '../sprints/sprintReports.service';
import { getProjectPermissionsForUser } from '../../middleware/requireProjectPermission';
import { ApiError } from '../../utils/ApiError';
import { logAudit } from '../auditLogs/logAudit';
import * as analyticsService from '../analytics/analytics.service';

export async function createProject(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const leadId = req.user?.id;
  if (!leadId) throw new ApiError(401, 'Unauthorized');
  const project = await projectsService.create(req.body, leadId);
  const proj = project as unknown as { _id?: string; name?: string; key?: string };
  logAudit({
    userId: leadId,
    action: 'create',
    resourceType: 'project',
    resourceId: proj._id ? String(proj._id) : undefined,
    projectId: proj._id ? String(proj._id) : undefined,
    meta: { name: proj.name, key: proj.key },
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress,
  });
  analyticsService.logEvent(leadId, 'project_create', 'project', proj._id ? String(proj._id) : undefined).catch(() => {});
  res.status(201).json({ success: true, data: project });
}

let projectMemberRoleSynced = false;

export async function getProjects(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  const permissions = req.user?.permissions ?? [];
  if (!userId) throw new ApiError(401, 'Unauthorized');
  if (!projectMemberRoleSynced) {
    await projectInvitationsService.syncProjectMemberRolePermissions();
    projectMemberRoleSynced = true;
  }
  const page = parseInt(String(req.query.page), 10) || 1;
  const limit = Math.min(parseInt(String(req.query.limit), 10) || 20, 100);
  const result = await projectsService.findAllForUser(userId, permissions, { page, limit });
  res.status(200).json({ success: true, data: result });
}

export async function getProjectById(req: Request, res: Response): Promise<void> {
  const project = await projectsService.findById(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found');
  res.status(200).json({ success: true, data: project });
}

export async function getMyPermissions(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const projectId = req.params.id;
  const permissions = await getProjectPermissionsForUser(projectId, userId);
  res.status(200).json({ success: true, data: { permissions } });
}

export async function updateProject(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  const project = await projectsService.update(req.params.id, req.body);
  if (!project) throw new ApiError(404, 'Project not found');
  if (userId) {
    const proj = project as { name?: string; key?: string };
    logAudit({
      userId,
      action: 'update',
      resourceType: 'project',
      resourceId: req.params.id,
      projectId: req.params.id,
      meta: { name: proj.name, key: proj.key },
      ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress,
    });
  }
  res.status(200).json({ success: true, data: project });
}

export async function deleteProject(req: Request, res: Response): Promise<void> {
  const deleted = await projectsService.remove(req.params.id);
  if (!deleted) throw new ApiError(404, 'Project not found');
  res.status(200).json({ success: true, data: { message: 'Project deleted' } });
}

export async function releaseVersion(req: Request, res: Response): Promise<void> {
  const projectId = req.params.id;
  const { versionId, environmentId, issueIds } = req.body;
  const result = await projectsService.releaseVersionToEnvironment(projectId, versionId, environmentId, issueIds);
  res.status(200).json({ success: true, data: result });
}

export async function inviteToProject(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const projectId = req.params.id;
  const { email, roleId } = req.body as { email: string; roleId?: string };
  const data = await projectInvitationsService.inviteToProject(projectId, email, userId, roleId);
  logAudit({
    userId,
    action: 'invite',
    resourceType: 'project',
    resourceId: projectId,
    projectId,
    meta: { email },
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress,
  });
  res.status(201).json({ success: true, data });
}

export async function getMembers(req: Request, res: Response): Promise<void> {
  const data = await projectInvitationsService.listMembers(req.params.id);
  res.status(200).json({ success: true, data });
}

export async function getInvitations(req: Request, res: Response): Promise<void> {
  const data = await projectInvitationsService.listInvitations(req.params.id);
  res.status(200).json({ success: true, data });
}

export async function cancelInvitation(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  await projectInvitationsService.cancelInvitation(req.params.id, req.params.invitationId!, userId);
  res.status(200).json({ success: true, data: { cancelled: true } });
}

export async function getSprintReport(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const projectId = req.params.id;
  const sprintId = req.params.sprintId;
  const [burndown, velocity, summary] = await Promise.all([
    sprintReportsService.getSprintBurndown(sprintId, projectId, userId),
    sprintReportsService.getSprintVelocity(projectId, 10, userId),
    sprintReportsService.getSprintSummary(sprintId, projectId, userId),
  ]);
  res.status(200).json({ success: true, data: { burndown, velocity, summary } });
}

export async function getTimesheet(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const projectId = req.params.id;
  if (!projectId) throw new ApiError(400, 'Project ID is required');

  const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date(end);
  if (!startDate) {
    // default to 7-day window ending at `end`
    start.setDate(end.getDate() - 6);
  }

  const data = await workLogsService.getProjectTimesheet(projectId, start, end);
  res.status(200).json({ success: true, data });
}

export const createProjectHandler = [
  validate(projectsValidation.create.shape.body, 'body'),
  asyncHandler(createProject),
];

export const updateProjectHandler = [
  validate(projectsValidation.update.shape.params, 'params'),
  validate(projectsValidation.update.shape.body, 'body'),
  asyncHandler(updateProject),
];

export const idParamHandler = [
  validate(projectsValidation.idParam.shape.params, 'params'),
];

export const releaseVersionHandler = [
  validate(projectsValidation.releaseVersion.shape.params, 'params'),
  validate(projectsValidation.releaseVersion.shape.body, 'body'),
  asyncHandler(releaseVersion),
];

export const inviteToProjectHandler = [
  validate(projectsValidation.inviteProject.shape.params, 'params'),
  validate(projectsValidation.inviteProject.shape.body, 'body'),
  asyncHandler(inviteToProject),
];

export const cancelInvitationParamHandler = [
  validate(projectsValidation.cancelInvitationParams.shape.params, 'params'),
  asyncHandler(cancelInvitation),
];

export const timesheetHandler = [
  validate(projectsValidation.timesheetQuery.shape.params, 'params'),
  validate(projectsValidation.timesheetQuery.shape.query, 'query'),
  asyncHandler(getTimesheet),
];

export const sprintReportHandler = [
  validate(projectsValidation.sprintReportParams.shape.params, 'params'),
  asyncHandler(getSprintReport),
];
