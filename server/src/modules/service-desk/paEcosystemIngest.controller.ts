/**
 * Extended PA ingest APIs: KB, portal request create, digests, issues,
 * billing, HRMS, assets, procurement, customer-orgs.
 */
import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { CustomerOrg } from '../customer-portal/customer-org/customerOrg.model';
import { CustomerUser } from '../customer-portal/customer-user/customerUser.model';
import * as customerRequestService from '../customer-portal/customer-request/customerRequest.service';
import { ServiceTicket } from './models/serviceTicket.model';
import * as kbService from './kb.service';
import * as issuesService from '../issues/issues.service';
import { BillingInvoice } from '../billing/models/billingInvoice.model';
import { HrmsEmployee } from '../hrms/models/hrmsEmployee.model';
import { HrmsLeaveRequest } from '../hrms/models/hrmsLeaveRequest.model';
import { HrmsAttendance } from '../hrms/models/hrmsAttendance.model';
import * as assetsService from '../assets/assets.service';
import * as procurementService from '../procurement/procurement.service';

function assertPaIngestSecret(req: Request) {
  const configured = String(process.env.PA_INGEST_SECRET ?? '').trim();
  if (!configured) {
    throw new ApiError(503, 'PA ingest is not configured (PA_INGEST_SECRET)');
  }
  const provided = String(req.headers['x-pa-ingest-secret'] ?? '').trim();
  if (!provided || provided !== configured) {
    throw new ApiError(401, 'Invalid ingest secret');
  }
}

function resolvePaOrganizationId(req: Request, body?: Record<string, unknown>) {
  const organizationId = String(
    body?.organizationId ??
      req.headers['x-organization-id'] ??
      process.env.PA_DEFAULT_ORG_ID ??
      ''
  ).trim();
  if (!organizationId) {
    throw new ApiError(400, 'organizationId is required');
  }
  if (!mongoose.Types.ObjectId.isValid(organizationId)) {
    throw new ApiError(400, 'Invalid organizationId');
  }
  return organizationId;
}

export function normalizePhoneDigits(raw: string): string {
  return String(raw || '')
    .replace(/\D/g, '')
    .replace(/^0+/, '');
}

/** GET /service/ingest/kb/search?q= */
export async function ingestKbSearch(req: Request, res: Response) {
  assertPaIngestSecret(req);
  const orgId = resolvePaOrganizationId(req);
  const q = String(req.query.q || '').trim();
  const articles = await kbService.searchKbArticles(orgId, q);
  const data = (articles || []).slice(0, 5).map((a) => ({
    id: String((a as { _id?: unknown })._id || ''),
    title: String((a as { title?: string }).title || ''),
    slug: String((a as { slug?: string }).slug || ''),
    category: String((a as { category?: string }).category || ''),
    body: String((a as { body?: string }).body || '').slice(0, 600),
  }));
  res.json({ success: true, data: { articles: data } });
}

/** GET /service/ingest/customer-orgs */
export async function ingestListCustomerOrgs(req: Request, res: Response) {
  assertPaIngestSecret(req);
  const orgId = resolvePaOrganizationId(req);
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

/** POST /service/ingest/requests — create portal request for mapped customer org */
export async function ingestCreateRequest(req: Request, res: Response) {
  assertPaIngestSecret(req);
  const body = (req.body || {}) as Record<string, unknown>;
  const workspaceId = resolvePaOrganizationId(req, body);
  const customerOrgId = String(body.customerOrgId || '').trim();
  const projectId = String(body.projectId || '').trim();
  const title = String(body.title || '').trim();
  if (!customerOrgId || !mongoose.Types.ObjectId.isValid(customerOrgId)) {
    throw new ApiError(400, 'customerOrgId is required');
  }
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, 'projectId is required');
  }
  if (!title) throw new ApiError(400, 'title is required');

  const org = await CustomerOrg.findOne({
    _id: customerOrgId,
    taskflowOrganizationId: workspaceId,
  }).lean();
  if (!org) throw new ApiError(404, 'Customer org not found in this workspace');

  let requester = await CustomerUser.findOne({
    customerOrgId,
    isOrgAdmin: true,
    status: { $ne: 'inactive' },
  })
    .select('_id')
    .lean();
  if (!requester) {
    requester = await CustomerUser.findOne({
      customerOrgId,
      status: { $ne: 'inactive' },
    })
      .select('_id')
      .lean();
  }
  if (!requester?._id) {
    throw new ApiError(
      400,
      'Customer org has no portal users — create an org admin first'
    );
  }

  const type = String(body.type || 'other') as
    | 'bug'
    | 'feature'
    | 'suggestion'
    | 'concern'
    | 'other';
  const priority = String(body.priority || 'medium') as
    | 'low'
    | 'medium'
    | 'high'
    | 'critical';

  const description = [
    String(body.description || '').trim(),
    body.whatsappGroupId
      ? `\n\n[WhatsApp group: ${String(body.whatsappGroupId)}]`
      : '',
    body.senderPhone ? `\n[Sender: ${String(body.senderPhone)}]` : '',
  ]
    .join('')
    .trim();

  const request = await customerRequestService.createRequest(
    customerOrgId,
    String(requester._id),
    {
      projectId,
      title,
      description,
      type: ['bug', 'feature', 'suggestion', 'concern', 'other'].includes(type)
        ? type
        : 'other',
      priority: ['low', 'medium', 'high', 'critical'].includes(priority)
        ? priority
        : 'medium',
      attachments: [],
    },
    true
  );

  res.status(201).json({ success: true, data: { request } });
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
  const orgId = resolvePaOrganizationId(req);
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

