import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import {
  createWorkLogHandler,
  getWorkLogs,
  updateWorkLogHandler,
  deleteWorkLog,
  workLogIdParamHandler,
  issueIdParamHandler,
} from './workLogs.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireIssuePermission } from '../../middleware/requireIssuePermission';
import { PROJECT_PERMISSIONS } from '../../shared/constants/permissions';

const router = Router({ mergeParams: true });

router.use(authMiddleware);

const readWorkLog = requireIssuePermission(PROJECT_PERMISSIONS.WORK_LOG.WORK_LOG.READ, 'issueId');
const createWorkLog = requireIssuePermission(PROJECT_PERMISSIONS.WORK_LOG.WORK_LOG.CREATE, 'issueId');
const updateWorkLog = requireIssuePermission(PROJECT_PERMISSIONS.WORK_LOG.WORK_LOG.UPDATE, 'issueId');
const deleteWorkLogPerm = requireIssuePermission(PROJECT_PERMISSIONS.WORK_LOG.WORK_LOG.DELETE, 'issueId');

router.get('/', ...issueIdParamHandler, readWorkLog, asyncHandler(getWorkLogs));
router.post('/', ...issueIdParamHandler, createWorkLog, ...createWorkLogHandler);
router.patch('/:id', ...workLogIdParamHandler, updateWorkLog, ...updateWorkLogHandler);
router.delete('/:id', ...workLogIdParamHandler, deleteWorkLogPerm, asyncHandler(deleteWorkLog));

export const workLogsRoutes = router;
