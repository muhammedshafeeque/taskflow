import mongoose from 'mongoose';
import { ServiceTicket } from './models/serviceTicket.model';
import { SlaPolicy } from './models/slaPolicy.model';
import { CustomerRequest } from '../customer-portal/customer-request/customerRequest.model';
import { CrmAccount } from '../crm/models/crmAccount.model';
import { CrmContract } from '../crm/models/crmContract.model';
import { Issue } from '../issues/issue.model';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { notifyUser } from '../notifications/notificationDispatch.service';

function applySlaTargets(
  ticket: { priority: string; firstResponseDueAt?: Date; resolutionDueAt?: Date },
  policy: { targets: { priority: string; firstResponseMinutes: number; resolutionMinutes: number }[] }
) {
  const target = policy.targets.find((t) => t.priority === ticket.priority) ?? policy.targets[0];
  if (!target) return;
  const now = Date.now();
  ticket.firstResponseDueAt = new Date(now + target.firstResponseMinutes * 60 * 1000);
  ticket.resolutionDueAt = new Date(now + target.resolutionMinutes * 60 * 1000);
}

export async function listTickets(
  workspaceId: string | null | undefined,
  opts: { status?: string; queue?: string } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (opts.status) filter.status = opts.status;
  if (opts.queue) filter.queue = opts.queue;
  return ServiceTicket.find(filter)
    .populate('assigneeId', 'name email')
    .populate('accountId', 'name')
    .populate('projectId', 'name key')
    .sort({ updatedAt: -1 })
    .lean();
}

export async function createTicket(
  workspaceId: string | null | undefined,
  input: Record<string, unknown>,
  userId: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const ticketData: Record<string, unknown> = {
    taskflowOrganizationId: toOrgOid(orgId),
    subject: String(input.subject ?? '').trim(),
    description: input.description,
    status: 'open',
    priority: input.priority ?? 'medium',
    queue: input.queue ?? 'general',
    accountId: input.accountId,
    contactId: input.contactId,
    assigneeId: input.assigneeId,
  };
  if (input.projectId && mongoose.Types.ObjectId.isValid(String(input.projectId))) {
    ticketData.projectId = input.projectId;
  }
  if (input.workClassification) ticketData.workClassification = input.workClassification;
  if (input.source) ticketData.source = input.source;
  if (input.whatsappGroupId) ticketData.whatsappGroupId = input.whatsappGroupId;
  if (input.whatsappMessageId) ticketData.whatsappMessageId = input.whatsappMessageId;
  if (input.supportConversationId) {
    ticketData.supportConversationId = input.supportConversationId;
  }
  if (input.aiAnalysis) ticketData.aiAnalysis = input.aiAnalysis;
  if (input.qaAnalysis) ticketData.qaAnalysis = input.qaAnalysis;
  if (input.linkedIssueId && mongoose.Types.ObjectId.isValid(String(input.linkedIssueId))) {
    ticketData.linkedIssueId = input.linkedIssueId;
  }
  if (userId && userId !== 'system' && mongoose.Types.ObjectId.isValid(userId)) {
    ticketData.createdBy = userId;
  }
  // Resolve the SLA policy: explicit choice wins; otherwise inherit from the
  // account's active contract so support honors the contracted service level.
  let slaPolicyId = input.slaPolicyId as string | undefined;
  if (!slaPolicyId && input.accountId) {
    const contract = await CrmContract.findOne({
      taskflowOrganizationId: toOrgOid(orgId),
      accountId: input.accountId,
      status: 'active',
      slaPolicyId: { $exists: true, $ne: null },
    })
      .sort({ updatedAt: -1 })
      .lean();
    if (contract) {
      slaPolicyId = String(contract.slaPolicyId);
      ticketData.contractId = contract._id;
    }
  } else if (input.contractId) {
    ticketData.contractId = input.contractId;
  }
  if (slaPolicyId) {
    const policy = await SlaPolicy.findOne({ _id: slaPolicyId, taskflowOrganizationId: toOrgOid(orgId) });
    if (policy) {
      ticketData.slaPolicyId = policy._id;
      const slaTicket: { priority: string; firstResponseDueAt?: Date; resolutionDueAt?: Date } = {
        priority: String(ticketData.priority),
      };
      applySlaTargets(slaTicket, policy);
      ticketData.firstResponseDueAt = slaTicket.firstResponseDueAt;
      ticketData.resolutionDueAt = slaTicket.resolutionDueAt;
    }
  }
  const doc = await ServiceTicket.create(ticketData);
  if (input.assigneeId) {
    await notifyUser({
      userId: String(input.assigneeId),
      eventKey: 'task_assigned',
      title: 'Ticket assigned',
      body: doc.subject,
      link: `/service/tickets`,
    }).catch(() => undefined);
  }
  return doc.toObject();
}

