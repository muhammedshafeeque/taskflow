import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { listAuditLogs } from './auditLog.controller';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';

const router = Router();

router.use(authMiddleware);
router.get(
  '/',
  requirePermission(TASK_FLOW_PERMISSIONS.TASKFLOW.PLATFORM.AUDIT.READ),
  asyncHandler(listAuditLogs)
);

export const auditLogsRoutes = router;
