/**
 * Client-scoped PA API (/api/internal/pa/client/*). Every handler filters by
 * the client internal auth resolved for this chat (req.paContext.scope) —
 * request bodies and query strings can never widen it. Internal notes, other
 * clients, HRMS, assets and procurement are not reachable from here.
 */
import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { Project } from '../projects/project.model';
import { Issue } from '../issues/issue.model';
import { ServiceTicket } from '../service-desk/models/serviceTicket.model';
import * as ticketsService from '../service-desk/tickets.service';
import * as kbService from '../service-desk/kb.service';
import { createPaTicket, findPaTicket, toPaTicketSummary } from '../service-desk/paTickets.service';
import { CustomerOrg } from '../customer-portal/customer-org/customerOrg.model';
import { CustomerUser } from '../customer-portal/customer-user/customerUser.model';
import * as customerRequestService from '../customer-portal/customer-request/customerRequest.service';
import { BillingInvoice } from '../billing/models/billingInvoice.model';
import { saveUpload, sendStoredFile } from '../uploads/files.service';
import type { ClientScope } from './paScope';
import { PaFile } from './paFile.model';
import * as paDocs from './paClientDocs.service';

const OPEN_STATUSES = ['open', 'pending', 'in_progress'];

function clientContext(req: Request): { organizationId: string; serviceAccountId: string; scope: ClientScope } {
  const ctx = req.paContext;
  if (!ctx || ctx.actor !== 'client' || !ctx.scope) throw new ApiError(403, 'Client context required');
  return { organizationId: ctx.organizationId, serviceAccountId: ctx.serviceAccountId, scope: ctx.scope };
}

/** Unknown numbers and unbound groups get nothing beyond published KB. */
function requireLinked(scope: ClientScope): void {
  if (!scope.customerOrgId && !scope.projectIds.length) {
    throw new ApiError(403, 'This chat is not linked to a client in Atrium');
  }
}

function requireCustomerOrg(scope: ClientScope): string {
  if (!scope.customerOrgId) throw new ApiError(403, 'This chat is not linked to a client company in Atrium');
  return scope.customerOrgId;
}

function requireProjectInScope(scope: ClientScope, projectId: unknown): string {
  const id = String(projectId ?? '').trim();
  if (!id || !scope.projectIds.includes(id)) throw new ApiError(403, 'Project is not available to this chat');
  return id;
}

/** Tickets this chat may see: the client's own, or ones raised from this very chat. */
export function clientTicketFilter(scope: ClientScope): Record<string, unknown> {
  const fromThisChat = {
    whatsappGroupId: scope.chatId,
    $or: [{ customerOrgId: null }, { customerOrgId: { $exists: false } }, ...(scope.customerOrgId ? [{ customerOrgId: scope.customerOrgId }] : [])],
  };
  return { $or: [...(scope.customerOrgId ? [{ customerOrgId: new mongoose.Types.ObjectId(scope.customerOrgId) }] : []), fromThisChat] };
}

/** GET /client/context — who this chat is, their projects, open tickets, recent issues. */
export async function getContext(req: Request, res: Response) {
  const { organizationId, scope } = clientContext(req);
  const linked = Boolean(scope.customerOrgId || scope.projectIds.length);
  const [projects, tickets, recentIssues] = linked
    ? await Promise.all([
        Project.find({ _id: { $in: scope.projectIds }, taskflowOrganizationId: organizationId })
          .select('_id name key description')
          .lean(),
        ServiceTicket.find({ taskflowOrganizationId: organizationId, status: { $in: OPEN_STATUSES }, ...clientTicketFilter(scope) })
          .select('_id subject description status priority projectId queue linkedIssueId updatedAt')
          .populate('linkedIssueId', 'key title')
          .sort({ updatedAt: -1 })
          .limit(40)
          .lean(),
        Issue.find({ project: { $in: scope.projectIds } })
          .select('_id key title status')
          .sort({ updatedAt: -1 })
          .limit(30)
          .lean(),
      ])
    : [[], [], []];

  res.json({
    success: true,
    data: {
      client: { customerOrgId: scope.customerOrgId, name: scope.customerOrgName, source: scope.source, linked },
      projects: projects.map((p) => ({ id: String(p._id), name: p.name, key: p.key, description: p.description })),
      tickets: tickets.map((t) => toPaTicketSummary(t as unknown as Record<string, unknown>)),
      recentIssues: recentIssues.map((i) => ({ id: String(i._id), key: i.key, title: i.title, status: i.status })),
    },
  });
}

/** GET /client/tickets?status=open|all&limit= */
export async function listTickets(req: Request, res: Response) {
  const { organizationId, scope } = clientContext(req);
  requireLinked(scope);
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '8'), 10) || 8, 1), 20);
  const status = String(req.query.status || 'open');
  const tickets = await ServiceTicket.find({
    taskflowOrganizationId: organizationId,
    ...(status === 'all' ? {} : { status: { $in: OPEN_STATUSES } }),
    ...clientTicketFilter(scope),
  })
    .populate('linkedIssueId', 'key title status')
    .populate('projectId', 'name key')
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();
  res.json({ success: true, data: { tickets: tickets.map((t) => toPaTicketSummary(t as unknown as Record<string, unknown>)) } });
}

