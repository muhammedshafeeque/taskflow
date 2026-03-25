import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { authRoutes } from '../modules/auth/auth.routes';
import { usersRoutes } from '../modules/users/users.routes';
import { rolesRoutes } from '../modules/roles/roles.routes';
import { designationsRoutes } from '../modules/designations/designations.routes';
import { projectsRoutes } from '../modules/projects/projects.routes';
import { issuesRoutes } from '../modules/issues/issues.routes';
import { boardsRoutes } from '../modules/boards/boards.routes';
import { sprintsRoutes } from '../modules/sprints/sprints.routes';
import { commentsRoutes } from '../modules/comments/comments.routes';
import { workLogsRoutes } from '../modules/workLogs/workLogs.routes';
import { globalTimesheetHandler, timesheetDetailsHandler, timesheetExportHandler } from '../modules/workLogs/workLogs.controller';
import { inboxRoutes } from '../modules/inbox/inbox.routes';
import { invitationsRoutes } from '../modules/invitations/invitations.routes';
import { pushSubscriptionsRoutes } from '../modules/pushSubscriptions/pushSubscriptions.routes';
import { pushRoutes } from '../modules/push/push.routes';
import { uploadsRoutes } from '../modules/uploads/uploads.routes';
import { attachmentsRoutes } from '../modules/attachments/attachments.routes';
import { savedFiltersRoutes } from '../modules/savedFilters/savedFilters.routes';
import { dashboardRoutes } from '../modules/dashboard/dashboard.routes';
import { auditLogsRoutes } from '../modules/auditLogs/auditLog.routes';
import { projectTemplatesRoutes } from '../modules/projectTemplates/projectTemplates.routes';
import { adminRoutes } from '../modules/admin/admin.routes';
import { analyticsRoutes } from '../modules/analytics/analytics.routes';
import { reportsRoutes } from '../modules/reports/reports.routes';
import { notificationsRoutes } from '../modules/notifications/notifications.routes';

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    data: { status: 'ok', timestamp: new Date().toISOString() },
  });
});

router.use('/auth', authRoutes);
router.get('/timesheet/details', authMiddleware, ...timesheetDetailsHandler);
router.get('/timesheet/export', authMiddleware, ...timesheetExportHandler);
router.get('/timesheet', authMiddleware, ...globalTimesheetHandler);
router.use('/users', usersRoutes);
router.use('/roles', rolesRoutes);
router.use('/designations', designationsRoutes);
router.use('/inbox', inboxRoutes);
router.use('/invitations', invitationsRoutes);
router.use('/push-subscriptions', pushSubscriptionsRoutes);
router.use('/push', pushRoutes);
router.use('/projects', projectsRoutes);
router.use('/issues', issuesRoutes);
router.use('/boards', boardsRoutes);
router.use('/sprints', sprintsRoutes);
router.use('/issues', commentsRoutes);
router.use('/issues', workLogsRoutes);
router.use('/issues', attachmentsRoutes);
router.use('/uploads', uploadsRoutes);
router.use('/saved-filters', savedFiltersRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/audit-logs', auditLogsRoutes);
router.use('/project-templates', projectTemplatesRoutes);
router.use('/admin', adminRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/reports', reportsRoutes);
router.use('/notifications', notificationsRoutes);

export const apiRoutes = router;
