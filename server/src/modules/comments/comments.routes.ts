import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import {
  createCommentHandler,
  getComments,
  getCommentById,
  updateCommentHandler,
  deleteComment,
  commentIdParamHandler,
  issueIdOnlyParamHandler,
} from './comments.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireIssuePermission } from '../../middleware/requireIssuePermission';
import { PROJECT_PERMISSIONS } from '../../shared/constants/permissions';

const router = Router({ mergeParams: true });

router.use(authMiddleware);

const readComment = requireIssuePermission(PROJECT_PERMISSIONS.ISSUE.COMMENT.READ, 'issueId');
const createComment = requireIssuePermission(PROJECT_PERMISSIONS.ISSUE.COMMENT.CREATE, 'issueId');
const updateComment = requireIssuePermission(PROJECT_PERMISSIONS.ISSUE.COMMENT.UPDATE, 'issueId');
const deleteCommentPerm = requireIssuePermission(PROJECT_PERMISSIONS.ISSUE.COMMENT.DELETE, 'issueId');

router.get('/', ...issueIdOnlyParamHandler, readComment, asyncHandler(getComments));
router.post('/', createComment, createCommentHandler);
router.get('/:id', ...commentIdParamHandler, readComment, asyncHandler(getCommentById));
router.patch('/:id', updateComment, updateCommentHandler);
router.delete('/:id', ...commentIdParamHandler, deleteCommentPerm, asyncHandler(deleteComment));

export const commentsRoutes = router;