/** POST /client/tickets — incident intake from the chat. */
export async function createTicket(req: Request, res: Response) {
  const { organizationId, serviceAccountId, scope } = clientContext(req);
  requireLinked(scope);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const projectId = requireProjectInScope(scope, body.projectId);
  const data = await createPaTicket(organizationId, serviceAccountId, {
    projectId,
    subject: String(body.subject ?? ''),
    description: body.description ? String(body.description) : undefined,
    priority: ['low', 'medium', 'high', 'urgent'].includes(String(body.priority)) ? String(body.priority) : 'medium',
    issueType: body.issueType ? String(body.issueType) : undefined,
    workClassification: body.workClassification === 'billable_change' ? 'billable_change' : body.workClassification === 'fix' ? 'fix' : undefined,
    customerOrgId: scope.customerOrgId,
    // Always the real chat — never a chat id from the body.
    whatsappGroupId: scope.chatId,
    whatsappMessageId: body.whatsappMessageId ? String(body.whatsappMessageId) : undefined,
    supportConversationId: body.supportConversationId ? String(body.supportConversationId) : undefined,
    aiAnalysis: body.aiAnalysis,
    qaAnalysis: body.qaAnalysis,
    createIssue: body.createIssue !== false,
  });
  res.status(201).json({ success: true, data });
}

/** POST /client/tickets/:ref/comments — PA's follow-up note for staff (internal; never read back to clients). */
export async function commentOnTicket(req: Request, res: Response) {
  const { organizationId, scope } = clientContext(req);
  requireLinked(scope);
  const ticket = await findPaTicket(organizationId, decodeURIComponent(req.params.ref), clientTicketFilter(scope));
  if (!ticket) throw new ApiError(404, 'Ticket not found');
  const body = String((req.body as { body?: unknown })?.body ?? '').trim();
  if (!body) throw new ApiError(400, 'body is required');
  await ticketsService.addComment(String(ticket._id), organizationId, { body, internal: true }, { name: 'WhatsApp PA' });
  const messageId = (req.body as { whatsappMessageId?: unknown })?.whatsappMessageId;
  if (messageId) {
    await ServiceTicket.updateOne({ _id: ticket._id }, { $set: { whatsappMessageId: String(messageId) } });
  }
  const linked = ticket.linkedIssueId as { key?: string } | null | undefined;
  res.json({ success: true, data: { id: String(ticket._id), key: linked?.key || String(ticket._id), issueKey: linked?.key } });
}

/** GET /client/issues/by-key?key=ABC-12 — only issues in the client's projects. */
export async function issueByKey(req: Request, res: Response) {
  const { scope } = clientContext(req);
  requireLinked(scope);
  const key = String(req.query.key || '').trim().toUpperCase();
  if (!key) throw new ApiError(400, 'key is required');
  const issue = await Issue.findOne({ key, project: { $in: scope.projectIds } })
    .select('_id key title status type priority assignee sprint project')
    .populate('assignee', 'name')
    .populate('sprint', 'name status')
    .lean();
  if (!issue) throw new ApiError(404, 'Issue not found');
  const assignee = issue.assignee as { name?: string } | null | undefined;
  const sprint = issue.sprint as { name?: string; status?: string } | null | undefined;
  res.json({
    success: true,
    data: {
      issue: {
        id: String(issue._id),
        key: issue.key,
        title: issue.title,
        status: issue.status,
        type: issue.type,
        priority: issue.priority,
        assignee: assignee?.name,
        sprintName: sprint?.name,
        sprintStatus: sprint?.status,
      },
    },
  });
}

/** GET /client/kb/search?q= — published articles only. */
export async function searchKb(req: Request, res: Response) {
  const { organizationId } = clientContext(req);
  const articles = await kbService.searchKbArticles(organizationId, String(req.query.q || ''));
  res.json({
    success: true,
    data: {
      articles: (articles || []).slice(0, 5).map((a) => ({
        id: String(a._id),
        title: String(a.title || ''),
        slug: String((a as { slug?: string }).slug || ''),
        category: String((a as { category?: string }).category || ''),
        body: String(a.body || '').slice(0, 600),
      })),
    },
  });
}

/**
 * GET /client/docs?q=&projectId=&issueId=&issueKey=&ticketId=&limit=&body=1
 * Published Docs pages linked to this chat's projects / issues / tickets.
 * q is matched by keyword; body=1 adds page text so PA can answer from it.
 */
export async function searchDocs(req: Request, res: Response) {
  const { organizationId, scope } = clientContext(req);
  requireLinked(scope);
  const data = await paDocs.searchClientDocs(organizationId, scope, {
    q: req.query.q ? String(req.query.q) : undefined,
    projectId: req.query.projectId ? String(req.query.projectId) : undefined,
    issueId: req.query.issueId ? String(req.query.issueId) : undefined,
    issueKey: req.query.issueKey ? String(req.query.issueKey) : undefined,
    ticketId: req.query.ticketId ? String(req.query.ticketId) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    withBody: req.query.body === '1',
  });
  res.json({ success: true, data });
}

