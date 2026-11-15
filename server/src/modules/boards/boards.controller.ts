import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import {
  createBoardSchema,
  updateBoardSchema,
  boardIdParamSchema,
} from './boards.validation';
import * as boardsService from './boards.service';
import { ApiError } from '../../utils/ApiError';
import { listableProjectIds } from '../issues/issues.service';

export async function createBoard(req: Request, res: Response): Promise<void> {
  const board = await boardsService.create(req.body);
  res.status(201).json({ success: true, data: board });
}

export async function getBoards(req: Request, res: Response): Promise<void> {
  const page = parseInt(String(req.query.page), 10) || 1;
  const limit = Math.min(parseInt(String(req.query.limit), 10) || 20, 100);
  const projectId = req.query.project ? String(req.query.project) : undefined;
  // With a project, the route has already checked board access to it; otherwise list the user's projects here.
  const result = projectId
    ? await boardsService.findAll({ projectId }, { page, limit })
    : await boardsService.findAll(
        { projectIds: await listableProjectIds(req.user!.id, { organizationId: req.activeOrganizationId, fullProjectAccess: false }) },
        { page, limit }
      );
  res.status(200).json({ success: true, data: result });
}

export async function getBoardById(req: Request, res: Response): Promise<void> {
  const board = await boardsService.findById(req.params.id);
  if (!board) throw new ApiError(404, 'Board not found');
  res.status(200).json({ success: true, data: board });
}

export async function updateBoard(req: Request, res: Response): Promise<void> {
  const board = await boardsService.update(req.params.id, req.body);
  if (!board) throw new ApiError(404, 'Board not found');
  res.status(200).json({ success: true, data: board });
}

export async function deleteBoard(req: Request, res: Response): Promise<void> {
  const result = await boardsService.remove(req.params.id);
  if (!result.deleted) throw new ApiError(404, 'Board not found');
  const message = result.movedTo ? `Board deleted; its ${result.movedSprints} sprint(s) moved to "${result.movedTo.name}"` : 'Board deleted';
  res.status(200).json({ success: true, data: { message, movedSprints: result.movedSprints ?? 0, movedTo: result.movedTo ?? null } });
}

export const createBoardHandler = [
  validate(createBoardSchema.shape.body, 'body'),
  asyncHandler(createBoard),
];

export const updateBoardHandler = [
  validate(updateBoardSchema.shape.params, 'params'),
  validate(updateBoardSchema.shape.body, 'body'),
  asyncHandler(updateBoard),
];

export const boardIdParamHandler = [
  validate(boardIdParamSchema.shape.params, 'params'),
];
