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
import { User } from '../../auth/user.model';

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

  return { ...request, linkedIssue, ticketDetails };
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

export async function tfApprove(
  requestId: string,
  reviewedByTfUserId: string,
  note?: string
): Promise<unknown> {
  const request = await CustomerRequest.findOne({
    _id: requestId,
    status: 'pending_taskflow_approval',
  }).lean();

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
  };

  // Auto-create issue in the linked project
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
  const projectLabel = `${projectAny.name} (${projectAny.key})`;

  const issueType =
    projectAny.issueTypes?.find((t) => t.name === typeName) ?? projectAny.issueTypes?.[0];
  const priority =
    projectAny.priorities?.find((p) => p.name === priorityName) ?? projectAny.priorities?.[0];
  const status =
    projectAny.statuses?.find((s) => !s.isClosed) ?? projectAny.statuses?.[0];

  const issueKey = `${projectAny.key}-${projectAny.nextIssueNumber}`;

  const issue = await Issue.create({
    title: r.title,
    description: r.description,
    type: issueType?.name ?? 'Task',
    priority: priority?.name ?? 'Medium',
    status: status?.name ?? 'To Do',
    project: r.projectId,
    reporter: reviewedByTfUserId,
    key: issueKey,
    boardColumn: status?.name ?? 'To Do',
    customFieldValues: {
      customerRequestId: r._id.toString(),
      customerOrgId: r.customerOrgId.toString(),
    },
  });

  const updated = await CustomerRequest.findByIdAndUpdate(
    requestId,
    {
      $set: {
        'approvalFlow.taskflowStage.status': 'approved',
        'approvalFlow.taskflowStage.reviewedBy': reviewedByTfUserId,
        'approvalFlow.taskflowStage.reviewedAt': new Date(),
        'approvalFlow.taskflowStage.note': note,
        status: 'ticket_created',
        linkedIssueId: issue._id,
        linkedIssueKey: issueKey,
      },
    },
    { new: true }
  ).lean();

  // Notify requester and org admin (email)
  const [requester, org, orgAdmin, approver] = await Promise.all([
    CustomerUser.findById(r.createdBy).select('name email').lean(),
    CustomerOrg.findById(r.customerOrgId).select('name').lean(),
    CustomerUser.findOne({
      customerOrgId: r.customerOrgId,
      isOrgAdmin: true,
      status: 'active',
    })
      .select('name email')
      .lean(),
    User.findById(reviewedByTfUserId).select('name').lean(),
  ]);

  const notifyUsers = new Set<string>();
  if (requester) notifyUsers.add(requester.email);
  if (orgAdmin && orgAdmin.email !== requester?.email) notifyUsers.add(orgAdmin.email);

  for (const email of notifyUsers) {
    const recipientName = email === requester?.email ? requester?.name : orgAdmin?.name ?? 'Admin';
    sendCustomerEmail(
      email,
      `Ticket created: ${issueKey} — ${r.title.length > 40 ? `${r.title.slice(0, 37)}…` : r.title}`,
      renderTicketCreatedEmail({
        recipientName: recipientName ?? '',
        requestTitle: r.title,
        issueKey,
        orgName: org?.name ?? '',
        appUrl: env.appUrl,
        requestId: r._id.toString(),
        projectLabel,
        typeLabel: formatRequestTypeLabel(r.type),
        priorityLabel: formatPriorityLabel(r.priority),
      })
    ).catch((err) => console.error('Failed to send ticket created email:', err));
  }

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
  note?: string,
  reason?: string
): Promise<unknown> {
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
  query: { page?: number; limit?: number } = {}
): Promise<unknown> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    CustomerRequest.find({ status: 'pending_taskflow_approval' })
      .populate('createdBy', 'name email')
      .populate('customerOrgId', 'name slug')
      .populate('projectId', 'name key')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    CustomerRequest.countDocuments({ status: 'pending_taskflow_approval' }),
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
  query: { status?: string; orgId?: string; page?: number; limit?: number } = {}
): Promise<unknown> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 50));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.orgId) filter.customerOrgId = query.orgId;

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