/** GET /client/docs/:id — full published page text if in this chat's scope. */
export async function getDoc(req: Request, res: Response) {
  const { organizationId, scope } = clientContext(req);
  requireLinked(scope);
  const data = await paDocs.getClientDoc(organizationId, scope, req.params.id);
  res.json({ success: true, data });
}

/** POST /client/requests — portal service request for the client company. */
export async function createRequest(req: Request, res: Response) {
  const { scope } = clientContext(req);
  const customerOrgId = requireCustomerOrg(scope);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const projectId = requireProjectInScope(scope, body.projectId);
  const title = String(body.title ?? '').trim();
  if (!title) throw new ApiError(400, 'title is required');

  const requester =
    (await CustomerUser.findOne({ customerOrgId, isOrgAdmin: true, status: { $ne: 'inactive' } }).select('_id').lean()) ??
    (await CustomerUser.findOne({ customerOrgId, status: { $ne: 'inactive' } }).select('_id').lean());
  if (!requester?._id) throw new ApiError(400, 'Customer org has no portal users — create an org admin first');

  const type = String(body.type || 'other');
  const priority = String(body.priority || 'medium');
  const description = [
    String(body.description || '').trim(),
    `\n\n[WhatsApp chat: ${scope.chatId}]`,
    req.paContext?.senderPhone ? `\n[Sender: ${req.paContext.senderPhone}]` : '',
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
      type: (['bug', 'feature', 'suggestion', 'concern', 'other'].includes(type) ? type : 'other') as 'other',
      priority: (['low', 'medium', 'high', 'critical'].includes(priority) ? priority : 'medium') as 'medium',
      attachments: [],
    },
    true
  );
  res.status(201).json({ success: true, data: { request } });
}

/** GET /client/billing/summary — the client's own invoices. */
export async function billingSummary(req: Request, res: Response) {
  const { organizationId, scope } = clientContext(req);
  const customerOrgId = requireCustomerOrg(scope);
  const org = await CustomerOrg.findOne({ _id: customerOrgId, taskflowOrganizationId: organizationId })
    .select('crmAccountId')
    .lean();
  if (!org?.crmAccountId) throw new ApiError(404, 'Customer org has no linked CRM account');
  const invoices = await BillingInvoice.find({
    taskflowOrganizationId: organizationId,
    accountId: org.crmAccountId,
    status: { $in: ['sent', 'overdue', 'paid'] },
  })
    .sort({ issueDate: -1 })
    .limit(20)
    .lean();
  const open = invoices.filter((i) => i.status === 'sent' || i.status === 'overdue');
  const outstanding = open.reduce((s, i) => s + Math.max(0, (i.total ?? 0) - (i.amountPaid ?? 0)), 0);
  res.json({
    success: true,
    data: {
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

/** POST /client/files (multipart `file`, optional `ticketId`) — store a file the client sent. */
export async function uploadFile(req: Request, res: Response) {
  const { organizationId, serviceAccountId, scope } = clientContext(req);
  requireLinked(scope);
  if (!req.file) throw new ApiError(400, 'No file uploaded');

  const ticketRef = String((req.body as { ticketId?: unknown })?.ticketId ?? '').trim();
  const ticket = ticketRef ? await findPaTicket(organizationId, ticketRef, clientTicketFilter(scope)) : null;
  if (ticketRef && !ticket) throw new ApiError(404, 'Ticket not found');

  const saved = await saveUpload({ buffer: req.file.buffer, originalName: req.file.originalname, mimeType: req.file.mimetype });
  const file = await PaFile.create({
    taskflowOrganizationId: organizationId,
    key: saved.key,
    url: saved.url,
    originalName: saved.originalName,
    mimeType: saved.mimeType,
    size: saved.size,
    customerOrgId: scope.customerOrgId,
    chatId: scope.chatId,
    serviceTicketId: ticket?._id ?? null,
    uploadedBy: serviceAccountId,
  });
  if (ticket) {
    await ticketsService.addComment(
      String(ticket._id),
      organizationId,
      { body: `Attachment from WhatsApp: ${saved.originalName} — ${saved.url}`, internal: true },
      { name: 'WhatsApp PA' }
    );
  }
  res.status(201).json({
    success: true,
    data: { id: String(file._id), url: saved.url, originalName: saved.originalName, mimeType: saved.mimeType, size: saved.size },
  });
}

/** GET /client/files/:id — only files this client (or this chat) sent. */
export async function downloadFile(req: Request, res: Response) {
  const { organizationId, scope } = clientContext(req);
  requireLinked(scope);
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new ApiError(404, 'File not found');
  const owners: Record<string, unknown>[] = [{ chatId: scope.chatId }];
  if (scope.customerOrgId) owners.push({ customerOrgId: scope.customerOrgId });
  const file = await PaFile.findOne({ _id: req.params.id, taskflowOrganizationId: organizationId, $or: owners }).lean();
  if (!file) throw new ApiError(404, 'File not found');
  await sendStoredFile(res, file.key, file.originalName);
}
