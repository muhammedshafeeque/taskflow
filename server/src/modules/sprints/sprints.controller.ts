import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import {
  createSprintSchema,
  updateSprintSchema,
  sprintIdParamSchema,
} from './sprints.validation';
import * as sprintsService from './sprints.service';
import { ApiError } from '../../utils/ApiError';
import { listableProjectIds } from '../issues/issues.service';

export async function createSprint(req: Request, res: Response): Promise<void> {
  const sprint = await sprintsService.create(req.body);
  res.status(201).json({ success: true, data: sprint });
}

export async function getSprints(req: Request, res: Response): Promise<void> {
  const page = parseInt(String(req.query.page), 10) || 1;
  const limit = Math.min(parseInt(String(req.query.limit), 10) || 20, 100);
  const projectId = req.query.project ? String(req.query.project) : undefined;
  const boardId = req.query.board ? String(req.query.board) : undefined;
  const status = req.query.status ? String(req.query.status) : undefined;
  // With a project the route has checked sprint access; otherwise only the user's projects in this workspace.
  const scope = projectId
    ? { projectId }
    : { projectIds: await listableProjectIds(req.user!.id, { organizationId: req.activeOrganizationId }) };
  const result = await sprintsService.findAll({ ...scope, boardId, status }, { page, limit });
  res.status(200).json({ success: true, data: result });
}

export async function getSprintById(req: Request, res: Response): Promise<void> {
  const sprint = await sprintsService.findById(req.params.id);
  if (!sprint) throw new ApiError(404, 'Sprint not found');
  res.status(200).json({ success: true, data: sprint });
}

export async function updateSprint(req: Request, res: Response): Promise<void> {
  const sprint = await sprintsService.update(req.params.id, req.body);
  if (!sprint) throw new ApiError(404, 'Sprint not found');
  res.status(200).json({ success: true, data: sprint });
}

export async function startSprint(req: Request, res: Response): Promise<void> {
  const sprint = await sprintsService.start(req.params.id);
  if (!sprint) throw new ApiError(404, 'Sprint not found');
  res.status(200).json({ success: true, data: sprint });
}

export async function completeSprint(req: Request, res: Response): Promise<void> {
  const sprint = await sprintsService.complete(req.params.id);
  if (!sprint) throw new ApiError(404, 'Sprint not found');
  res.status(200).json({ success: true, data: sprint });
}

export async function getCompletionPreview(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  // The sprint's own project (checked by the route); a `project` query is accepted for older clients.
  const projectId = (req as Request & { resolvedProjectId?: string }).resolvedProjectId ?? String(req.query.project ?? '');
  if (!projectId) throw new ApiError(400, 'Project ID is required');
  const data = await sprintsService.getCompletionPreview(id, projectId);
  res.status(200).json({ success: true, data });
}

export async function deleteSprint(req: Request, res: Response): Promise<void> {
  const deleted = await sprintsService.remove(req.params.id);
  if (!deleted) throw new ApiError(404, 'Sprint not found');
  res.status(200).json({ success: true, data: { message: 'Sprint deleted' } });
}

export const createSprintHandler = [
  validate(createSprintSchema.shape.body, 'body'),
  asyncHandler(createSprint),
];

export const updateSprintHandler = [
  validate(updateSprintSchema.shape.params, 'params'),
  validate(updateSprintSchema.shape.body, 'body'),
  asyncHandler(updateSprint),
];

export const sprintIdParamHandler = [
  validate(sprintIdParamSchema.shape.params, 'params'),
];
