import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { getTicket } from './customerTicket.service';
import { recordCsat } from '../../service-desk/desk.service';
import { customerAuthMiddleware } from '../middleware/customerAuth.middleware';
import { customerRequirePermission } from '../middleware/customerRequirePermission';
import * as customerTicketController from './customerTicket.controller';

const router = Router();

router.get(
  '/',
  customerAuthMiddleware,
  customerRequirePermission('requests:view_own'),
  ...customerTicketController.listTickets
);

router.get(
  '/:ticketId',
  customerAuthMiddleware,
  customerRequirePermission('requests:view_own'),
  ...customerTicketController.getTicket
);

router.post(
  '/:ticketId/comments',
  customerAuthMiddleware,
  customerRequirePermission('requests:view_own'),
  ...customerTicketController.addComment
);

/** Customer rates a resolved ticket they can see. */
router.post(
  '/:ticketId/csat',
  customerAuthMiddleware,
  customerRequirePermission('requests:view_own'),
  asyncHandler(async (req: Request, res: Response) => {
    const cu = (req as Request & { customerUser?: { id: string; orgId: string; permissions: string[] } }).customerUser!;
    const ticket = (await getTicket(cu.orgId, req.params.ticketId, cu.id, cu.permissions)) as { status?: string } | null;
    if (!ticket) throw new ApiError(404, 'Ticket not found');
    if (ticket.status !== 'resolved' && ticket.status !== 'closed') throw new ApiError(400, 'You can rate a ticket once it is resolved');
    res.json({ success: true, data: await recordCsat(req.params.ticketId, Number(req.body?.score), req.body?.comment) });
  })
);

export const customerTicketRoutes = router;
