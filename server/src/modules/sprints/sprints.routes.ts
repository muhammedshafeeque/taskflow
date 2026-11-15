import { Router, type Request } from 'express';
import mongoose from 'mongoose';
import { authMiddleware } from '../../middleware/auth.middleware';
import {
  createSprintHandler,
  getSprints,
  getSprintById,
  updateSprintHandler,
  startSprint,
  completeSprint,
  getCompletionPreview,
  deleteSprint,
  sprintIdParamHandler,
} from './sprints.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { projectOfRecord, requireProjectPermissionVia } from '../../middleware/requireProjectPermission';
import { PROJECT_PERMISSIONS } from '../../shared/constants/permissions';
import { Sprint } from './sprint.model';
import { Board } from '../boards/board.model';

const router = Router();
const S = PROJECT_PERMISSIONS.SPRINT.SPRINT;

router.use(authMiddleware);

const sprintProject = projectOfRecord(Sprint);
/** `?project=` or, failing that, the project of `?board=`. */
const listProject = async (req: Request) => {
  if (req.query.project) return String(req.query.project);
  const boardId = String(req.query.board ?? '');
  if (!mongoose.Types.ObjectId.isValid(boardId)) return null;
  const board = await Board.findById(boardId).select('project').lean();
  return board ? String(board.project) : null;
};
const fromBody = async (req: Request) => (req.body?.project ? String(req.body.project) : null);
const readSprintsOf = requireProjectPermissionVia(S.READ, listProject, 'Project not found');
const onSprint = (perms: string[]) => requireProjectPermissionVia(perms, sprintProject, 'Sprint not found');

// "Edit sprints" (sprint.sprint.update) is the older all-round sprint permission, so it also allows the specific actions.
router.get('/', (req, res, next) => (req.query.project || req.query.board ? readSprintsOf(req, res, next) : next()), asyncHandler(getSprints));
router.post('/', ...createSprintHandler.slice(0, -1), requireProjectPermissionVia([S.CREATE, S.UPDATE], fromBody, 'Project not found'), createSprintHandler[createSprintHandler.length - 1]);
router.get('/:id/completion-preview', ...sprintIdParamHandler, onSprint([S.READ]), asyncHandler(getCompletionPreview));
router.get('/:id', ...sprintIdParamHandler, onSprint([S.READ]), asyncHandler(getSprintById));
router.patch('/:id', ...updateSprintHandler.slice(0, -1), onSprint([S.UPDATE]), updateSprintHandler[updateSprintHandler.length - 1]);
router.post('/:id/start', ...sprintIdParamHandler, onSprint([S.START, S.UPDATE]), asyncHandler(startSprint));
router.post('/:id/complete', ...sprintIdParamHandler, onSprint([S.CLOSE, S.UPDATE]), asyncHandler(completeSprint));
router.delete('/:id', ...sprintIdParamHandler, onSprint([S.DELETE, S.UPDATE]), asyncHandler(deleteSprint));

export const sprintsRoutes = router;
