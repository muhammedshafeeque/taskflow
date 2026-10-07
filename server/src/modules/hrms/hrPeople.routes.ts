import { Router, type Request, type Response } from 'express';
import { requireAnyPermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import * as policy from './policy.service';
import * as people from './people.service';

const H = TASK_FLOW_PERMISSIONS.TASKFLOW.HR;
const S = TASK_FLOW_PERMISSIONS.TASKFLOW.SELF;

type R = Request & { activeOrganizationId?: string; user?: { id: string; permissions?: string[] } };
const ws = (req: R) => req.activeOrganizationId;
const can = (req: R, ...perms: string[]) => perms.some((p) => userHasPermission(req.user?.permissions ?? [], p));
const ok = (res: Response, data: unknown) => res.json({ success: true, data });

/**
 * HR configuration and people processes. Every endpoint is gated by a
 * permission so companies decide (via their own roles) who does what.
 */
export const hrPeopleRouter = Router();
const r = hrPeopleRouter;

// Settings, leave types, holidays
r.get('/settings', requireAnyPermission([H.POLICY.MANAGE, H.LEAVE.MANAGE, H.RECRUITMENT.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await policy.getHrSettings(ws(req)))));
r.put('/settings', requireAnyPermission([H.POLICY.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await policy.updateHrSettings(ws(req), req.body ?? {}))));

const leaveTypeReaders = [H.POLICY.MANAGE, H.LEAVE.READ, H.LEAVE.MANAGE, S.LEAVE.APPLY];
r.get('/leave-types', requireAnyPermission(leaveTypeReaders), asyncHandler(async (req: R, res) => ok(res, await policy.listLeaveTypes(ws(req), req.query.active === '1'))));
r.post('/leave-types', requireAnyPermission([H.POLICY.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await policy.upsertLeaveType(ws(req), req.body ?? {}))));
r.patch('/leave-types/:id', requireAnyPermission([H.POLICY.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await policy.upsertLeaveType(ws(req), req.body ?? {}, req.params.id))));

r.get('/holidays', requireAnyPermission([...leaveTypeReaders, S.PROFILE.READ]), asyncHandler(async (req: R, res) => ok(res, await policy.listHolidays(ws(req), req.query.year ? Number(req.query.year) : undefined))));
r.post('/holidays', requireAnyPermission([H.POLICY.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await policy.createHoliday(ws(req), req.body ?? {}))));
r.delete('/holidays/:id', requireAnyPermission([H.POLICY.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await policy.deleteHoliday(ws(req), req.params.id))));

r.get('/employees/:id/balances', requireAnyPermission([H.LEAVE.READ, H.LEAVE.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await policy.getBalances(ws(req), req.params.id))));
r.post(
  '/employees/:id/balances/adjust',
  requireAnyPermission([H.LEAVE.MANAGE]),
  asyncHandler(async (req: R, res) => ok(res, await policy.adjustBalance(ws(req), req.params.id, String(req.body?.leaveTypeId ?? ''), Number(req.body?.delta))))
);
r.post(
  '/leave/carry-forward',
  requireAnyPermission([H.POLICY.MANAGE]),
  asyncHandler(async (req: R, res) => ok(res, await policy.carryForward(ws(req), Number(req.body?.fromYear) || new Date().getFullYear() - 1)))
);

// Onboarding / offboarding
r.get('/checklist-templates', requireAnyPermission([H.ONBOARDING.READ, H.ONBOARDING.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await people.listTemplates(ws(req), req.query.kind as string | undefined))));
r.post('/checklist-templates', requireAnyPermission([H.ONBOARDING.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await people.saveTemplate(ws(req), req.body ?? {}))));
r.patch('/checklist-templates/:id', requireAnyPermission([H.ONBOARDING.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await people.saveTemplate(ws(req), req.body ?? {}, req.params.id))));
r.post('/checklists', requireAnyPermission([H.ONBOARDING.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await people.startChecklist(ws(req), req.body ?? {}, req.user!.id))));
// Anyone can list checklists with their own tasks (?mine=1); HR sees all.
r.get(
  '/checklists',
  asyncHandler(async (req: R, res) => {
    const manage = can(req, H.ONBOARDING.READ, H.ONBOARDING.MANAGE);
    const query = { ...(req.query as Record<string, string>), ...(manage ? {} : { mine: '1' }) };
    ok(res, await people.listChecklists(ws(req), query, req.user!.id));
  })
);
r.patch(
  '/checklists/:id/tasks/:taskId',
  asyncHandler(async (req: R, res) =>
    ok(res, await people.setTaskDone(ws(req), req.params.id, req.params.taskId, Boolean(req.body?.done), { id: req.user!.id, canManage: can(req, H.ONBOARDING.MANAGE) }))
  )
);

// Recruitment
const recRead = [H.RECRUITMENT.READ, H.RECRUITMENT.MANAGE];
r.get('/jobs', requireAnyPermission(recRead), asyncHandler(async (req: R, res) => ok(res, await people.listJobs(ws(req), req.query.status as string | undefined))));
r.post('/jobs', requireAnyPermission([H.RECRUITMENT.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await people.saveJob(ws(req), req.body ?? {}))));
r.patch('/jobs/:id', requireAnyPermission([H.RECRUITMENT.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await people.saveJob(ws(req), req.body ?? {}, req.params.id))));
r.get('/jobs/:id/candidates', requireAnyPermission(recRead), asyncHandler(async (req: R, res) => ok(res, await people.listCandidates(ws(req), req.params.id))));
r.post('/candidates', requireAnyPermission([H.RECRUITMENT.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await people.saveCandidate(ws(req), req.body ?? {}))));
r.patch('/candidates/:id', requireAnyPermission([H.RECRUITMENT.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await people.saveCandidate(ws(req), req.body ?? {}, req.params.id))));
r.post('/candidates/:id/interviews', requireAnyPermission([H.RECRUITMENT.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await people.addInterview(ws(req), req.params.id, req.body ?? {}, req.user!.id))));
r.post(
  '/candidates/:id/hire',
  requireAnyPermission([H.RECRUITMENT.MANAGE]),
  asyncHandler(async (req: R, res) => ok(res, await people.hireCandidate(ws(req), req.params.id, req.body ?? {}, req.user!.id)))
);

// Appraisals
r.get('/review-cycles', asyncHandler(async (req: R, res) => ok(res, await people.listCycles(ws(req)))));
r.post('/review-cycles', requireAnyPermission([H.APPRAISAL.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await people.saveCycle(ws(req), req.body ?? {}))));
r.patch('/review-cycles/:id', requireAnyPermission([H.APPRAISAL.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await people.saveCycle(ws(req), req.body ?? {}, req.params.id))));
r.post('/review-cycles/:id/launch', requireAnyPermission([H.APPRAISAL.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await people.launchCycle(ws(req), req.params.id, req.user!.id))));
r.get(
  '/reviews',
  asyncHandler(async (req: R, res) =>
    ok(res, await people.listReviews(ws(req), req.query as Record<string, string>, req.user!.id, can(req, H.APPRAISAL.READ, H.APPRAISAL.MANAGE)))
  )
);
r.patch(
  '/reviews/:id',
  asyncHandler(async (req: R, res) =>
    ok(res, await people.submitReview(ws(req), req.params.id, req.body ?? {}, req.user!.id, can(req, H.APPRAISAL.MANAGE)))
  )
);