/** GET /service/ingest/issues/by-key?key=&projectId= */
export async function ingestIssueByKey(req: Request, res: Response) {
  assertPaIngestSecret(req);
  resolvePaOrganizationId(req);
  const key = String(req.query.key || '').trim().toUpperCase();
  const projectId = String(req.query.projectId || '').trim();
  if (!key) throw new ApiError(400, 'key is required');
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, 'projectId is required');
  }
  const issue = (await issuesService.findByProjectAndKey(
    projectId,
    key
  )) as Record<string, unknown> | null;
  if (!issue) throw new ApiError(404, 'Issue not found');
  const sprint = issue.sprint as { name?: string; status?: string } | undefined;
  res.json({
    success: true,
    data: {
      issue: {
        id: String(issue._id || issue.id || ''),
        key: issue.key,
        title: issue.title,
        status: issue.status,
        type: issue.type,
        priority: issue.priority,
        assignee:
          issue.assignee && typeof issue.assignee === 'object'
            ? (issue.assignee as { name?: string }).name
            : undefined,
        sprintName: sprint?.name,
        sprintStatus: sprint?.status,
      },
    },
  });
}

/** GET /service/ingest/billing/summary?accountId= or ?customerOrgId= */
export async function ingestBillingSummary(req: Request, res: Response) {
  assertPaIngestSecret(req);
  const orgId = resolvePaOrganizationId(req);
  let accountId = String(req.query.accountId || '').trim();
  const customerOrgId = String(req.query.customerOrgId || '').trim();
  if (!accountId && customerOrgId) {
    const co = await CustomerOrg.findOne({
      _id: customerOrgId,
      taskflowOrganizationId: orgId,
    })
      .select('crmAccountId name')
      .lean();
    if (!co?.crmAccountId) {
      throw new ApiError(404, 'Customer org has no linked CRM account');
    }
    accountId = String(co.crmAccountId);
  }
  if (!accountId || !mongoose.Types.ObjectId.isValid(accountId)) {
    throw new ApiError(400, 'accountId or customerOrgId is required');
  }

  const invoices = await BillingInvoice.find({
    taskflowOrganizationId: orgId,
    accountId,
    status: { $in: ['sent', 'overdue', 'paid'] },
  })
    .sort({ issueDate: -1 })
    .limit(20)
    .lean();

  const open = invoices.filter((i) => i.status === 'sent' || i.status === 'overdue');
  const outstanding = open.reduce(
    (s, i) => s + Math.max(0, (i.total ?? 0) - (i.amountPaid ?? 0)),
    0
  );

  res.json({
    success: true,
    data: {
      accountId,
      outstanding: Math.round(outstanding * 100) / 100,
      openCount: open.length,
      recent: invoices.slice(0, 5).map((i) => ({
        id: String(i._id),
        number: i.number,
        status: i.status,
        total: i.total,
        amountPaid: i.amountPaid,
        dueDate: i.dueDate,
      })),
    },
  });
}

