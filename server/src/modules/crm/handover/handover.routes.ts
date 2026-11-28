import { Router, type Request, type Response } from 'express';
import { requirePermission, requireAnyPermission } from '../../../middleware/requirePermission';
import { asyncHandler } from '../../../utils/asyncHandler';
import { userHasPermission } from '../../../shared/constants/legacyPermissionMap';
import { TASK_FLOW_PERMISSIONS } from '../../../shared/constants/permissions';
import { assertDealInReach, crmReachFor } from '../crmScope';
import * as handover from './handover.service';

const P = TASK_FLOW_PERMISSIONS.TASKFLOW.CRM;
type R = Request & { activeOrganizationId?: string; user?: { id: string; permissions?: string[] } };
const ws = (req: R) => req.activeOrganizationId;
const ok = (res: Response, data: unknown) => res.json({ success: true, data });
const viewer = async (req: R) => ({
  userId: req.user!.id,
  canReadDeals: [P.DEAL.READ, P.DEAL.LIST].some((p) => userHasPermission(req.user?.permissions ?? [], p)),
  reach: await crmReachFor(req as never),
});
const inReach = async (req: R) => assertDealInReach(ws(req), await crmReachFor(req as never), req.params.id);

/**
 * Sales-to-delivery handover (AUT-41). Mounted on the CRM router after authentication.
 * Sales routes need deal permissions; the PM's routes only need to be the PM it was sent to.
 */
export const handoverRouter = Router();
const r = handoverRouter;

r.get('/handover-template', requireAnyPermission([P.DEAL.LIST, P.SETTINGS.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await handover.getHandoverTemplate(ws(req)))));
r.put('/handover-template', requirePermission(P.SETTINGS.MANAGE), asyncHandler(async (req: R, res) => ok(res, await handover.saveHandoverTemplate(ws(req), req.body ?? {}))));

r.get('/deals/:id/handover', requireAnyPermission([P.DEAL.READ, P.DEAL.LIST]), asyncHandler(async (req: R, res) => {
  await inReach(req);
  ok(res, await handover.getDealHandover(ws(req), req.params.id));
}));
r.patch('/deals/:id/handover', requirePermission(P.DEAL.UPDATE), asyncHandler(async (req: R, res) => {
  await inReach(req);
  ok(res, await handover.updateHandover(ws(req), req.params.id, req.body ?? {}, req.user!.id));
}));
r.post('/deals/:id/handover/submit', requirePermission(P.DEAL.UPDATE), asyncHandler(async (req: R, res) => {
  await inReach(req);
  ok(res, await handover.submitHandover(ws(req), req.params.id, req.user!.id));
}));

// The PM's side: any signed-in member; the service checks they are the PM.
r.get('/handovers', asyncHandler(async (req: R, res) => ok(res, await handover.listHandovers(ws(req), { mine: req.query.mine === '1', status: req.query.status as string | undefined }, await viewer(req)))));
r.get('/handovers/:id', asyncHandler(async (req: R, res) => ok(res, await handover.getHandover(ws(req), req.params.id, await viewer(req)))));
r.post('/handovers/:id/accept', asyncHandler(async (req: R, res) => ok(res, await handover.decideHandover(ws(req), req.params.id, 'accept', req.user!.id, (req.body as { note?: unknown } | undefined)?.note))));
r.post('/handovers/:id/return', asyncHandler(async (req: R, res) => ok(res, await handover.decideHandover(ws(req), req.params.id, 'return', req.user!.id, (req.body as { note?: unknown } | undefined)?.note))));
