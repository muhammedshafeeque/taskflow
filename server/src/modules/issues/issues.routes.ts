import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import {
  createIssueHandler,
  getIssues,
  getIssueById,
  getIssueByKey,
  getIssueHistory,
  getSubtasks,
  getIssueRollup,
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
import { PROJECT_PERMISSIONS } from '../../shared/constants/permissions';
import { requireIssuePermission } from '../../middleware/requireIssuePermission';
import {
  listStageEstimates,
  getEstimateSummary,
  submitStageEstimatesHandler,
  approveEstimateHandler,
  rejectEstimateHandler,
} from '../stageEstimates/stageEstimate.controller';
import { validate } from '../../middleware/validate';
import { stageEstimatesValidation } from '../stageEstimates/stageEstimate.validation';

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

const readIssue = requireIssuePermission(PROJECT_PERMISSIONS.ISSUE.ISSUE.READ);
const updateIssue = requireIssuePermission(PROJECT_PERMISSIONS.ISSUE.ISSUE.UPDATE);
const deleteIssuePerm = requireIssuePermission(PROJECT_PERMISSIONS.ISSUE.ISSUE.DELETE);
const estimateSubmit = requireIssuePermission(PROJECT_PERMISSIONS.ISSUE.ESTIMATE.SUBMIT);
const estimateApprove = requireIssuePermission(PROJECT_PERMISSIONS.ISSUE.ESTIMATE.APPROVE);
const estimateView = requireIssuePermission(PROJECT_PERMISSIONS.ISSUE.ESTIMATE.VIEW);

router.get('/:id/history', ...issueIdParamHandler, readIssue, asyncHandler(getIssueHistory));
router.get('/:id/subtasks', ...issueIdParamHandler, readIssue, asyncHandler(getSubtasks));
router.get('/:id/rollup', ...issueIdParamHandler, readIssue, asyncHandler(getIssueRollup));
router.get('/:id/links', ...issueIdParamHandler, readIssue, asyncHandler(getIssueLinks));
router.post('/:id/links', readIssue, addIssueLinkHandler);
router.delete('/:id/links/:linkId', readIssue, deleteIssueLinkHandler);
router.post('/:id/watch', ...issueIdParamHandler, readIssue, asyncHandler(watchIssue));
router.delete('/:id/watch', ...issueIdParamHandler, readIssue, asyncHandler(unwatchIssue));
router.get('/:id/watchers', ...issueIdParamHandler, readIssue, asyncHandler(getWatchers));
router.get('/:id/watching', ...issueIdParamHandler, readIssue, asyncHandler(getWatchingStatus));

router.get(
  '/:id/stage-estimates',
  validate(stageEstimatesValidation.issueIdParam.shape.params, 'params'),
  readIssue,
  estimateView,
  asyncHandler(listStageEstimates)
);
router.get(
  '/:id/estimate-summary',
  validate(stageEstimatesValidation.issueIdParam.shape.params, 'params'),
  readIssue,
  estimateView,
  asyncHandler(getEstimateSummary)
);
router.put('/:id/stage-estimates', estimateSubmit, ...submitStageEstimatesHandler);
router.post('/:id/stage-estimates/:estimateId/approve', estimateApprove, ...approveEstimateHandler);
router.post('/:id/stage-estimates/:estimateId/reject', estimateApprove, ...rejectEstimateHandler);

router.get('/:id', ...issueIdParamHandler, readIssue, asyncHandler(getIssueById));
router.patch('/:id', updateIssue, updateIssueHandler);
router.delete('/:id', ...issueIdParamHandler, deleteIssuePerm, asyncHandler(deleteIssue));

export const issuesRoutes = router;
