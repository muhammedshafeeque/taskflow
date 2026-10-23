import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError';
import { User } from '../../auth/user.model';
import { ServiceTicket } from '../../service-desk/models/serviceTicket.model';
import * as ticketsService from '../../service-desk/tickets.service';
import {
  assertPaIngestSecret,
  resolvePaOrganizationId,
} from '../../service-desk/paIngestAuth';
import { CustomerRequest } from './customerRequest.model';
import * as customerRequestService from './customerRequest.service';

async function resolvePaActorUserId(): Promise<string> {
  const fromEnv = String(process.env.PA_INGEST_ACTOR_USER_ID ?? '').trim();
  if (fromEnv && mongoose.Types.ObjectId.isValid(fromEnv)) {
    return fromEnv;
  }
  const admin = await User.findOne({
    enabled: true,
    userType: 'taskflow',
    role: 'admin',
  })
    .select('_id')
    .sort({ createdAt: 1 })
    .lean();
  if (admin?._id) return String(admin._id);

  const any = await User.findOne({ enabled: true, userType: 'taskflow' })
    .select('_id')
    .sort({ createdAt: 1 })
    .lean();
  if (any?._id) return String(any._id);

  throw new ApiError(
    503,
    'No TaskFlow user for PA ingest actor. Set PA_INGEST_ACTOR_USER_ID.'
  );
}

/** GET /service/ingest/requests?status=&page=&limit=&pendingOnly=1 */
export async function ingestListRequests(req: Request, res: Response) {
  assertPaIngestSecret(req);
  const orgId = await resolvePaOrganizationId(req);
  const page = parseInt(String(req.query.page ?? '1'), 10);
  const limit = parseInt(String(req.query.limit ?? '50'), 10);
  const status = req.query.status ? String(req.query.status) : undefined;
  const pendingOnly = String(req.query.pendingOnly || '') === '1';

  const data = pendingOnly
    ? await customerRequestService.listPendingTfApproval({ page, limit }, orgId)
    : await customerRequestService.listAllRequestsTf(
        { status, page, limit },
        orgId
      );

  res.json({ success: true, data });
}

/** GET /service/ingest/requests/:id */
export async function ingestGetRequest(req: Request, res: Response) {
  assertPaIngestSecret(req);
  const orgId = await resolvePaOrganizationId(req);
  const requestId = String(req.params.id || '');
  await customerRequestService.assertCustomerRequestInTaskflowWorkspace(
    requestId,
    orgId
  );
  const doc = await CustomerRequest.findById(requestId)
    .populate('createdBy', 'name email')
    .populate('customerOrgId', 'name slug')
    .populate('projectId', 'name key')
    .lean();
  if (!doc) throw new ApiError(404, 'Request not found');
  res.json({ success: true, data: { request: doc } });
}

/** POST /service/ingest/requests/:id/approve */
export async function ingestApproveRequest(req: Request, res: Response) {
  assertPaIngestSecret(req);
  const body = (req.body || {}) as Record<string, unknown>;
  const orgId = await resolvePaOrganizationId(req, body);
  const actorId = await resolvePaActorUserId();
  const workClassification = body.workClassification as
    | 'billable_change'
    | 'fix'
    | undefined;
  const note = body.note != null ? String(body.note) : undefined;

  const result = await customerRequestService.tfApprove(
    String(req.params.id),
    actorId,
    note,
    orgId,
    workClassification
  );
  res.json({ success: true, data: { request: result } });
}

/** POST /service/ingest/requests/:id/reject */
export async function ingestRejectRequest(req: Request, res: Response) {
  assertPaIngestSecret(req);
  const body = (req.body || {}) as Record<string, unknown>;
  const orgId = await resolvePaOrganizationId(req, body);
  const actorId = await resolvePaActorUserId();
  const note = body.note != null ? String(body.note) : undefined;
  const reason = body.reason != null ? String(body.reason) : undefined;

  const result = await customerRequestService.tfReject(
    String(req.params.id),
    actorId,
    note,
    reason,
    orgId
  );
  res.json({ success: true, data: { request: result } });
}

/** GET /service/ingest/service-tickets?status=&queue= */
export async function ingestListServiceTickets(req: Request, res: Response) {
  assertPaIngestSecret(req);
  const orgId = await resolvePaOrganizationId(req);
  const status = req.query.status ? String(req.query.status) : undefined;
  const queue = req.query.queue ? String(req.query.queue) : undefined;
  const tickets = await ticketsService.listTickets(orgId, { status, queue });
  res.json({ success: true, data: { tickets } });
}

/** PATCH /service/ingest/service-tickets/:id — status/priority and/or comment */
export async function ingestUpdateServiceTicket(req: Request, res: Response) {
  assertPaIngestSecret(req);
  const body = (req.body || {}) as Record<string, unknown>;
  const orgId = await resolvePaOrganizationId(req, body);
  const id = String(req.params.id || '');

  const patch: Record<string, unknown> = {};
  for (const key of ['status', 'priority', 'queue', 'subject', 'description'] as const) {
    if (body[key] != null) patch[key] = body[key];
  }

  let ticket: unknown = null;
  if (Object.keys(patch).length) {
    ticket = await ticketsService.updateTicket(id, orgId, patch);
  }

  const comment = String(body.comment || body.body || '').trim();
  if (comment) {
    const existing = await ServiceTicket.findOne({
      _id: id,
      taskflowOrganizationId: orgId,
    }).lean();
    if (!existing) throw new ApiError(404, 'Ticket not found');
    ticket = await ticketsService.addComment(
      id,
      orgId,
      { body: comment, internal: Boolean(body.internal) },
      { name: 'WhatsApp PA Control' }
    );
  }

  if (!ticket) {
    throw new ApiError(400, 'Provide status/priority fields and/or comment');
  }

  res.json({ success: true, data: { ticket } });
}
