import { Router, type Request } from 'express';
import mongoose from 'mongoose';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireTaskflowUser } from '../../middleware/requireTaskflowUser';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { Issue } from '../issues/issue.model';
import { Project } from '../projects/project.model';
import { ProjectMember } from '../projects/projectMember.model';
import { getClosedStatusNamesFromStatuses } from '../projects/statusClassification';
import { WorkLog } from '../workLogs/workLog.model';
import { CalendarEvent } from '../calendar/models/calendarEvent.model';
import * as issuesService from '../issues/issues.service';
import * as workLogsService from '../workLogs/workLogs.service';
import { getProjectPermissionsForUser } from '../../middleware/requireProjectPermission';
import { PROJECT_PERMISSIONS } from '../../shared/constants/permissions';
import { selfServiceRouter } from './selfService.routes';

/**
 * Compact, phone-friendly endpoints for the signed-in user (used by the mobile
 * app with a personal API token): my open work, quick status changes, quick
 * time logging and my agenda.
 */
type AuthedRequest = Request & { user?: { id: string; permissions?: string[] }; activeOrganizationId?: string };

const router = Router();
router.use(authMiddleware, requireTaskflowUser);

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

router.get(
  '/work',
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = new mongoose.Types.ObjectId(req.user!.id);
    const memberProjects = await ProjectMember.find({ user: userId }).distinct('project');
    const projects = await Project.find({
      _id: { $in: memberProjects },
      archived: { $ne: true },
      ...(req.activeOrganizationId ? { taskflowOrganizationId: req.activeOrganizationId } : {}),
    })
      .select('name key statuses')
      .lean();
    const byId = new Map(projects.map((p) => [String(p._id), p]));
    const closed = new Map(projects.map((p) => [String(p._id), new Set(getClosedStatusNamesFromStatuses(p.statuses))]));

    const issues = await Issue.find({ assignee: userId, project: { $in: projects.map((p) => p._id) } })
      .select('key title status priority type dueDate project updatedAt')
      .sort({ dueDate: 1, updatedAt: -1 })
      .limit(300)
      .lean();
    const open = issues.filter((i) => !closed.get(String(i.project))?.has(i.status)).slice(0, 100);

    const today = startOfDay();
    const logged = await WorkLog.aggregate<{ minutes: number }>([
      { $match: { author: userId, date: { $gte: today } } },
      { $group: { _id: null, minutes: { $sum: '$minutesSpent' } } },
    ]);
    const now = Date.now();

    res.json({
      success: true,
      data: {
        loggedTodayMinutes: logged[0]?.minutes ?? 0,
        counts: {
          open: open.length,
          overdue: open.filter((i) => i.dueDate && new Date(i.dueDate).getTime() < now).length,
          dueThisWeek: open.filter((i) => i.dueDate && new Date(i.dueDate).getTime() - now < 7 * 86_400_000).length,
        },
        issues: open.map((i) => {
          const p = byId.get(String(i.project));
          return {
            _id: String(i._id),
            key: i.key,
            title: i.title,
            status: i.status,
            priority: i.priority,
            type: i.type,
            dueDate: i.dueDate,
            projectId: String(i.project),
            projectName: p?.name,
            projectKey: p?.key,
            statuses: ((p?.statuses ?? []) as Array<{ name: string }>).map((s) => s.name),
          };
        }),
      },
    });
  })
);

async function assertCan(req: AuthedRequest, issueId: string, permission: string) {
  const issue = await Issue.findById(issueId).select('project').lean();
  if (!issue) throw new ApiError(404, 'Issue not found');
  const perms = await getProjectPermissionsForUser(String(issue.project), req.user!.id, req.user!.permissions, req.activeOrganizationId);
  if (!perms.includes(permission)) throw new ApiError(403, 'Insufficient permissions for this project');
  return { projectId: String(issue.project), perms };
}

router.patch(
  '/work/:issueId/status',
  asyncHandler(async (req: AuthedRequest, res) => {
    const status = String(req.body?.status ?? '').trim();
    if (!status) throw new ApiError(400, 'status is required');
    await assertCan(req, req.params.issueId, PROJECT_PERMISSIONS.ISSUE.ISSUE.UPDATE);
    const data = await issuesService.update(req.params.issueId, { status }, req.user!.id);
    res.json({ success: true, data });
  })
);

router.post(
  '/work/:issueId/time',
  asyncHandler(async (req: AuthedRequest, res) => {
    const minutes = Math.round(Number(req.body?.minutes));
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 24 * 60) throw new ApiError(400, 'minutes must be 1–1440');
    const { perms } = await assertCan(req, req.params.issueId, PROJECT_PERMISSIONS.ISSUE.ISSUE.READ);
    const data = await workLogsService.create(
      req.params.issueId,
      req.user!.id,
      minutes,
      req.body?.date ? new Date(String(req.body.date)) : new Date(),
      req.body?.note ? String(req.body.note).slice(0, 2000) : undefined,
      { memberPermissions: perms, userGlobalPermissions: req.user!.permissions, activeOrganizationId: req.activeOrganizationId }
    );
    res.status(201).json({ success: true, data });
  })
);

router.get(
  '/agenda',
  asyncHandler(async (req: AuthedRequest, res) => {
    if (!req.activeOrganizationId) throw new ApiError(400, 'No active workspace');
    const days = Math.min(Math.max(1, Number(req.query.days) || 7), 31);
    const from = startOfDay();
    const to = new Date(from.getTime() + days * 86_400_000);
    const userId = new mongoose.Types.ObjectId(req.user!.id);
    const events = await CalendarEvent.find({
      taskflowOrganizationId: req.activeOrganizationId,
      start: { $gte: from, $lt: to },
      $or: [{ ownerId: userId }, { attendeeIds: userId }],
    })
      .select('title kind start end allDay location meetingUrl accountId')
      .populate('accountId', 'name')
      .sort({ start: 1 })
      .limit(200)
      .lean();
    res.json({ success: true, data: events });
  })
);

// Employee self-service (leave, attendance, payslips, expenses, assets, directory)
router.use('/hr', selfServiceRouter);

export const meRoutes = router;
