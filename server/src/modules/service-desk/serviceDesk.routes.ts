import type { Request, Response } from 'express';
import * as desk from './desk.service';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAnyPermission, requirePermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import * as sd from './serviceDesk.controller';
import * as ingest from './serviceIngest.controller';
import * as requestIngest from '../customer-portal/customer-request/customerRequestIngest.controller';
import * as ecoIngest from './paEcosystemIngest.controller';
import { getCsatReport } from './tickets.service';

const T = TASK_FLOW_PERMISSIONS.TASKFLOW.SERVICE;
const router = Router();

router.get('/kb/portal', asyncHandler(sd.listKbPortal));

/** WhatsApp PA bot — shared secret, before JWT auth. */
router.get('/ingest/project-context', asyncHandler(ingest.ingestProjectContext));
router.get('/ingest/tickets', asyncHandler(ingest.ingestListTickets));
router.post('/ingest/tickets', asyncHandler(ingest.ingestCreateTicket));
router.patch('/ingest/tickets/:id', asyncHandler(ingest.ingestPatchTicket));

router.get('/ingest/requests', asyncHandler(requestIngest.ingestListRequests));
router.post('/ingest/requests', asyncHandler(ecoIngest.ingestCreateRequest));
router.get('/ingest/requests/:id', asyncHandler(requestIngest.ingestGetRequest));
router.post(
  '/ingest/requests/:id/approve',
  asyncHandler(requestIngest.ingestApproveRequest)
);
router.post(
  '/ingest/requests/:id/reject',
  asyncHandler(requestIngest.ingestRejectRequest)
);
router.get(
  '/ingest/service-tickets',
  asyncHandler(ecoIngest.ingestListServiceTicketsFiltered)
);
router.patch(
  '/ingest/service-tickets/:id',
  asyncHandler(requestIngest.ingestUpdateServiceTicket)
);

router.get('/ingest/kb/search', asyncHandler(ecoIngest.ingestKbSearch));
router.get('/ingest/customer-orgs', asyncHandler(ecoIngest.ingestListCustomerOrgs));
router.get('/ingest/issues/by-key', asyncHandler(ecoIngest.ingestIssueByKey));
router.get('/ingest/billing/summary', asyncHandler(ecoIngest.ingestBillingSummary));
router.get('/ingest/hrms/me', asyncHandler(ecoIngest.ingestHrmsMe));
router.get('/ingest/assets/search', asyncHandler(ecoIngest.ingestAssetsSearch));
router.get('/ingest/procurement/pos', asyncHandler(ecoIngest.ingestProcurementPos));

router.use(authMiddleware);

router.get('/dashboard', requirePermission(T.TICKET.LIST), asyncHandler(sd.getDashboard));

type DR = Request & { activeOrganizationId?: string; user?: { id: string; name?: string; permissions?: string[] } };
const canShared = (req: DR) => userHasPermission(req.user?.permissions ?? [], T.SETTINGS.MANAGE);
router.get('/settings', requireAnyPermission([T.SETTINGS.MANAGE, T.SLA.MANAGE, T.TICKET.LIST]), asyncHandler(async (req: DR, res: Response) => {
  res.json({ success: true, data: await desk.getServiceSettings(req.activeOrganizationId) });
}));
router.put('/settings', requirePermission(T.SETTINGS.MANAGE), asyncHandler(async (req: DR, res: Response) => {
  res.json({ success: true, data: await desk.updateServiceSettings(req.activeOrganizationId, req.body ?? {}) });
}));
router.get('/saved-replies', requireAnyPermission([T.TICKET.UPDATE, T.SETTINGS.MANAGE]), asyncHandler(async (req: DR, res: Response) => {
  res.json({ success: true, data: await desk.listSavedReplies(req.activeOrganizationId, req.user!.id) });
}));
router.post('/saved-replies', requireAnyPermission([T.TICKET.UPDATE, T.SETTINGS.MANAGE]), asyncHandler(async (req: DR, res: Response) => {
  res.json({ success: true, data: await desk.saveSavedReply(req.activeOrganizationId, req.body ?? {}, { id: req.user!.id, canManageShared: canShared(req) }) });
}));
router.patch('/saved-replies/:id', requireAnyPermission([T.TICKET.UPDATE, T.SETTINGS.MANAGE]), asyncHandler(async (req: DR, res: Response) => {
  res.json({ success: true, data: await desk.saveSavedReply(req.activeOrganizationId, req.body ?? {}, { id: req.user!.id, canManageShared: canShared(req) }, req.params.id) });
}));
router.delete('/saved-replies/:id', requireAnyPermission([T.TICKET.UPDATE, T.SETTINGS.MANAGE]), asyncHandler(async (req: DR, res: Response) => {
  res.json({ success: true, data: await desk.deleteSavedReply(req.activeOrganizationId, req.params.id, { id: req.user!.id, canManageShared: canShared(req) }) });
}));
router.post('/tickets/:id/merge', requirePermission(T.TICKET.UPDATE), asyncHandler(async (req: DR, res: Response) => {
  res.json({ success: true, data: await desk.mergeTickets(req.activeOrganizationId, req.params.id, String(req.body?.intoId ?? ''), { id: req.user!.id, name: req.user?.name }) });
}));
router.get(
  '/reports/csat',
  requirePermission(T.TICKET.LIST),
  asyncHandler(async (req, res) => {
    const r = req as typeof req & { activeOrganizationId?: string };
    res.json({ success: true, data: await getCsatReport(r.activeOrganizationId, Number(req.query.days) || 90) });
  })
);
router.get('/tickets', requirePermission(T.TICKET.LIST), asyncHandler(sd.listTickets));
router.post('/tickets', requirePermission(T.TICKET.CREATE), asyncHandler(sd.createTicket));
router.get('/tickets/:id', requirePermission(T.TICKET.READ), asyncHandler(sd.getTicket));
router.patch('/tickets/:id', requirePermission(T.TICKET.UPDATE), asyncHandler(sd.updateTicket));
router.post('/tickets/:id/comments', requirePermission(T.TICKET.UPDATE), asyncHandler(sd.addComment));
router.post('/tickets/:id/csat', requirePermission(T.TICKET.UPDATE), asyncHandler(sd.submitCsat));
router.post('/tickets/from-request/:requestId', requirePermission(T.TICKET.CREATE), asyncHandler(sd.createFromRequest));

router.get('/sla', requirePermission(T.SLA.MANAGE), asyncHandler(sd.listSla));
router.post('/sla', requirePermission(T.SLA.MANAGE), asyncHandler(sd.createSla));
router.patch('/sla/:id', requirePermission(T.SLA.MANAGE), asyncHandler(sd.updateSla));

router.get('/kb', requirePermission(T.KB.LIST), asyncHandler(sd.listKb));
router.get('/kb/search', requirePermission(T.KB.READ), asyncHandler(sd.searchKb));
router.post('/kb', requirePermission(T.KB.CREATE), asyncHandler(sd.createKb));
router.patch('/kb/:id', requirePermission(T.KB.UPDATE), asyncHandler(sd.updateKb));

export const serviceDeskRoutes = router;
