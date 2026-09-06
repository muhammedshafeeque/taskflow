import mongoose from 'mongoose';
import { CustomerRequest } from './customerRequest.model';
import { CustomerUser } from '../customer-user/customerUser.model';
import { CustomerOrg } from '../customer-org/customerOrg.model';
import { userHasPermission } from '../../../shared/constants/legacyPermissionMap';
import { Project } from '../../projects/project.model';
import { Issue } from '../../issues/issue.model';
import { IssueHistory } from '../../issues/issueHistory.model';
import { IssueLink } from '../../issues/issueLink.model';
import { WorkLog } from '../../workLogs/workLog.model';
import { Comment } from '../../comments/comment.model';
import * as issueHistoryService from '../../issues/issueHistory.service';
import { ApiError } from '../../../utils/ApiError';
import { env } from '../../../config/env';
import {
  sendCustomerEmail,
  renderTicketCreatedEmail,
  renderStaffTicketCreatedEmail,
  renderTfRejectedEmail,
  renderCustomerRequestRejectedEmail,
  renderCustomerRequestApprovedByOrgAdminEmail,
  renderTicketClosedEmail,
} from '../../../services/email.service';
import type { CreateRequestInput } from './customerRequest.validation';
import {
  notifyTaskflowRequestQueued,
  notifyProjectMembersTicketFromCustomerRequest,
  notifyTaskflowRequestDeclined,
  formatRequestTypeLabel,
  formatPriorityLabel,
} from './customerRequestInbox';
import { User, UserType } from '../../auth/user.model';
import { Role } from '../../roles/role.model';
import { OrganizationMember } from '../../organizations/organizationMember.model';
import { resolveEffectiveGlobalPermissions } from '../../auth/effectivePermissions';
import { createTicketFromCustomerRequest } from '../../service-desk/tickets.service';
import { ServiceTicket } from '../../service-desk/models/serviceTicket.model';
import { TASK_FLOW_PERMISSIONS } from '../../../shared/constants/permissions';

async function customerOrgIdsInTaskflowWorkspace(
  taskflowOrganizationId: string | null | undefined
): Promise<mongoose.Types.ObjectId[]> {
  if (!taskflowOrganizationId || !mongoose.Types.ObjectId.isValid(taskflowOrganizationId)) return [];
  return CustomerOrg.find({ taskflowOrganizationId }).distinct('_id');
}

export async function assertCustomerRequestInTaskflowWorkspace(
  requestId: string,
  taskflowOrganizationId: string | null | undefined
): Promise<void> {
  if (!taskflowOrganizationId || !mongoose.Types.ObjectId.isValid(taskflowOrganizationId)) {
    throw new ApiError(400, 'Active workspace required');
  }
  const reqDoc = await CustomerRequest.findById(requestId).select('customerOrgId').lean();
  if (!reqDoc) throw new ApiError(404, 'Request not found');
  const coId = (reqDoc as { customerOrgId?: unknown }).customerOrgId;
  const org = await CustomerOrg.findById(coId).select('taskflowOrganizationId').lean();
  const tfOrg = org && (org as { taskflowOrganizationId?: unknown }).taskflowOrganizationId;
  if (!tfOrg || String(tfOrg) !== taskflowOrganizationId) {
    throw new ApiError(403, 'Request is not in the active workspace');
  }
}

export async function createRequest(
  orgId: string,
  createdByUserId: string,
  input: CreateRequestInput,
  isOrgAdmin: boolean
): Promise<unknown> {
  let status: string;
  let customerAdminStageRequired = true;
  let customerAdminStageStatus: string = 'pending';

  if (isOrgAdmin) {
    customerAdminStageRequired = false;
    customerAdminStageStatus = 'skipped';
    status = 'pending_taskflow_approval';
  } else {
    status = 'pending_customer_approval';
  }

  const request = await CustomerRequest.create({
    customerOrgId: orgId,
    projectId: input.projectId,
    title: input.title,
    description: input.description,
    type: input.type,
    priority: input.priority,
    attachments: input.attachments ?? [],
    createdBy: createdByUserId,
    approvalFlow: {
      customerAdminStage: {
        required: customerAdminStageRequired,
        status: customerAdminStageStatus,
      },
      taskflowStage: {
        status: 'pending',
      },
    },
    status,
  });

  const requestId = String(request._id);

  const [org, project, requester] = await Promise.all([
    CustomerOrg.findById(orgId).select('name').lean(),
    Project.findById(input.projectId).select('name key').lean(),
    CustomerUser.findById(createdByUserId).select('name email').lean(),
  ]);
  const projectLabel = project
    ? `${(project as { name: string; key: string }).name} (${(project as { name: string; key: string }).key})`
    : '—';

  if (status === 'pending_taskflow_approval') {
    notifyTaskflowRequestQueued({
      requestId,
      title: input.title,
      description: input.description,
      type: input.type,
      priority: input.priority,
      orgName: (org as { name?: string } | null)?.name ?? '—',
      projectLabel,
      requesterName: requester?.name ?? '—',
    }).catch((err) => console.error('notifyTaskflowRequestQueued (create):', err));
  }

  return request.toObject();
}