export async function updateTicket(id: string, workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const existing = await ServiceTicket.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!existing) throw new ApiError(404, 'Ticket not found');

  const allowed = ['status', 'priority', 'queue', 'assigneeId', 'description', 'subject'] as const;
  const $set: Record<string, unknown> = {};
  for (const key of allowed) {
    if (!(key in input)) continue;
    if (key === 'assigneeId' && (input.assigneeId === '' || input.assigneeId == null)) {
      $set.assigneeId = undefined;
      continue;
    }
    $set[key] = input[key];
  }

  if ($set.status === 'resolved' || $set.status === 'closed') {
    $set.resolvedAt = new Date();
  }
  if ($set.status === 'in_progress' && !existing.firstRespondedAt) {
    $set.firstRespondedAt = new Date();
  }

  const prevAssignee = existing.assigneeId ? String(existing.assigneeId) : '';
  const clearAssignee = 'assigneeId' in input && (input.assigneeId === '' || input.assigneeId == null);
  if (clearAssignee) delete $set.assigneeId;
  const nextAssignee = clearAssignee ? '' : $set.assigneeId !== undefined ? String($set.assigneeId) : prevAssignee;

  const updated = await ServiceTicket.findOneAndUpdate(
    { _id: id, taskflowOrganizationId: toOrgOid(orgId) },
    {
      ...(Object.keys($set).length ? { $set } : {}),
      ...(clearAssignee ? { $unset: { assigneeId: 1 } } : {}),
    },
    { new: true }
  ).lean();
  if (!updated) throw new ApiError(404, 'Ticket not found');

  if (nextAssignee && nextAssignee !== prevAssignee && mongoose.Types.ObjectId.isValid(nextAssignee)) {
    await notifyUser({
      userId: nextAssignee,
      eventKey: 'task_assigned',
      title: 'Ticket assigned',
      body: existing.subject,
      link: `/service/tickets?ticket=${id}`,
    }).catch(() => undefined);
  }

  return updated;
}

export async function getTicket(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const ticket = await ServiceTicket.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) })
    .populate('assigneeId', 'name email')
    .populate('accountId', 'name')
    .populate('contractId', 'title')
    .populate('linkedIssueId', 'key title')
    .populate('projectId', 'name key')
    .lean();
  if (!ticket) throw new ApiError(404, 'Ticket not found');
  return ticket;
}

export async function addComment(
  id: string,
  workspaceId: string | null | undefined,
  input: { body?: string; internal?: boolean },
  user: { id?: string; name?: string }
) {
  const orgId = requireWorkspaceId(workspaceId);
  const body = String(input.body ?? '').trim();
  if (!body) throw new ApiError(400, 'Comment body is required');
  const ticket = await ServiceTicket.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!ticket) throw new ApiError(404, 'Ticket not found');

  ticket.comments.push({
    authorId: user.id && mongoose.Types.ObjectId.isValid(user.id) ? new mongoose.Types.ObjectId(user.id) : undefined,
    authorName: user.name,
    body,
    internal: Boolean(input.internal),
    createdAt: new Date(),
  });
  // The first public reply counts as the first response for SLA purposes.
  if (!input.internal && !ticket.firstRespondedAt) {
    ticket.firstRespondedAt = new Date();
    if (ticket.status === 'open') ticket.status = 'in_progress';
  }
  await ticket.save();
  return getTicket(id, workspaceId);
}

export async function submitCsat(
  id: string,
  workspaceId: string | null | undefined,
  score: number,
  comment?: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const updated = await ServiceTicket.findOneAndUpdate(
    { _id: id, taskflowOrganizationId: toOrgOid(orgId) },
    { $set: { csatScore: score, csatComment: comment, status: 'closed' } },
    { new: true }
  ).lean();
  if (!updated) throw new ApiError(404, 'Ticket not found');
  return updated;
}

const REQUEST_TO_SD_PRIORITY: Record<string, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  critical: 'urgent',
};

export async function createTicketFromCustomerRequest(
  requestId: string,
  workspaceId: string,
  userId: string,
  extras?: {
    linkedIssueId?: mongoose.Types.ObjectId | string;
    workClassification?: 'billable_change' | 'fix';
  }
) {
  const request = await CustomerRequest.findById(requestId).lean();
  if (!request) throw new ApiError(404, 'Request not found');
  const orgOid = toOrgOid(workspaceId);
  let accountId: mongoose.Types.ObjectId | undefined;
  const customerOrgId = (request as { customerOrgId?: mongoose.Types.ObjectId }).customerOrgId;
  if (customerOrgId) {
    const account = await CrmAccount.findOne({ customerOrgId }).lean();
    if (account) accountId = account._id as mongoose.Types.ObjectId;
  }
  const linkedIssueId =
    extras?.linkedIssueId ?? (request as { linkedIssueId?: mongoose.Types.ObjectId }).linkedIssueId;
  const workClassification =
    extras?.workClassification ??
    (request as { workClassification?: 'billable_change' | 'fix' }).workClassification;
  const existing = await ServiceTicket.findOne({ customerRequestId: requestId });
  if (existing) {
    if (linkedIssueId && !existing.linkedIssueId) existing.linkedIssueId = linkedIssueId as mongoose.Types.ObjectId;
    if (workClassification && !existing.workClassification) existing.workClassification = workClassification;
    if (accountId && !existing.accountId) existing.accountId = accountId;
    if (customerOrgId && !existing.customerOrgId) existing.customerOrgId = customerOrgId;
    const projectId = (request as { projectId?: mongoose.Types.ObjectId }).projectId;
    if (projectId && !existing.projectId) existing.projectId = projectId;
    await existing.save();
    return existing.toObject();
  }
  const reqPriority = (request as { priority?: string }).priority ?? 'medium';
  const projectId = (request as { projectId?: mongoose.Types.ObjectId }).projectId;
  const doc = await ServiceTicket.create({
    taskflowOrganizationId: orgOid,
    subject: (request as { title: string }).title,
    description: (request as { description?: string }).description,
    accountId,
    customerOrgId,
    projectId,
    customerRequestId: new mongoose.Types.ObjectId(requestId),
    linkedIssueId,
    workClassification,
    status: 'open',
    priority: REQUEST_TO_SD_PRIORITY[reqPriority] ?? 'medium',
    queue: 'portal',
    createdBy: userId,
  });
  if (linkedIssueId) {
    await Issue.findByIdAndUpdate(linkedIssueId, {
      $set: {
        linkedServiceTicketId: doc._id,
        customerRequestId: requestId,
      },
    });
  }
  return doc.toObject();
}

