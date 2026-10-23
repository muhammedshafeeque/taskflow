import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { Project } from '../projects/project.model';
import { Issue } from '../issues/issue.model';
import * as issuesService from '../issues/issues.service';
import { CustomerOrg } from '../customer-portal/customer-org/customerOrg.model';
import { ServiceTicket } from './models/serviceTicket.model';
import * as ticketsService from './tickets.service';

/** Ticket shape the PA sees: no internal comments, no AI analysis blobs. */
export function toPaTicketSummary(t: Record<string, unknown>) {
  const linked = t.linkedIssueId as { _id?: unknown; key?: string } | null | undefined;
  const issueKey = linked && typeof linked === 'object' && linked.key ? String(linked.key) : undefined;
  const project = t.projectId as { _id?: unknown; name?: string; key?: string } | string | null | undefined;
  const projectId = project && typeof project === 'object' ? String(project._id ?? '') : project ? String(project) : undefined;
  return {
    id: String(t._id),
    /** Human-readable Project Management ticket id (e.g. SDFSDF-6) */
    key: issueKey || String(t._id),
    issueKey,
    linkedIssueId: linked?._id ? String(linked._id) : undefined,
    subject: t.subject,
    description: t.description,
    status: t.status,
    priority: t.priority,
    projectId,
    projectName: project && typeof project === 'object' ? project.name : undefined,
    queue: t.queue,
    updatedAt: t.updatedAt,
  };
}

const PRIORITY_TO_ISSUE: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Highest',
};

export type CreatePaTicketInput = {
  projectId: string;
  subject: string;
  description?: string;
  priority?: string;
  issueType?: string;
  workClassification?: string;
  customerOrgId?: string | null;
  whatsappGroupId?: string;
  whatsappMessageId?: string;
  supportConversationId?: string;
  aiAnalysis?: unknown;
  qaAnalysis?: unknown;
  /** Also create a linked project Issue (default true). */
  createIssue?: boolean;
};

/** Service Desk ticket (+ linked PM issue) raised by the WhatsApp PA. */
export async function createPaTicket(organizationId: string, actorUserId: string, input: CreatePaTicketInput) {
  const subject = String(input.subject ?? '').trim();
  if (!subject) throw new ApiError(400, 'subject is required');
  if (!mongoose.Types.ObjectId.isValid(input.projectId)) throw new ApiError(400, 'projectId is required');

  const project = await Project.findOne({ _id: input.projectId, taskflowOrganizationId: organizationId })
    .select('_id lead key')
    .lean();
  if (!project) throw new ApiError(404, 'Project not found for organization');

  let linkedIssueId: string | undefined;
  let linkedIssueKey: string | undefined;

  if (input.createIssue !== false) {
    const reporterId = String(project.lead || '');
    if (!mongoose.Types.ObjectId.isValid(reporterId)) {
      throw new ApiError(400, 'Project has no lead user to act as issue reporter');
    }
    const qa = (input.qaAnalysis || {}) as { issue?: { type?: string }; classification?: string };
    const typeRaw = String(input.issueType || qa.issue?.type || qa.classification || 'BUG').toUpperCase();
    const issueType = typeRaw.includes('FEATURE') ? 'Story' : typeRaw.includes('CHANGE') ? 'Task' : 'Bug';
    const prio = String(input.priority || 'medium').toLowerCase();
    const issue = (await issuesService.create(
      {
        title: subject,
        description: String(input.description || ''),
        type: issueType,
        priority: PRIORITY_TO_ISSUE[prio] || 'Medium',
        project: input.projectId,
        reporter: reporterId,
        labels: ['whatsapp-pa', 'customer-support'],
      },
      reporterId
    )) as { _id?: string; id?: string; key?: string };
    linkedIssueId = String(issue._id || issue.id || '');
    linkedIssueKey = issue.key ? String(issue.key) : undefined;
  }

  // The client's CRM account lets the ticket inherit their contracted SLA.
  const customerOrg = input.customerOrgId
    ? await CustomerOrg.findOne({ _id: input.customerOrgId, taskflowOrganizationId: organizationId })
        .select('crmAccountId')
        .lean()
    : null;

  const data = (await ticketsService.createTicket(
    organizationId,
    {
      subject,
      description: input.description,
      priority: input.priority ?? 'medium',
      queue: 'whatsapp_pa',
      projectId: input.projectId,
      customerOrgId: input.customerOrgId || undefined,
      accountId: customerOrg?.crmAccountId || undefined,
      workClassification: input.workClassification,
      source: 'whatsapp_pa',
      whatsappGroupId: input.whatsappGroupId,
      whatsappMessageId: input.whatsappMessageId,
      supportConversationId: input.supportConversationId,
      aiAnalysis: input.aiAnalysis,
      qaAnalysis: input.qaAnalysis,
      linkedIssueId,
    },
    actorUserId
  )) as { _id?: unknown };

  if (linkedIssueId && data?._id) {
    await Promise.all([
      Issue.findByIdAndUpdate(linkedIssueId, { $set: { linkedServiceTicketId: data._id } }),
      ServiceTicket.findByIdAndUpdate(data._id, { $set: { linkedIssueId } }),
    ]);
  }

  return {
    ...data,
    id: String(data?._id || ''),
    key: linkedIssueKey || String(data?._id || ''),
    linkedIssueId,
    linkedIssueKey,
  };
}

/**
 * Find a ticket by Mongo id or linked issue key (e.g. SDFSDF-6), limited by
 * `scope` (a Mongo filter) so callers can enforce client visibility.
 */
export async function findPaTicket(organizationId: string, ref: string, scope: Record<string, unknown> = {}) {
  const trimmed = String(ref || '').trim();
  if (!trimmed) return null;
  const base = { taskflowOrganizationId: organizationId, ...scope };
  if (mongoose.Types.ObjectId.isValid(trimmed) && trimmed.length === 24) {
    const byId = await ServiceTicket.findOne({ ...base, _id: trimmed }).populate('linkedIssueId', 'key').lean();
    if (byId) return byId;
  }
  const issues = await Issue.find({ key: trimmed.toUpperCase() }).select('_id').lean();
  if (!issues.length) return null;
  return ServiceTicket.findOne({ ...base, linkedIssueId: { $in: issues.map((i) => i._id) } })
    .populate('linkedIssueId', 'key')
    .lean();
}
