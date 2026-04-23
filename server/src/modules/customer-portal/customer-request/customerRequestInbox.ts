import { User } from '../../auth/user.model';
import { Project } from '../../projects/project.model';
import { ProjectMember } from '../../projects/projectMember.model';
import * as inboxService from '../../inbox/inbox.service';
import { TASK_FLOW_PERMISSIONS } from '../../../shared/constants/permissions';
import { env } from '../../../config/env';

const TF_CUSTOMER_REQUEST_PERM = TASK_FLOW_PERMISSIONS.TASKFLOW.CUSTOMER_PORTAL.REQUEST_APPROVE;

function appBase(): string {
  return (env.appUrl || '').replace(/\/$/, '') || '';
}

export function buildCustomerRequestsAdminUrl(): string {
  return `${appBase()}/admin/customer-requests`;
}

function buildIssueAppUrl(projectId: string, issueKey: string): string {
  return `${appBase()}/projects/${projectId}/issues/${encodeURIComponent(issueKey)}`;
}

export async function getTaskflowCustomerApproverUserIds(): Promise<string[]> {
  const users = await User.find({
    enabled: true,
    userType: 'taskflow',
    permissions: TF_CUSTOMER_REQUEST_PERM,
  })
    .select('_id')
    .lean();
  return users.map((u) => String(u._id));
}

export async function getProjectMemberUserIdsForNotify(projectId: string): Promise<string[]> {
  const [members, project] = await Promise.all([
    ProjectMember.find({ project: projectId }).select('user').lean(),
    Project.findById(projectId).select('lead').lean(),
  ]);
  const ids = new Set<string>();
  for (const m of members) ids.add(String((m as { user: { toString(): string } }).user));
  const p = project as { lead?: unknown } | null;
  if (p?.lead) ids.add(String(p.lead));
  return [...ids];
}

function typeLabel(t: string): string {
  return formatRequestTypeLabel(t);
}

function priorityLabel(p: string): string {
  return formatPriorityLabel(p);
}

export function formatRequestTypeLabel(t: string): string {
  const m: Record<string, string> = {
    bug: 'Bug',
    feature: 'Feature',
    suggestion: 'Suggestion',
    concern: 'Concern',
    other: 'Other',
  };
  return m[t] ?? t;
}

export function formatPriorityLabel(p: string): string {
  return p ? p.charAt(0).toUpperCase() + p.slice(1) : p;
}