export async function listRequests(
  orgId: string,
  userId: string,
  permissions: string[],
  query: { status?: string; projectId?: string; page?: number; limit?: number }
): Promise<unknown> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = { customerOrgId: orgId };

  if (!userHasPermission(permissions, 'requests:view_all')) {
    filter.createdBy = userId;
  }

  if (query.status) filter.status = query.status;
  if (query.projectId) filter.projectId = query.projectId;

  const [data, total] = await Promise.all([
    CustomerRequest.find(filter)
      .populate('createdBy', 'name email')
      .populate('projectId', 'name key')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    CustomerRequest.countDocuments(filter),
  ]);

  return {
    requests: data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function getRequest(
  orgId: string,
  requestId: string,
  userId: string,
  permissions: string[]
): Promise<unknown> {
  const filter: Record<string, unknown> = { _id: requestId, customerOrgId: orgId };

  if (!userHasPermission(permissions, 'requests:view_all')) {
    filter.createdBy = userId;
  }

  const request = await CustomerRequest.findOne(filter)
    .populate('createdBy', 'name email')
    .populate('projectId', 'name key')
    .populate('approvalFlow.customerAdminStage.reviewedBy', 'name email')
    .populate('approvalFlow.taskflowStage.reviewedBy', 'name email')
    .lean();

  if (!request) throw new ApiError(404, 'Request not found');

  const r = request as { linkedIssueId?: unknown; _id: unknown };
  let linkedIssue: unknown = null;
  let ticketDetails: unknown = null;

  if (r.linkedIssueId) {
    const issueObjId = new mongoose.Types.ObjectId(String(r.linkedIssueId));

    const [issue, historyResult, workLogAgg, childTasks, issueLinks, portalVisibleComments] =
      await Promise.all([
        Issue.findById(issueObjId)
          .select('title status priority assignee key timeEstimateMinutes')
          .populate('assignee', 'name email avatarUrl')
          .lean(),

        issueHistoryService.findByIssue(String(r.linkedIssueId), { page: 1, limit: 500 }),

        WorkLog.aggregate([
          { $match: { issue: issueObjId } },
          { $group: { _id: '$author', totalMinutes: { $sum: '$minutesSpent' } } },
          {
            $lookup: {
              from: 'users',
              localField: '_id',
              foreignField: '_id',
              as: 'authorInfo',
            },
          },
          { $unwind: { path: '$authorInfo', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 1,
              authorName: '$authorInfo.name',
              authorEmail: '$authorInfo.email',
              totalMinutes: 1,
            },
          },
        ]),

        Issue.find({ parent: issueObjId })
          .select('title status priority assignee key type')
          .populate('assignee', 'name email')
          .lean(),

        IssueLink.find({ $or: [{ sourceIssue: issueObjId }, { targetIssue: issueObjId }] })
          .populate('sourceIssue', 'title status key type priority')
          .populate('targetIssue', 'title status key type priority')
          .lean(),

        Comment.find({ issue: issueObjId, portalVisible: true })
          .populate('author', 'name email')
          .sort({ createdAt: 1 })
          .lean(),
      ]);

    linkedIssue = issue;

    const wlAgg = workLogAgg as Array<{
      _id: unknown;
      authorName?: string;
      authorEmail?: string;
      totalMinutes: number;
    }>;
    const totalLoggedMinutes = wlAgg.reduce((sum, w) => sum + (w.totalMinutes || 0), 0);

    const issueHistoryItems = historyResult.data;
    const assigneeHistory = issueHistoryItems.filter(
      (h) => h.action === 'field_change' && h.field === 'Assignee'
    );

    ticketDetails = {
      totalLoggedMinutes,
      workLogByUser: wlAgg,
      issueHistory: issueHistoryItems,
      assigneeHistory,
      childTasks,
      issueLinks,
      portalVisibleComments,
    };
  }

  const reqAny = request as { linkedServiceTicketId?: unknown; _id: unknown };
  const ticketFilter = reqAny.linkedServiceTicketId
    ? { _id: reqAny.linkedServiceTicketId }
    : { customerRequestId: reqAny._id };
  const sdTicket = await ServiceTicket.findOne(ticketFilter)
    .select('subject status priority workClassification comments')
    .lean();
  let linkedTicket: unknown = null;
  if (sdTicket) {
    const comments = (
      (sdTicket as { comments?: Array<{ internal?: boolean; body: string; authorName?: string; createdAt: Date }> })
        .comments ?? []
    )
      .filter((c) => !c.internal)
      .map((c) => ({
        body: c.body,
        authorName: c.authorName,
        createdAt: c.createdAt,
      }));
    linkedTicket = {
      _id: sdTicket._id,
      subject: (sdTicket as { subject: string }).subject,
      status: (sdTicket as { status: string }).status,
      priority: (sdTicket as { priority: string }).priority,
      workClassification: (sdTicket as { workClassification?: string }).workClassification,
      comments,
    };
  }

  return { ...request, linkedIssue, ticketDetails, linkedTicket };
}

export async function addPortalComment(
  orgId: string,
  requestId: string,
  userId: string,
  customerUserName: string,
  body: string
): Promise<unknown> {
  const request = await CustomerRequest.findOne({
    _id: requestId,
    customerOrgId: orgId,
    createdBy: userId,
  })
    .select('linkedIssueId status')
    .lean();

  if (!request) throw new ApiError(404, 'Request not found');

  const r = request as { linkedIssueId?: unknown; status: string };

  const plainText = body.replace(/<[^>]+>/g, '');
  const forwardToIssue = /@issue\b/i.test(plainText);

  const updated = await CustomerRequest.findByIdAndUpdate(
    requestId,
    {
      $push: {
        portalComments: {
          body,
          authorName: customerUserName,
          customerId: userId,
          forwardedToIssue: forwardToIssue,
          createdAt: new Date(),
        },
      },
    },
    { new: true }
  )
    .select('portalComments')
    .lean();

  // If @issue mentioned and linked issue exists, create highlighted comment on the issue
  if (forwardToIssue && r.linkedIssueId) {
    const issue = await Issue.findById(r.linkedIssueId).select('reporter').lean();
    if (issue) {
      const issueAny = issue as { reporter: unknown };
      await Comment.create({
        body,
        issue: r.linkedIssueId,
        author: issueAny.reporter,
        portalHighlighted: true,
        portalAuthorName: customerUserName,
        customerRequestId: requestId,
        portalVisible: false,
      });
    }
  }

  const updatedAny = updated as {
    portalComments?: Array<{ body: string; authorName: string; customerId: unknown; forwardedToIssue: boolean; createdAt: Date }>;
  };
  const comments = updatedAny?.portalComments ?? [];
  return comments[comments.length - 1] ?? null;
}

export async function customerAdminApprove(
  orgId: string,
  requestId: string,
  reviewedBy: string,
  note?: string
): Promise<unknown> {
  const request = await CustomerRequest.findOne({
    _id: requestId,
    customerOrgId: orgId,
    status: 'pending_customer_approval',
  }).lean();

  if (!request) throw new ApiError(404, 'Request not found or not pending customer approval');

  const updated = await CustomerRequest.findByIdAndUpdate(
    requestId,
    {
      $set: {
        'approvalFlow.customerAdminStage.status': 'approved',
        'approvalFlow.customerAdminStage.reviewedBy': reviewedBy,
        'approvalFlow.customerAdminStage.reviewedAt': new Date(),
        'approvalFlow.customerAdminStage.note': note,
        status: 'pending_taskflow_approval',
      },
    },
    { new: true }
  ).lean();

  const r = request as {
    _id: unknown;
    createdBy?: unknown;
    title?: string;
    description?: string;
    type?: string;
    priority?: string;
    projectId?: unknown;
  };

  const [requester, org, project, orgAdminReviewer] = await Promise.all([
    r.createdBy ? CustomerUser.findById(r.createdBy).select('name email').lean() : null,
    CustomerOrg.findById(orgId).select('name').lean(),
    r.projectId ? Project.findById(r.projectId).select('name key').lean() : null,
    CustomerUser.findById(reviewedBy).select('name').lean(),
  ]);
  const projectLabel = project
    ? `${(project as { name: string; key: string }).name} (${(project as { name: string; key: string }).key})`
    : '—';

  notifyTaskflowRequestQueued({
    requestId: String(requestId),
    title: r.title ?? '',
    description: r.description ?? '',
    type: (r.type as string) ?? 'other',
    priority: (r.priority as string) ?? 'medium',
    orgName: (org as { name?: string } | null)?.name ?? '—',
    projectLabel,
    requesterName: requester?.name ?? '—',
  }).catch((err) => console.error('notifyTaskflowRequestQueued (orgAdminApprove):', err));

  if (requester && org) {
    sendCustomerEmail(
      requester.email,
      `Your request has been approved by your organisation — ${(r.title ?? '').slice(0, 50)}${(r.title ?? '').length > 50 ? '…' : ''}`,
      renderCustomerRequestApprovedByOrgAdminEmail({
        requesterName: requester.name,
        requestTitle: r.title ?? '',
        orgName: (org as { name: string }).name,
        appUrl: env.appUrl,
        requestId: String(requestId),
        projectLabel,
        typeLabel: formatRequestTypeLabel((r.type as string) ?? 'other'),
        priorityLabel: formatPriorityLabel((r.priority as string) ?? 'medium'),
        reviewerName: orgAdminReviewer?.name ?? 'Organisation admin',
        adminNote: note,
      })
    ).catch((err) => console.error('Failed to send approval email:', err));
  }

  return updated;
}

export async function customerAdminReject(
  orgId: string,
  requestId: string,
  reviewedBy: string,
  note?: string,
  reason?: string
): Promise<unknown> {
  const request = await CustomerRequest.findOne({
    _id: requestId,
    customerOrgId: orgId,
    status: 'pending_customer_approval',
  }).lean();

  if (!request) throw new ApiError(404, 'Request not found or not pending customer approval');

  const updated = await CustomerRequest.findByIdAndUpdate(
    requestId,
    {
      $set: {
        'approvalFlow.customerAdminStage.status': 'rejected',
        'approvalFlow.customerAdminStage.reviewedBy': reviewedBy,
        'approvalFlow.customerAdminStage.reviewedAt': new Date(),
        'approvalFlow.customerAdminStage.note': note,
        status: 'rejected',
      },
    },
    { new: true }
  ).lean();

  const rej = request as {
    createdBy?: unknown;
    title?: string;
    type?: string;
    priority?: string;
    projectId?: unknown;
  };
  if (rej.createdBy) {
    const [requester, org, project] = await Promise.all([
      CustomerUser.findById(rej.createdBy).select('name email').lean(),
      CustomerOrg.findById(orgId).select('name').lean(),
      rej.projectId ? Project.findById(rej.projectId).select('name key').lean() : null,
    ]);
    if (requester && org) {
      const projectLabel = project
        ? `${(project as { name: string; key: string }).name} (${(project as { name: string; key: string }).key})`
        : '—';
      sendCustomerEmail(
        requester.email,
        `Update on your request — ${(rej.title ?? '').slice(0, 45)}${(rej.title ?? '').length > 45 ? '…' : ''}`,
        renderCustomerRequestRejectedEmail({
          requesterName: requester.name,
          requestTitle: rej.title ?? '',
          orgName: (org as { name: string }).name,
          appUrl: env.appUrl,
          requestId: String(requestId),
          projectLabel,
          typeLabel: formatRequestTypeLabel((rej.type as string) ?? 'other'),
          priorityLabel: formatPriorityLabel((rej.priority as string) ?? 'medium'),
          reason: reason ?? '',
          adminNote: note,
        })
      ).catch((err) => console.error('Failed to send rejection email:', err));
    }
  }

  return updated;
}

function workClassificationLabel(v: 'billable_change' | 'fix'): string {
  return v === 'billable_change' ? 'Billable change' : 'Fix';
}

async function sendTicketCreatedAudienceEmails(params: {
  customerOrgId: string;
  taskflowOrganizationId: string;
  requesterId: unknown;
  requestTitle: string;
  issueKey: string;
  requestId: string;
  projectLabel: string;
  type: string;
  priority: string;
  workClassification: 'billable_change' | 'fix';
  projectId: string;
  issueId: string;
  ticketId?: string;
  ticketPending: boolean;
}): Promise<void> {
  const classLabel = workClassificationLabel(params.workClassification);
  const titleShort =
    params.requestTitle.length > 40 ? `${params.requestTitle.slice(0, 37)}…` : params.requestTitle;
  const subject = `Ticket created: ${params.issueKey} — ${titleShort}`;

  const [requester, org, orgAdmins] = await Promise.all([
    CustomerUser.findById(params.requesterId).select('name email').lean(),
    CustomerOrg.findById(params.customerOrgId).select('name').lean(),
    CustomerUser.find({
      customerOrgId: params.customerOrgId,
      isOrgAdmin: true,
      status: 'active',
    })
      .select('name email')
      .lean(),
  ]);

  const customerEmails = new Map<string, string>();
  if (requester?.email) customerEmails.set(requester.email.toLowerCase(), requester.name ?? '');
  for (const admin of orgAdmins) {
    if (admin.email) customerEmails.set(admin.email.toLowerCase(), admin.name ?? 'Admin');
  }

  const sent = new Set<string>();
  for (const [email, name] of customerEmails) {
    sent.add(email);
    sendCustomerEmail(
      email,
      subject,
      renderTicketCreatedEmail({
        recipientName: name || 'there',
        requestTitle: params.requestTitle,
        issueKey: params.issueKey,
        orgName: org?.name ?? '',
        appUrl: env.appUrl,
        requestId: params.requestId,
        projectLabel: params.projectLabel,
        typeLabel: formatRequestTypeLabel(params.type),
        priorityLabel: formatPriorityLabel(params.priority),
        workClassificationLabel: classLabel,
        ticketPending: params.ticketPending,
      })
    ).catch((err) => console.error('Failed to send ticket created email:', err));
  }

  const memberIds = await OrganizationMember.find({
    organization: params.taskflowOrganizationId,
    status: 'active',
  }).distinct('user');

  const staffUsers = await User.find({
    _id: { $in: memberIds },
    enabled: true,
    userType: UserType.TASKFLOW,
  })
    .select('name email role roleId permissionOverrides mustChangePassword')
    .lean();

  const roleIds = staffUsers.map((u) => u.roleId).filter(Boolean);
  const roles = await Role.find({ _id: { $in: roleIds } }).select('permissions').lean();
  const rolePerms = new Map(roles.map((r) => [String(r._id), r.permissions ?? []]));

  const sdList = TASK_FLOW_PERMISSIONS.TASKFLOW.SERVICE.TICKET.LIST;
  const sdRead = TASK_FLOW_PERMISSIONS.TASKFLOW.SERVICE.TICKET.READ;

  for (const staff of staffUsers) {
    const email = staff.email?.toLowerCase();
    if (!email || sent.has(email)) continue;
    const perms = resolveEffectiveGlobalPermissions({
      rolePermissions: staff.roleId ? rolePerms.get(String(staff.roleId)) ?? [] : [],
      role: staff.role,
      mustChangePassword: staff.mustChangePassword,
      permissionOverrides: staff.permissionOverrides,
    });
    if (!perms.includes(sdList) && !perms.includes(sdRead)) continue;
    sent.add(email);
    sendCustomerEmail(
      email,
      subject,
      renderStaffTicketCreatedEmail({
        recipientName: staff.name ?? 'there',
        requestTitle: params.requestTitle,
        issueKey: params.issueKey,
        orgName: org?.name ?? '',
        appUrl: env.appUrl,
        projectId: params.projectId,
        issueId: params.issueId,
        ticketId: params.ticketId,
        projectLabel: params.projectLabel,
        typeLabel: formatRequestTypeLabel(params.type),
        priorityLabel: formatPriorityLabel(params.priority),
        workClassificationLabel: classLabel,
        ticketPending: params.ticketPending,
      })
    ).catch((err) => console.error('Failed to send staff ticket created email:', err));
  }
}

export async function tfApprove(
  requestId: string,
  reviewedByTfUserId: string,
  note: string | undefined,
  taskflowOrganizationId: string | null | undefined,
  workClassification: 'billable_change' | 'fix' | undefined
): Promise<unknown> {
  if (workClassification !== 'billable_change' && workClassification !== 'fix') {
    throw new ApiError(400, 'Work classification is required (Billable change or Fix)');
  }
  await assertCustomerRequestInTaskflowWorkspace(requestId, taskflowOrganizationId);
  if (!taskflowOrganizationId) throw new ApiError(400, 'Active workspace required');

  const request = await CustomerRequest.findById(requestId).lean();
  if (!request) throw new ApiError(404, 'Request not found or not pending TF approval');

  const r = request as {
    _id: { toString(): string };
    projectId: unknown;
    title: string;
    description: string;
    type: string;
    priority: string;
    customerOrgId: { toString(): string };
    createdBy: unknown;
    status: string;
    linkedIssueId?: unknown;
    linkedIssueKey?: string;
    linkedServiceTicketId?: unknown;
  };

  if (r.linkedIssueId && r.linkedServiceTicketId && r.status === 'ticket_created') {
    return request;
  }

  if (r.status !== 'pending_taskflow_approval' && !r.linkedIssueId) {
    throw new ApiError(404, 'Request not found or not pending TF approval');
  }

  const classLabel = workClassificationLabel(workClassification);
  const typeMap: Record<string, string> = {
    bug: 'Bug',
    feature: 'Feature',
    suggestion: 'Task',
    concern: 'Task',
    other: 'Task',
  };
  const priorityMap: Record<string, string> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    critical: 'Critical',
  };

  let issueId = r.linkedIssueId ? String(r.linkedIssueId) : '';
  let issueKey = r.linkedIssueKey ?? '';
  let projectLabel = '';

  if (!r.linkedIssueId) {
    const project = await Project.findByIdAndUpdate(
      r.projectId,
      { $inc: { nextIssueNumber: 1 } },
      { new: true }
    )
      .select('name key nextIssueNumber statuses issueTypes priorities')
      .lean();

    if (!project) throw new ApiError(404, 'Project not found');

    const typeName = typeMap[r.type] ?? 'Task';
    const priorityName = priorityMap[r.priority] ?? 'Medium';

    const projectAny = project as {
      name: string;
      key: string;
      nextIssueNumber: number;
      issueTypes?: Array<{ name?: string }>;
      priorities?: Array<{ name?: string }>;
      statuses?: Array<{ name?: string; isClosed?: boolean }>;
    };
    projectLabel = `${projectAny.name} (${projectAny.key})`;

    const issueType =
      projectAny.issueTypes?.find((t) => t.name === typeName) ?? projectAny.issueTypes?.[0];
    const priority =
      projectAny.priorities?.find((p) => p.name === priorityName) ?? projectAny.priorities?.[0];
    const status =
      projectAny.statuses?.find((s) => !s.isClosed) ?? projectAny.statuses?.[0];

    issueKey = `${projectAny.key}-${projectAny.nextIssueNumber}`;
    const descFooter = `\n\n---\nWork classification: ${classLabel}`;

    const issue = await Issue.create({
      title: r.title,
      description: `${r.description}${descFooter}`,
      type: issueType?.name ?? 'Task',
      priority: priority?.name ?? 'Medium',
      status: status?.name ?? 'To Do',
      project: r.projectId,
      reporter: reviewedByTfUserId,
      key: issueKey,
      boardColumn: status?.name ?? 'To Do',
      customerRequestId: r._id,
      customFieldValues: {
        customerRequestId: r._id.toString(),
        customerOrgId: r.customerOrgId.toString(),
        workClassification,
      },
    });
    issueId = String(issue._id);
  } else {
    const project = await Project.findById(r.projectId).select('name key').lean();
    projectLabel = project
      ? `${(project as { name: string; key: string }).name} (${(project as { name: string; key: string }).key})`
      : '';
    if (!issueKey) {
      const existingIssue = await Issue.findById(r.linkedIssueId).select('key').lean();
      issueKey = (existingIssue as { key?: string } | null)?.key ?? '';
    }
  }

  let ticketId: string | undefined;
  let ticketPending = false;
  try {
    const ticket = await createTicketFromCustomerRequest(
      requestId,
      taskflowOrganizationId,
      reviewedByTfUserId,
      { linkedIssueId: issueId, workClassification }
    );
    ticketId = String((ticket as { _id: unknown })._id);
    await Issue.findByIdAndUpdate(issueId, {
      $set: { linkedServiceTicketId: ticketId, customerRequestId: requestId },
    });
  } catch (err) {
    console.error('createTicketFromCustomerRequest:', err);
    ticketPending = true;
  }

  const updated = await CustomerRequest.findByIdAndUpdate(
    requestId,
    {
      $set: {
        'approvalFlow.taskflowStage.status': 'approved',
        'approvalFlow.taskflowStage.reviewedBy': reviewedByTfUserId,
        'approvalFlow.taskflowStage.reviewedAt': new Date(),
        'approvalFlow.taskflowStage.note': note,
        status: 'ticket_created',
        linkedIssueId: issueId,
        linkedIssueKey: issueKey,
        workClassification,
        ...(ticketId ? { linkedServiceTicketId: ticketId } : {}),
      },
    },
    { new: true }
  ).lean();

  const org = await CustomerOrg.findById(r.customerOrgId).select('name').lean();
  const approver = await User.findById(reviewedByTfUserId).select('name').lean();

  sendTicketCreatedAudienceEmails({
    customerOrgId: r.customerOrgId.toString(),
    taskflowOrganizationId,
    requesterId: r.createdBy,
    requestTitle: r.title,
    issueKey,
    requestId: r._id.toString(),
    projectLabel,
    type: r.type,
    priority: r.priority,
    workClassification,
    projectId: String(r.projectId),
    issueId,
    ticketId,
    ticketPending,
  }).catch((err) => console.error('sendTicketCreatedAudienceEmails:', err));

  notifyProjectMembersTicketFromCustomerRequest({
    projectId: String(r.projectId),
    customerRequestId: r._id.toString(),
    requestTitle: r.title,
    orgName: org?.name ?? '—',
    projectLabel,
    issueKey,
    type: r.type,
    priority: r.priority,
    approvedByName: approver?.name ?? 'TaskFlow',
    reviewerNote: note,
  }).catch((err) => console.error('notifyProjectMembersTicketFromCustomerRequest:', err));

  return updated;
}

