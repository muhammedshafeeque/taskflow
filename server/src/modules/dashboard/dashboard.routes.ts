import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  getDashboardStats,
  getWorkloadStats,
  getPortfolioStats,
  getExecutiveStats,
  getDefectMetrics,
  getCostUsage,
  getEstimatesStats,
  getProjectMetrics,
  getPerformanceReportUsersHandler,
  getPerformanceReportHandler,
  exportPerformanceReportExcelHandler,
} from './dashboard.controller';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';

const router = Router();

router.use(authMiddleware);

router.get('/stats', asyncHandler(getDashboardStats));
router.get('/workload', asyncHandler(getWorkloadStats));
router.get('/portfolio', asyncHandler(getPortfolioStats));
router.get('/executive', asyncHandler(getExecutiveStats));
router.get('/defect-metrics', asyncHandler(getDefectMetrics));
router.get('/cost-usage', requirePermission(TASK_FLOW_PERMISSIONS.TASKFLOW.COST_REPORT.VIEW), asyncHandler(getCostUsage));
router.get('/estimates', asyncHandler(getEstimatesStats));
router.get('/project-metrics', asyncHandler(getProjectMetrics));
router.get('/performance-report/users', ...getPerformanceReportUsersHandler);
router.get('/performance-report/export', ...exportPerformanceReportExcelHandler);
router.get('/performance-report', ...getPerformanceReportHandler);

export const dashboardRoutes = router;
