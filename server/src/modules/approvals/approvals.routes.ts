import { Router, type Request, type Response } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAnyPermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import type { AuthPayload } from '../../types/express';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import { requireWorkspaceId } from '../crm/crmWorkspace';
import { listProcurementApprovers } from '../procurement/procurement.service';
import * as approvals from './approvals.service';
import { Role } from '../roles/role.model';

const AP = TASK_FLOW_PERMISSIONS.TASKFLOW.APPROVALS;
type R = Request & { user?: AuthPayload; activeOrganizationId?: string };

function actor(req: R): approvals.ApprovalActor {
  const id = req.user?.id;
  if (!id) throw new ApiError(401, 'Unauthorized');
  return { userId: id, permissions: req.user?.permissions ?? [] };
}
const ok = (res: Response, data: unknown) => res.json({ success: true, data });

/**
 * Approvals: one queue for every record type, each user's own requests, delegations, and
 * (for administrators) the approval chains. Deciding needs no permission: only being the
 * current step's approver, or their delegate. Records stay protected by their own module.
 */
const router = Router();
router.use(authMiddleware);

router.get('/queue', asyncHandler(async (req: R, res) => ok(res, await approvals.myQueue(req.activeOrganizationId, actor(req)))));
router.get('/requests', asyncHandler(async (req: R, res) => ok(res, await approvals.listRequests(req.activeOrganizationId, actor(req), req.query as Record<string, string>))));
router.get('/requests/:id', asyncHandler(async (req: R, res) => ok(res, await approvals.getRequest(req.activeOrganizationId, req.params.id, actor(req)))));
router.post(
  '/requests/:id/decision',
  asyncHandler(async (req: R, res) => {
    const d = req.body?.decision;
    if (d !== 'approve' && d !== 'reject') throw new ApiError(400, 'decision must be approve or reject');
    const orgId = requireWorkspaceId(req.activeOrganizationId);
    ok(res, await approvals.decide(orgId, req.params.id, actor(req), d, req.body?.note));
  })
);
router.get(
  '/record/:recordType/:recordId',
  asyncHandler(async (req: R, res) =>
    ok(res, await approvals.recordStatus(req.activeOrganizationId, approvals.assertRecordType(req.params.recordType), req.params.recordId, actor(req)))
  )
);
router.post('/requests/:id/cancel', asyncHandler(async (req: R, res) => ok(res, await approvals.cancelRequest(req.activeOrganizationId, req.params.id, actor(req), req.body?.note))));

router.get('/delegations', asyncHandler(async (req: R, res) => ok(res, await approvals.listDelegations(req.activeOrganizationId, actor(req), req.query.all === '1'))));
router.post('/delegations', asyncHandler(async (req: R, res) => ok(res, await approvals.createDelegation(req.activeOrganizationId, req.body ?? {}, actor(req)))));
router.delete('/delegations/:id', asyncHandler(async (req: R, res) => ok(res, await approvals.endDelegation(req.activeOrganizationId, req.params.id, actor(req)))));
/** People who can be picked as a delegate or approver (active workspace members). */
router.get('/people', asyncHandler(async (req: R, res) => ok(res, await listProcurementApprovers(req.activeOrganizationId))));

router.get(
  '/roles',
  requireAnyPermission([AP.POLICY.MANAGE]),
  asyncHandler(async (_req: R, res) => ok(res, (await Role.find().select('name').sort({ name: 1 }).lean()).map((r) => ({ _id: String(r._id), name: r.name }))))
);
router.get('/policies', requireAnyPermission([AP.POLICY.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await approvals.listPolicies(req.activeOrganizationId))));
router.put(
  '/policies/:recordType',
  requireAnyPermission([AP.POLICY.MANAGE]),
  asyncHandler(async (req: R, res) =>
    ok(res, await approvals.savePolicy(req.activeOrganizationId, approvals.assertRecordType(req.params.recordType), req.body ?? {}, actor(req)))
  )
);

export const approvalsRoutes = router;