export async function getServiceDashboard(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const now = new Date();
  const tickets = await ServiceTicket.find({ taskflowOrganizationId: orgOid }).lean();

  const open = tickets.filter((t) => !['resolved', 'closed'].includes(t.status));
  const resolved = tickets.filter((t) => t.resolvedAt);
  const withCsat = tickets.filter((t) => typeof t.csatScore === 'number');
  const csatAvg = withCsat.length
    ? Math.round((withCsat.reduce((s, t) => s + (t.csatScore ?? 0), 0) / withCsat.length) * 10) / 10
    : 0;

  // SLA compliance among tickets that have a resolution target
  const withTarget = tickets.filter((t) => t.resolutionDueAt);
  const breached = withTarget.filter((t) => {
    const due = new Date(t.resolutionDueAt as Date).getTime();
    return t.resolvedAt ? new Date(t.resolvedAt).getTime() > due : now.getTime() > due;
  });
  const slaCompliance = withTarget.length
    ? Math.round(((withTarget.length - breached.length) / withTarget.length) * 1000) / 10
    : 100;

  const byStatus = ['open', 'pending', 'in_progress', 'resolved', 'closed'].map((s) => ({
    name: s.replace('_', ' '),
    value: tickets.filter((t) => t.status === s).length,
  }));
  const byPriority = ['urgent', 'high', 'medium', 'low'].map((p) => ({
    name: p,
    value: tickets.filter((t) => t.priority === p).length,
  }));
  const byQueue = Object.entries(
    tickets.reduce<Record<string, number>>((acc, t) => {
      const q = t.queue || 'general';
      acc[q] = (acc[q] ?? 0) + 1;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value }));

  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    months.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  }
  const trend = months.map((month) => ({
    month,
    created: tickets.filter((t) => new Date(t.createdAt).toISOString().slice(0, 7) === month).length,
    resolved: tickets.filter((t) => t.resolvedAt && new Date(t.resolvedAt).toISOString().slice(0, 7) === month).length,
  }));

  const breachingSoon = open
    .filter((t) => t.resolutionDueAt && !t.resolvedAt)
    .map((t) => ({
      _id: String(t._id),
      subject: t.subject,
      priority: t.priority,
      status: t.status,
      resolutionDueAt: t.resolutionDueAt,
      overdue: new Date(t.resolutionDueAt as Date).getTime() < now.getTime(),
    }))
    .sort((a, b) => new Date(a.resolutionDueAt as Date).getTime() - new Date(b.resolutionDueAt as Date).getTime())
    .slice(0, 10);

  return {
    counts: {
      total: tickets.length,
      open: open.length,
      resolved: resolved.length,
      breached: breached.length,
      unassigned: tickets.filter((t) => !t.assigneeId && !['resolved', 'closed'].includes(t.status)).length,
    },
    slaCompliance,
    csatAvg,
    csatResponses: withCsat.length,
    byStatus,
    byPriority,
    byQueue,
    trend,
    breachingSoon,
  };
}

export async function checkSlaBreaches(workspaceId: string): Promise<number> {
  const now = new Date();
  const breached = await ServiceTicket.find({
    taskflowOrganizationId: toOrgOid(workspaceId),
    status: { $in: ['open', 'pending', 'in_progress'] },
    $or: [
      { firstResponseDueAt: { $lt: now }, firstRespondedAt: { $exists: false } },
      { resolutionDueAt: { $lt: now }, resolvedAt: { $exists: false } },
    ],
  }).lean();
  for (const t of breached) {
    if (t.assigneeId) {
      await notifyUser({
        userId: String(t.assigneeId),
        eventKey: 'system_alert',
        title: 'SLA breach',
        body: t.subject,
        link: `/service/tickets`,
      }).catch(() => undefined);
    }
  }
  return breached.length;
}