export async function tfReject(
  requestId: string,
  reviewedByTfUserId: string,
  note: string | undefined,
  reason: string | undefined,
  taskflowOrganizationId: string | null | undefined
): Promise<unknown> {
  await assertCustomerRequestInTaskflowWorkspace(requestId, taskflowOrganizationId);

  const request = await CustomerRequest.findOne({
    _id: requestId,
    status: 'pending_taskflow_approval',
  }).lean();

  if (!request) throw new ApiError(404, 'Request not found or not pending TF approval');

  const r = request as {
    _id: unknown;
    createdBy?: unknown;
    title?: string;
    description?: string;
    type?: string;
    priority?: string;
    customerOrgId?: unknown;
    projectId?: unknown;
  };

  const updated = await CustomerRequest.findByIdAndUpdate(
    requestId,
    {
      $set: {
        'approvalFlow.taskflowStage.status': 'rejected',
        'approvalFlow.taskflowStage.reviewedBy': reviewedByTfUserId,
        'approvalFlow.taskflowStage.reviewedAt': new Date(),
        'approvalFlow.taskflowStage.note': note,
        status: 'rejected',
      },
    },
    { new: true }
  ).lean();

  const [org, project, requester, tfReviewer] = await Promise.all([
    r.customerOrgId ? CustomerOrg.findById(r.customerOrgId).select('name').lean() : null,
    r.projectId ? Project.findById(r.projectId).select('name key').lean() : null,
    r.createdBy ? CustomerUser.findById(r.createdBy).select('name email').lean() : null,
    User.findById(reviewedByTfUserId).select('name').lean(),
  ]);
  const projectLabel = project
    ? `${(project as { name: string; key: string }).name} (${(project as { name: string; key: string }).key})`
    : '—';

  notifyTaskflowRequestDeclined({
    requestId: String(requestId),
    title: r.title ?? '',
    description: r.description ?? '',
    type: (r.type as string) ?? 'other',
    priority: (r.priority as string) ?? 'medium',
    orgName: (org as { name?: string } | null)?.name ?? '—',
    projectLabel,
    requesterName: requester?.name ?? '—',
    reason: reason ?? '',
    teamNote: note,
    reviewedByName: tfReviewer?.name ?? 'TaskFlow',
  }).catch((err) => console.error('notifyTaskflowRequestDeclined:', err));

  if (requester && org) {
    sendCustomerEmail(
      requester.email,
      `Update on your request — ${(r.title ?? '').slice(0, 45)}${(r.title ?? '').length > 45 ? '…' : ''}`,
      renderTfRejectedEmail({
        requesterName: requester.name,
        requestTitle: r.title ?? '',
        orgName: (org as { name: string }).name,
        appUrl: env.appUrl,
        requestId: String(r._id),
        projectLabel,
        typeLabel: formatRequestTypeLabel((r.type as string) ?? 'other'),
        priorityLabel: formatPriorityLabel((r.priority as string) ?? 'medium'),
        reason: reason ?? '',
        teamNote: note,
      })
    ).catch((err) => console.error('Failed to send TF rejection email:', err));
  }

  return updated;
}

