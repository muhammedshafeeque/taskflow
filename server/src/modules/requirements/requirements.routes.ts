import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireProjectPermission } from '../../middleware/requireProjectPermission';
import { customerAuthMiddleware } from '../customer-portal/middleware/customerAuth.middleware';
import { customerRequirePermission } from '../customer-portal/middleware/customerRequirePermission';
import { CUSTOMER_PERMISSIONS, PROJECT_PERMISSIONS } from '../../shared/constants/permissions';
import * as svc from './requirements.service';

const P = PROJECT_PERMISSIONS.REQUIREMENT.REQUIREMENT;
const C = CUSTOMER_PERMISSIONS.REQUIREMENT.REQUIREMENT;
type R = Request & { user?: { id: string }; params: Record<string, string> };
const ok = (res: Response, data: unknown) => res.json({ success: true, data });
const READ = requireProjectPermission(P.READ);
const MANAGE = requireProjectPermission(P.MANAGE);
const note = (req: R) => (req.body as { note?: unknown } | undefined)?.note;

/** Requirements, mounted at /projects/:id/requirements (AUT-44). */
export const requirementsRouter = Router({ mergeParams: true });
const q = requirementsRouter;
q.get('/settings', READ, asyncHandler(async (req: R, res) => ok(res, await svc.getSettings(req.params.id))));
q.put('/settings', MANAGE, asyncHandler(async (req: R, res) => ok(res, await svc.updateSettings(req.params.id, req.body ?? {}))));
q.get('/', READ, asyncHandler(async (req: R, res) => ok(res, await svc.listRequirements(req.params.id, { status: req.query.status as string | undefined }))));
q.post('/', MANAGE, asyncHandler(async (req: R, res) => ok(res, await svc.createRequirement(req.params.id, req.body ?? {}, req.user!.id))));
q.get('/:reqId', READ, asyncHandler(async (req: R, res) => ok(res, await svc.getRequirement(req.params.id, req.params.reqId))));
q.patch('/:reqId', MANAGE, asyncHandler(async (req: R, res) => ok(res, await svc.updateRequirement(req.params.id, req.params.reqId, req.body ?? {}))));
q.post('/:reqId/versions', MANAGE, asyncHandler(async (req: R, res) => ok(res, await svc.newVersion(req.params.id, req.params.reqId, req.body ?? {}, req.user!.id))));
q.post('/:reqId/send', MANAGE, asyncHandler(async (req: R, res) => ok(res, await svc.sendForSignOff(req.params.id, req.params.reqId, req.user!.id))));

/** Change requests, mounted at /projects/:id/change-requests (AUT-44). */
export const changeRequestsRouter = Router({ mergeParams: true });
const c = changeRequestsRouter;
c.get('/', READ, asyncHandler(async (req: R, res) => ok(res, await svc.listChangeRequests(req.params.id, { status: req.query.status as string | undefined, requirementId: req.query.requirementId as string | undefined }))));
c.post('/', MANAGE, asyncHandler(async (req: R, res) => ok(res, await svc.createChangeRequest(req.params.id, req.body ?? {}, req.user!.id))));
c.get('/:crId', READ, asyncHandler(async (req: R, res) => ok(res, await svc.getChangeRequest(req.params.id, req.params.crId))));
c.patch('/:crId', MANAGE, asyncHandler(async (req: R, res) => ok(res, await svc.updateChangeRequest(req.params.id, req.params.crId, req.body ?? {}))));
c.post('/:crId/submit', MANAGE, asyncHandler(async (req: R, res) => ok(res, await svc.submitChangeRequest(req.params.id, req.params.crId, req.user!.id))));
// The BA lead and the PM decide by who they are; the service checks it is their turn.
c.post('/:crId/approve', asyncHandler(async (req: R, res) => ok(res, await svc.decideAsStaff(req.params.id, req.params.crId, 'approve', req.user!.id, note(req)))));
c.post('/:crId/reject', asyncHandler(async (req: R, res) => ok(res, await svc.decideAsStaff(req.params.id, req.params.crId, 'reject', req.user!.id, note(req)))));
c.post('/:crId/cancel', MANAGE, asyncHandler(async (req: R, res) => ok(res, await svc.cancelChangeRequest(req.params.id, req.params.crId, req.user!.id))));
c.post('/:crId/issues', MANAGE, asyncHandler(async (req: R, res) => ok(res, await svc.linkIssue(req.params.id, req.params.crId, req.body ?? {}, req.user!.id))));
c.delete('/:crId/issues/:issueId', MANAGE, asyncHandler(async (req: R, res) => ok(res, await svc.unlinkIssue(req.params.id, req.params.crId, req.params.issueId))));

/** Customer portal, mounted at /customer/requirements: sign off versions and approve changes. */
export const customerRequirementRoutes = Router();
customerRequirementRoutes.use(customerAuthMiddleware);
type CR = Request & { customerUser?: { id: string; orgId: string; name: string; email: string } };
const cu = (req: CR) => ({ id: req.customerUser!.id, orgId: req.customerUser!.orgId, name: req.customerUser!.name, email: req.customerUser!.email });
customerRequirementRoutes.get('/change-requests', customerRequirePermission(C.LIST), asyncHandler(async (req: CR, res) => ok(res, await svc.customerListChanges(cu(req)))));
customerRequirementRoutes.post('/change-requests/:id/decision', customerRequirePermission(C.APPROVE), asyncHandler(async (req: CR, res) => ok(res, await svc.customerDecideChange(cu(req), req.params.id, req.body ?? {}))));
customerRequirementRoutes.get('/', customerRequirePermission(C.LIST), asyncHandler(async (req: CR, res) => ok(res, await svc.customerListRequirements(cu(req)))));
customerRequirementRoutes.post('/:id/sign-off', customerRequirePermission(C.APPROVE), asyncHandler(async (req: CR, res) => ok(res, await svc.customerSignOff(cu(req), req.params.id, req.body ?? {}))));
