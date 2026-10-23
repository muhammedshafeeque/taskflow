/**
 * PA owner/system ingest APIs: customer-org picker and the ticket list behind
 * the Control Center. Client-chat lookups (KB, tickets, issues, billing,
 * requests) live in the scoped /api/internal/pa/client API.
 */
import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { CustomerOrg } from '../customer-portal/customer-org/customerOrg.model';
import { ServiceTicket } from './models/serviceTicket.model';
import { assertPaIngestSecret, resolvePaOrganizationId } from './paIngestAuth';

/** GET /service/ingest/customer-orgs */
export async function ingestListCustomerOrgs(req: Request, res: Response) {
  assertPaIngestSecret(req);
  const orgId = await resolvePaOrganizationId(req);
  const orgs = await CustomerOrg.find({
    taskflowOrganizationId: orgId,
    status: 'active',
  })
    .select('_id name slug status crmAccountId')
    .sort({ name: 1 })
    .limit(200)
    .lean();
  res.json({
    success: true,
    data: {
      orgs: orgs.map((o) => ({
        id: String(o._id),
        name: o.name,
        slug: o.slug,
        status: o.status,
        crmAccountId: o.crmAccountId ? String(o.crmAccountId) : undefined,
      })),
    },
  });
}

/**
 * GET /service/ingest/service-tickets
 * Extended filters: customerOrgId, whatsappGroupId, status, limit
 */
export async function ingestListServiceTicketsFiltered(
  req: Request,
  res: Response
) {
  assertPaIngestSecret(req);
  const orgId = await resolvePaOrganizationId(req);
  const status = req.query.status ? String(req.query.status) : undefined;
  const customerOrgId = req.query.customerOrgId
    ? String(req.query.customerOrgId)
    : undefined;
  const whatsappGroupId = req.query.whatsappGroupId
    ? String(req.query.whatsappGroupId)
    : undefined;
  const limit = Math.min(
    parseInt(String(req.query.limit || '8'), 10) || 8,
    20
  );

  const filter: Record<string, unknown> = {
    taskflowOrganizationId: orgId,
  };
  if (status) filter.status = status;
  else filter.status = { $in: ['open', 'pending', 'in_progress'] };
  if (customerOrgId && mongoose.Types.ObjectId.isValid(customerOrgId)) {
    filter.customerOrgId = customerOrgId;
  }
  if (whatsappGroupId) filter.whatsappGroupId = whatsappGroupId;

  const tickets = await ServiceTicket.find(filter)
    .populate('linkedIssueId', 'key title status')
    .populate('projectId', 'name key')
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  res.json({
    success: true,
    data: {
      tickets: tickets.map((t) => ({
        _id: String(t._id),
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        whatsappGroupId: t.whatsappGroupId,
        customerOrgId: t.customerOrgId ? String(t.customerOrgId) : undefined,
        linkedIssueKey:
          t.linkedIssueId &&
          typeof t.linkedIssueId === 'object' &&
          'key' in (t.linkedIssueId as object)
            ? String((t.linkedIssueId as { key?: string }).key || '')
            : undefined,
        updatedAt: t.updatedAt,
      })),
    },
  });
}