export async function listPendingTfApproval(
  query: { page?: number; limit?: number } = {},
  taskflowOrganizationId?: string | null
): Promise<unknown> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;

  const allowedOrgIds = await customerOrgIdsInTaskflowWorkspace(taskflowOrganizationId);
  if (allowedOrgIds.length === 0) {
    return {
      requests: [],
      total: 0,
      page,
      limit,
      totalPages: 1,
    };
  }

  const [data, total] = await Promise.all([
    CustomerRequest.find({ status: 'pending_taskflow_approval', customerOrgId: { $in: allowedOrgIds } })
      .populate('createdBy', 'name email')
      .populate('customerOrgId', 'name slug')
      .populate('projectId', 'name key')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    CustomerRequest.countDocuments({ status: 'pending_taskflow_approval', customerOrgId: { $in: allowedOrgIds } }),
  ]);

  return {
    requests: data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function listAllRequestsTf(
  query: { status?: string; orgId?: string; page?: number; limit?: number } = {},
  taskflowOrganizationId?: string | null
): Promise<unknown> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 50));
  const skip = (page - 1) * limit;

  const allowedOrgIds = await customerOrgIdsInTaskflowWorkspace(taskflowOrganizationId);
  if (allowedOrgIds.length === 0) {
    return {
      requests: [],
      total: 0,
      page,
      limit,
      totalPages: 1,
    };
  }

  const filter: Record<string, unknown> = { customerOrgId: { $in: allowedOrgIds } };
  if (query.status) filter.status = query.status;
  if (query.orgId) {
    if (!allowedOrgIds.some((id) => String(id) === query.orgId)) {
      throw new ApiError(403, 'Organisation is not in the active workspace');
    }
    filter.customerOrgId = query.orgId;
  }

  const [data, total] = await Promise.all([
    CustomerRequest.find(filter)
      .populate('createdBy', 'name email')
      .populate('customerOrgId', 'name slug')
      .populate('projectId', 'name key')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    CustomerRequest.countDocuments(filter),
  ]);

  return {
    requests: data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function syncIssueStatus(
  issueId: string,
  projectStatuses: Array<{ name: string; isClosed?: boolean }>,
  newStatusName: string
): Promise<void> {
  const request = await CustomerRequest.findOne({
    linkedIssueId: issueId,
    status: { $in: ['ticket_created', 'in_progress', 'resolved'] },
  })
    .populate('createdBy', 'name email')
    .populate('customerOrgId', 'name')
    .lean();

  if (!request) return;

  const r = request as {
    _id: unknown;
    status: string;
    title: string;
    linkedIssueKey?: string;
    closureEmailSentAt?: Date;
    createdBy?: { name?: string; email?: string };
    customerOrgId?: { name?: string };
  };

  const isClosed = projectStatuses.some(
    (s) => s.name.toLowerCase() === newStatusName.toLowerCase() && s.isClosed
  );

  if (isClosed && r.status !== 'closed') {
    await CustomerRequest.findByIdAndUpdate(r._id, { $set: { status: 'closed' } });

    // Send closure email if not already sent
    if (!r.closureEmailSentAt && r.createdBy?.email) {
      await CustomerRequest.findByIdAndUpdate(r._id, { $set: { closureEmailSentAt: new Date() } });
      sendCustomerEmail(
        r.createdBy.email,
        `Your ticket has been closed: ${r.linkedIssueKey ?? ''}`,
        renderTicketClosedEmail(
          r.createdBy.name ?? '',
          r.title,
          r.linkedIssueKey ?? '',
          r.customerOrgId?.name ?? '',
          env.appUrl
        )
      ).catch((err) => console.error('Failed to send closure email:', err));
    }
  } else if (!isClosed && r.status !== 'in_progress') {
    await CustomerRequest.findByIdAndUpdate(r._id, { $set: { status: 'in_progress' } });
  }
}
