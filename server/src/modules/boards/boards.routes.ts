import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import {
  createBoardHandler,
  getBoards,
  getBoardById,
  updateBoardHandler,
  deleteBoard,
  boardIdParamHandler,
} from './boards.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { projectOfRecord, requireProjectPermissionVia } from '../../middleware/requireProjectPermission';
import { PROJECT_PERMISSIONS } from '../../shared/constants/permissions';
import { Board } from './board.model';

const router = Router();
const B = PROJECT_PERMISSIONS.BOARD.BOARD;

router.use(authMiddleware);

const boardProject = projectOfRecord(Board);
const fromQuery = async (req: import('express').Request) => (req.query.project ? String(req.query.project) : null);
const fromBody = async (req: import('express').Request) => (req.body?.project ? String(req.body.project) : null);
/** Listing a named project's boards needs board access there; without one, the controller lists the user's own projects. */
const readBoardsOfProject = requireProjectPermissionVia(B.READ, fromQuery, 'Project not found');

router.get('/', (req, res, next) => (req.query.project ? readBoardsOfProject(req, res, next) : next()), asyncHandler(getBoards));
router.post('/', ...createBoardHandler.slice(0, -1), requireProjectPermissionVia(B.UPDATE, fromBody, 'Project not found'), createBoardHandler[createBoardHandler.length - 1]);
router.get('/:id', ...boardIdParamHandler, requireProjectPermissionVia(B.READ, boardProject, 'Board not found'), asyncHandler(getBoardById));
router.patch('/:id', ...updateBoardHandler.slice(0, -1), requireProjectPermissionVia(B.UPDATE, boardProject, 'Board not found'), updateBoardHandler[updateBoardHandler.length - 1]);
router.delete('/:id', ...boardIdParamHandler, requireProjectPermissionVia(B.UPDATE, boardProject, 'Board not found'), asyncHandler(deleteBoard));

export const boardsRoutes = router;
