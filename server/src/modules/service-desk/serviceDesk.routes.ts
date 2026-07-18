import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import * as sd from './serviceDesk.controller';

const T = TASK_FLOW_PERMISSIONS.TASKFLOW.SERVICE;
const router = Router();

router.get('/kb/portal', asyncHandler(sd.listKbPortal));

router.use(authMiddleware);

router.get('/dashboard', requirePermission(T.TICKET.LIST), asyncHandler(sd.getDashboard));
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
