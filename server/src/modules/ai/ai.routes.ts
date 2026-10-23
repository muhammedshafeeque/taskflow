import { Router, type Request, type Response, type NextFunction } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireIssuePermission } from '../../middleware/requireIssuePermission';
import { requireProjectPermission, getProjectPermissionsForUser, hasProjectFullAccess } from '../../middleware/requireProjectPermission';
import { requirePermission } from '../../middleware/requirePermission';
import { requireModuleEnabled } from '../../middleware/requireModuleEnabled';
import { requireTaskflowUser } from '../../middleware/requireTaskflowUser';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { PROJECT_PERMISSIONS, TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import { Issue } from '../issues/issue.model';
import { Sprint } from '../sprints/sprint.model';
import { getAiStatus } from '../../services/ai.service';
import { draftIssue, findSimilarIssues, sprintRetro, suggestTicketReply, summarizeIssue } from './ai.service';

type AuthedRequest = Request & { user?: { id: string; permissions?: string[] }; activeOrganizationId?: string };

/** Simple per-user limiter so one person can't run up the AI bill. */
const hits = new Map<string, number[]>();
const PER_MINUTE = Math.max(1, Number(process.env.AI_REQUESTS_PER_MINUTE) || 12);

function rateLimit(req: AuthedRequest, _res: Response, next: NextFunction) {
  const key = req.user?.id ?? req.ip ?? 'anon';
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= PER_MINUTE) {
    next(new ApiError(429, 'Too many AI requests — wait a minute and try again.'));
    return;
  }
  recent.push(now);
  hits.set(key, recent);
  next();
}

function requireAiEnabled(_req: Request, _res: Response, next: NextFunction) {
  if (!getAiStatus().enabled) {
    next(new ApiError(503, 'AI is not configured on this server.'));
    return;
  }
  next();
}

const router = Router();
router.use(authMiddleware, requireTaskflowUser);

router.get('/status', (_req, res) => {
  res.json({ success: true, data: getAiStatus() });
});

const pm = requireModuleEnabled('pm');
const issueRead = requireIssuePermission(PROJECT_PERMISSIONS.ISSUE.ISSUE.READ, 'id');

router.post(
  '/issues/:id/summary',
  pm,
  issueRead,
  requireAiEnabled,
  rateLimit,
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ success: true, data: await summarizeIssue(req.params.id) });
  })
);

router.get(
  '/issues/:id/similar',
  pm,
  issueRead,
  asyncHandler(async (req: AuthedRequest, res) => {
    const issue = await Issue.findById(req.params.id).select('project title description').lean();
    if (!issue) throw new ApiError(404, 'Issue not found');
    const data = await findSimilarIssues(String(issue.project), `${issue.title} ${issue.description ?? ''}`, req.params.id);
    res.json({ success: true, data });
  })
);

/** Duplicate check while typing a new issue (no AI call — keyword overlap). */
router.post(
  '/issues/similar',
  pm,
  requireProjectPermission(PROJECT_PERMISSIONS.ISSUE.ISSUE.READ, { body: 'projectId' }),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { projectId, text } = (req.body ?? {}) as { projectId?: string; text?: string };
    res.json({ success: true, data: await findSimilarIssues(String(projectId), String(text ?? '')) });
  })
);

router.post(
  '/issues/draft',
  pm,
  requireProjectPermission(PROJECT_PERMISSIONS.ISSUE.ISSUE.CREATE, { body: 'projectId' }),
  requireAiEnabled,
  rateLimit,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { projectId, text } = (req.body ?? {}) as { projectId?: string; text?: string };
    if (!text?.trim()) throw new ApiError(400, 'Describe the issue first');
    res.json({ success: true, data: await draftIssue(String(projectId), text) });
  })
);

router.post(
  '/sprints/:id/retro',
  pm,
  requireAiEnabled,
  rateLimit,
  asyncHandler(async (req: AuthedRequest, res) => {
    const sprint = await Sprint.findById(req.params.id).select('project').lean();
    if (!sprint) throw new ApiError(404, 'Sprint not found');
    const user = req.user!;
    const perms = user.permissions ?? [];
    if (!hasProjectFullAccess(perms)) {
      const projectPerms = await getProjectPermissionsForUser(String(sprint.project), user.id, perms, req.activeOrganizationId);
      if (!projectPerms.includes(PROJECT_PERMISSIONS.SPRINT.SPRINT.READ)) {
        throw new ApiError(403, 'Insufficient permissions for this project');
      }
    }
    res.json({ success: true, data: await sprintRetro(req.params.id) });
  })
);

router.post(
  '/tickets/:id/suggest-reply',
  requireModuleEnabled('service'),
  requirePermission(TASK_FLOW_PERMISSIONS.TASKFLOW.SERVICE.TICKET.UPDATE),
  requireAiEnabled,
  rateLimit,
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ success: true, data: await suggestTicketReply(req.params.id, req.activeOrganizationId) });
  })
);

export const aiRoutes = router;