function trimDesc(s: string, max: number): string {
  const t = s.replace(/\r\n/g, '\n').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * A customer request is waiting in the TaskFlow approval queue.
 */
export async function notifyTaskflowRequestQueued(params: {
  requestId: string;
  title: string;
  description: string;
  type: string;
  priority: string;
  orgName: string;
  projectLabel: string;
  requesterName: string;
}): Promise<void> {
  const userIds = await getTaskflowCustomerApproverUserIds();
  if (userIds.length === 0) return;

  const t = params.title.length > 78 ? `${params.title.slice(0, 75)}…` : params.title;
  const messageTitle = `Customer request — review needed: ${t}`;

  const body = [
    'A new customer request is in the TaskFlow approval queue and is waiting for your team.',
    '',
    '── Summary ──',
    `Title        ${params.title}`,
    `Organisation ${params.orgName}`,
    `Project      ${params.projectLabel}`,
    `Submitted by ${params.requesterName}`,
    `Type         ${typeLabel(params.type)}`,
    `Priority     ${priorityLabel(params.priority)}`,
    '',
    '── Description ──',
    trimDesc(params.description, 2000) || '—',
    '',
    'Open Customer requests in TaskFlow to approve (creates a project ticket) or decline with a reason.',
  ].join('\n');

  const url = buildCustomerRequestsAdminUrl();
  await Promise.all(
    userIds.map((toUser) =>
      inboxService
        .createMessage({
          toUser,
          type: 'customer_portal_request_queued',
          title: messageTitle,
          body,
          meta: {
            url,
            customerRequestId: params.requestId,
            kind: 'pending_tf',
          },
        })
        .catch((err) => console.error('createMessage customer_portal_request_queued:', err))
    )
  );
}

/**
 * Customer request was approved and a ticket was created in the project.
 */
export async function notifyProjectMembersTicketFromCustomerRequest(params: {
  projectId: string;
  customerRequestId: string;
  requestTitle: string;
  orgName: string;
  projectLabel: string;
  issueKey: string;
  type: string;
  priority: string;
  approvedByName: string;
  reviewerNote?: string;
}): Promise<void> {
  const userIds = await getProjectMemberUserIdsForNotify(params.projectId);
  if (userIds.length === 0) return;

  const issueUrl = buildIssueAppUrl(params.projectId, params.issueKey);
  const t =
    params.requestTitle.length > 60 ? `${params.requestTitle.slice(0, 57)}…` : params.requestTitle;
  const messageTitle = `Ticket ${params.issueKey} from customer request: ${t}`;

  const noteBlock =
    params.reviewerNote && params.reviewerNote.trim()
      ? ['', '── Reviewer note ──', params.reviewerNote.trim(), '']
      : [''];

  const body = [
    'A customer request was approved and turned into a ticket in this project. You can open it to assign, estimate, and track work.',
    '',
    '── Ticket ──',
    `Key          ${params.issueKey}`,
    `Request      ${params.requestTitle}`,
    `Organisation ${params.orgName}`,
    `Project      ${params.projectLabel}`,
    `Type         ${typeLabel(params.type)}`,
    `Priority     ${priorityLabel(params.priority)}`,
    `Approved by  ${params.approvedByName}`,
    ...noteBlock,
    '── Open in TaskFlow ──',
    issueUrl,
  ]
    .filter((line) => line !== undefined)
    .join('\n');

  await Promise.all(
    userIds.map((toUser) =>
      inboxService
        .createMessage({
          toUser,
          type: 'customer_portal_ticket_created',
          title: messageTitle,
          body,
          meta: {
            url: issueUrl,
            projectId: params.projectId,
            issueKey: params.issueKey,
            customerRequestId: params.customerRequestId,
            kind: 'ticket_from_request',
          },
        })
        .catch((err) => console.error('createMessage customer_portal_ticket_created:', err))
    )
  );
}

/**
 * TaskFlow declined a customer request.
 */
export async function notifyTaskflowRequestDeclined(params: {
  requestId: string;
  title: string;
  description: string;
  type: string;
  priority: string;
  orgName: string;
  projectLabel: string;
  requesterName: string;
  reason?: string;
  teamNote?: string;
  reviewedByName: string;
}): Promise<void> {
  const userIds = await getTaskflowCustomerApproverUserIds();
  if (userIds.length === 0) return;

  const t = params.title.length > 70 ? `${params.title.slice(0, 67)}…` : params.title;
  const messageTitle = `Customer request declined: ${t}`;

  const parts: string[] = [
    'The following customer request was declined by a TaskFlow reviewer. The customer has been informed.',
    '',
    '── Request ──',
    `Title          ${params.title}`,
    `Organisation   ${params.orgName}`,
    `Project        ${params.projectLabel}`,
    `Submitted by   ${params.requesterName}`,
    `Type / Pri.    ${typeLabel(params.type)} · ${priorityLabel(params.priority)}`,
    `Declined by    ${params.reviewedByName}`,
    '',
  ];
  if (params.reason?.trim()) {
    parts.push('── Decline reason (shared with customer) ──', params.reason.trim(), '');
  }
  if (params.teamNote?.trim()) {
    parts.push('── Internal note ──', params.teamNote.trim(), '');
  }
  parts.push('── Description (excerpt) ──', trimDesc(params.description, 1200) || '—');
  const body = parts.join('\n');

  const url = buildCustomerRequestsAdminUrl();
  await Promise.all(
    userIds.map((toUser) =>
      inboxService
        .createMessage({
          toUser,
          type: 'customer_portal_request_declined',
          title: messageTitle,
          body,
          meta: {
            url,
            customerRequestId: params.requestId,
            kind: 'tf_declined',
          },
        })
        .catch((err) => console.error('createMessage customer_portal_request_declined:', err))
    )
  );
}