/** GET /service/ingest/hrms/me?phone=&email= */
export async function ingestHrmsMe(req: Request, res: Response) {
  assertPaIngestSecret(req);
  const orgId = resolvePaOrganizationId(req);
  const phone = normalizePhoneDigits(String(req.query.phone || ''));
  const email = String(req.query.email || '')
    .trim()
    .toLowerCase();

  const employees = await HrmsEmployee.find({
    taskflowOrganizationId: orgId,
    status: { $ne: 'terminated' },
  })
    .select(
      '_id name email phone whatsappPhone employeeCode leaveBalanceDays department designation status'
    )
    .lean();

  let match =
    phone
      ? employees.find((e) => {
          const candidates = [
            normalizePhoneDigits(String(e.phone || '')),
            normalizePhoneDigits(String((e as { whatsappPhone?: string }).whatsappPhone || '')),
          ].filter(Boolean);
          return candidates.some(
            (c) => c === phone || c.endsWith(phone) || phone.endsWith(c)
          );
        })
      : undefined;

  if (!match && email) {
    match = employees.find(
      (e) => String(e.email || '').toLowerCase() === email
    );
  }

  if (!match) {
    res.json({
      success: true,
      data: { linked: false, reason: 'Employee not linked to this phone/email' },
    });
    return;
  }

  const empId = match._id;
  const [leaves, attendance] = await Promise.all([
    HrmsLeaveRequest.find({ employeeId: empId })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
    HrmsAttendance.find({ employeeId: empId })
      .sort({ date: -1 })
      .limit(7)
      .lean(),
  ]);

  res.json({
    success: true,
    data: {
      linked: true,
      employee: {
        id: String(empId),
        name: match.name,
        employeeCode: match.employeeCode,
        department: match.department,
        designation: match.designation,
        leaveBalanceDays: match.leaveBalanceDays,
        status: match.status,
      },
      recentLeaves: leaves.map((l) => ({
        status: l.status,
        days: l.days,
        from: l.startDate,
        to: l.endDate,
        type: l.type,
      })),
      recentAttendance: attendance.map((a) => ({
        date: a.date,
        status: a.status,
        hoursWorked: a.hoursWorked,
      })),
    },
  });
}

/** GET /service/ingest/assets/search?q= */
export async function ingestAssetsSearch(req: Request, res: Response) {
  assertPaIngestSecret(req);
  const orgId = resolvePaOrganizationId(req);
  const q = String(req.query.q || '').trim();
  const assets = await assetsService.listAssets(orgId, { search: q || undefined });
  res.json({
    success: true,
    data: {
      assets: (assets || []).slice(0, 8).map((a) => ({
        id: String((a as { _id?: unknown })._id || ''),
        name: (a as { name?: string }).name,
        status: (a as { status?: string }).status,
        category: (a as { category?: string }).category,
        assetTag: (a as { assetTag?: string }).assetTag,
        serialNumber: (a as { serialNumber?: string }).serialNumber,
        assignedUser:
          (a as { assignedUserId?: { name?: string } }).assignedUserId &&
          typeof (a as { assignedUserId?: unknown }).assignedUserId === 'object'
            ? (a as { assignedUserId: { name?: string } }).assignedUserId.name
            : undefined,
      })),
    },
  });
}

/** GET /service/ingest/procurement/pos?status=&q= */
export async function ingestProcurementPos(req: Request, res: Response) {
  assertPaIngestSecret(req);
  const orgId = resolvePaOrganizationId(req);
  const status = req.query.status ? String(req.query.status) : undefined;
  const q = String(req.query.q || '').trim().toLowerCase();
  let pos = await procurementService.listPurchaseOrders(orgId, { status });
  if (q) {
    pos = (pos || []).filter((p) => {
      const title = String((p as { title?: string }).title || '').toLowerCase();
      const number = String((p as { poNumber?: string }).poNumber || '').toLowerCase();
      return title.includes(q) || number.includes(q);
    });
  }
  res.json({
    success: true,
    data: {
      purchaseOrders: (pos || []).slice(0, 8).map((p) => ({
        id: String((p as { _id?: unknown })._id || ''),
        poNumber: (p as { poNumber?: string }).poNumber,
        title: (p as { title?: string }).title,
        status: (p as { status?: string }).status,
        total: (p as { total?: number }).total,
        currency: (p as { currency?: string }).currency,
      })),
    },
  });
}

