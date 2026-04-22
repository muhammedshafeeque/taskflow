import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import {
  createIssueHandler,
  getIssues,
  getIssueById,
  getIssueByKey,
  getIssueHistory,
  getSubtasks,
  getIssueLinks,
  addIssueLinkHandler,
  deleteIssueLinkHandler,
  watchIssue,
  unwatchIssue,
  getWatchers,
  getWatchingStatus,
  getWatchingStatusBatch,
  searchIssues,
  searchByJql,
  searchGlobalQueryHandler,
  jqlQueryHandler,
  updateIssueHandler,
  getQuickFilterCounts,
  deleteIssue,
  bulkUpdateHandler,
  bulkDeleteHandler,
  backlogOrderHandler,
  exportIssuesHandler,
  issueIdParamHandler,
  searchIssuesQueryHandler,
  byKeyQueryHandler,
} from './issues.controller';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

router.use(authMiddleware);

router.get('/', asyncHandler(getIssues));
router.get('/quick-filters/counts', asyncHandler(getQuickFilterCounts));
router.get('/search', searchIssuesQueryHandler, asyncHandler(searchIssues));
router.get('/jql', ...jqlQueryHandler, asyncHandler(searchByJql));
router.get('/search-global', ...searchGlobalQueryHandler);
router.get('/by-key', byKeyQueryHandler, asyncHandler(getIssueByKey));
router.get('/export', ...exportIssuesHandler);
router.get('/watching-status', asyncHandler(getWatchingStatusBatch));
router.post('/', createIssueHandler);
router.patch('/bulk', bulkUpdateHandler);
router.delete('/bulk', bulkDeleteHandler);
router.put('/backlog-order', ...backlogOrderHandler);
router.get('/:id/history', ...issueIdParamHandler, asyncHandler(getIssueHistory));
router.get('/:id/subtasks', ...issueIdParamHandler, asyncHandler(getSubtasks));
router.get('/:id/links', ...issueIdParamHandler, asyncHandler(getIssueLinks));
router.post('/:id/links', addIssueLinkHandler);
router.delete('/:id/links/:linkId', deleteIssueLinkHandler);
router.post('/:id/watch', ...issueIdParamHandler, asyncHandler(watchIssue));
router.delete('/:id/watch', ...issueIdParamHandler, asyncHandler(unwatchIssue));
router.get('/:id/watchers', ...issueIdParamHandler, asyncHandler(getWatchers));
router.get('/:id/watching', ...issueIdParamHandler, asyncHandler(getWatchingStatus));
router.get('/:id', ...issueIdParamHandler, asyncHandler(getIssueById));
router.patch('/:id', updateIssueHandler);
router.delete('/:id', ...issueIdParamHandler, asyncHandler(deleteIssue));

export const issuesRoutes = router;
