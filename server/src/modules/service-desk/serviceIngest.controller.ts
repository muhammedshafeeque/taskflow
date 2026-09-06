import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { Project } from '../projects/project.model';
import { Issue } from '../issues/issue.model';
import * as issuesService from '../issues/issues.service';
import { ServiceTicket } from './models/serviceTicket.model';
import * as ticketsService from './tickets.service';

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

function parseProjectIds(req: Request): string[] {
  const raw =
    String(req.query.projectIds || '') ||
    String((req.body as { projectIds?: string })?.projectIds || '');
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((id) => mongoose.Types.ObjectId.isValid(id));
}

/** GET /service/ingest/project-context?projectIds=a,b */
export async function ingestProjectContext(req: Request, res: Response) {
  assertPaIngestSecret(req);
  const orgId = resolvePaOrganizationId(req);
  const projectIds = parseProjectIds(req);
  if (!projectIds.length) {
    res.json({ success: true, data: { projects: [], tickets: [], recentIssues: [] } });
    return;
  }

  const oidList = projectIds.map((id) => new mongoose.Types.ObjectId(id));
  const [projects, tickets, recentIssues] = await Promise.all([
    Project.find({
      _id: { $in: oidList },
      taskflowOrganizationId: orgId,
    })
      .select('_id name key description')
      .lean(),
    ServiceTicket.find({
      taskflowOrganizationId: orgId,
      projectId: { $in: oidList },
      status: { $in: ['open', 'pending', 'in_progress'] },
    })
      .select(
        '_id subject description status priority projectId queue linkedIssueId source'
      )
      .populate('linkedIssueId', 'key title')
      .sort({ updatedAt: -1 })
      .limit(40)
      .lean(),
    Issue.find({ project: { $in: oidList } })
      .select('_id key title status')
      .sort({ updatedAt: -1 })
      .limit(30)
      .lean(),
  ]);

  res.json({
    success: true,
    data: {
      projects: projects.map((p) => ({
        id: String(p._id),
        name: p.name,
        key: p.key,
        description: p.description,
      })),
      tickets: tickets.map((t) => {
        const linked = t.linkedIssueId as
          | { _id?: unknown; key?: string; title?: string }
          | null
          | undefined;
        const issueKey =
          linked && typeof linked === 'object' && linked.key
            ? String(linked.key)
            : undefined;
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
          projectId: t.projectId ? String(t.projectId) : undefined,
          queue: t.queue,
        };
      }),
      recentIssues: recentIssues.map((i) => ({
        id: String(i._id),
        key: i.key,
        title: i.title,
        status: i.status,
      })),
    },
  });
}

/** GET /service/ingest/tickets?projectId= */
export async function ingestListTickets(req: Request, res: Response) {
  assertPaIngestSecret(req);
  const orgId = resolvePaOrganizationId(req);
  const projectId = String(req.query.projectId || '').trim();
  const filter: Record<string, unknown> = {
    taskflowOrganizationId: orgId,
    status: { $in: ['open', 'pending', 'in_progress'] },
  };
  if (projectId && mongoose.Types.ObjectId.isValid(projectId)) {
    filter.projectId = projectId;
  }
  const tickets = await ServiceTicket.find(filter)
    .select('_id subject description status priority projectId queue linkedIssueId')
    .populate('linkedIssueId', 'key title')
    .sort({ updatedAt: -1 })
    .limit(50)
    .lean();
  res.json({
    success: true,
    data: tickets.map((t) => {
      const linked = t.linkedIssueId as
        | { _id?: unknown; key?: string }
        | null
        | undefined;
      const issueKey =
        linked && typeof linked === 'object' && linked.key
          ? String(linked.key)
          : undefined;
      return {
        id: String(t._id),
        key: issueKey || String(t._id),
        issueKey,
        linkedIssueId: linked?._id ? String(linked._id) : undefined,
        subject: t.subject,
        description: t.description,
        status: t.status,
        priority: t.priority,
        projectId: t.projectId ? String(t.projectId) : undefined,
        queue: t.queue,
      };
    }),
  });
}

/** POST /service/ingest/tickets — also creates a linked project Issue by default. */
export async function ingestCreateTicket(req: Request, res: Response) {
  assertPaIngestSecret(req);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const orgId = resolvePaOrganizationId(req, body);
  const subject = String(body.subject ?? '').trim();
  if (!subject) throw new ApiError(400, 'subject is required');

  const projectId = body.projectId ? String(body.projectId) : '';
  const createIssue =
    body.createIssue !== false &&
    body.createIssue !== 'false' &&
    Boolean(projectId && mongoose.Types.ObjectId.isValid(projectId));

  let linkedIssueId: string | undefined;
  let linkedIssueKey: string | undefined;

  if (createIssue) {
    const project = await Project.findOne({
      _id: projectId,
      taskflowOrganizationId: orgId,
    })
      .select('_id lead key')
      .lean();
    if (!project) {
      throw new ApiError(404, 'Project not found for organization');
    }
    const reporterId = String(project.lead || '');
    if (!reporterId || !mongoose.Types.ObjectId.isValid(reporterId)) {
      throw new ApiError(400, 'Project has no lead user to act as issue reporter');
    }

    const qa = (body.qaAnalysis || {}) as { issue?: { type?: string }; classification?: string };
    const issueTypeRaw = String(
      body.issueType || qa.issue?.type || qa.classification || 'BUG'
    ).toUpperCase();
    const issueType =
      issueTypeRaw.includes('FEATURE')
        ? 'Story'
        : issueTypeRaw.includes('CHANGE')
          ? 'Task'
          : 'Bug';

    const priorityMap: Record<string, string> = {
      low: 'Low',
      medium: 'Medium',
      high: 'High',
      urgent: 'Highest',
    };
    const prio = String(body.priority || 'medium').toLowerCase();

    const issue = (await issuesService.create(
      {
        title: subject,
        description: String(body.description || ''),
        type: issueType,
        priority: priorityMap[prio] || 'Medium',
        project: projectId,
        reporter: reporterId,
        labels: ['whatsapp-pa', 'customer-support'],
      },
      reporterId
    )) as { _id?: string; id?: string; key?: string };

    linkedIssueId = String(issue._id || issue.id || '');
    linkedIssueKey = issue.key ? String(issue.key) : undefined;
  }

  const data = await ticketsService.createTicket(
    orgId,
    {
      subject,
      description: body.description,
      priority: body.priority ?? 'medium',
      queue: body.queue ?? 'whatsapp_pa',
      projectId: body.projectId,
      workClassification: body.workClassification,
      source: body.source ?? 'whatsapp_pa',
      whatsappGroupId: body.whatsappGroupId,
      whatsappMessageId: body.whatsappMessageId,
      supportConversationId: body.supportConversationId,
      aiAnalysis: body.aiAnalysis,
      qaAnalysis: body.qaAnalysis,
      linkedIssueId,
    },
    'system'
  );

  if (linkedIssueId && data && (data as { _id?: unknown })._id) {
    await Issue.findByIdAndUpdate(linkedIssueId, {
      $set: { linkedServiceTicketId: (data as { _id: unknown })._id },
    });
    await ServiceTicket.findByIdAndUpdate((data as { _id: unknown })._id, {
      $set: { linkedIssueId },
    });
  }

  res.status(201).json({
    success: true,
    data: {
      ...data,
      id: String((data as { _id?: unknown })._id || ''),
      key: linkedIssueKey || String((data as { _id?: unknown })._id || ''),
      linkedIssueId,
      linkedIssueKey,
    },
  });
}

/** Resolve ServiceTicket by Mongo id or linked Issue key (e.g. SDFSDF-6). */
async function resolveServiceTicketRef(orgId: string, ref: string) {
  const trimmed = String(ref || '').trim();
  if (!trimmed) return null;

  if (mongoose.Types.ObjectId.isValid(trimmed) && trimmed.length === 24) {
    const byId = await ServiceTicket.findOne({
      _id: trimmed,
      taskflowOrganizationId: orgId,
    })
      .populate('linkedIssueId', 'key')
      .lean();
    if (byId) return byId;
  }

  const issue = await Issue.findOne({ key: trimmed.toUpperCase() })
    .select('_id key')
    .lean();
  if (!issue) return null;

  return ServiceTicket.findOne({
    taskflowOrganizationId: orgId,
    linkedIssueId: issue._id,
  })
    .populate('linkedIssueId', 'key')
    .lean();
}

/** PATCH /service/ingest/tickets/:id — id may be Mongo id or issue key (SDFSDF-6). */
export async function ingestPatchTicket(req: Request, res: Response) {
  assertPaIngestSecret(req);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const orgId = resolvePaOrganizationId(req, body);
  const ref = decodeURIComponent(req.params.id);

  const ticket = await resolveServiceTicketRef(orgId, ref);
  if (!ticket) throw new ApiError(404, 'Ticket not found');
  const id = String(ticket._id);
  const linked = ticket.linkedIssueId as { key?: string } | null | undefined;
  const issueKey = linked?.key ? String(linked.key) : undefined;

  const comment = String(body.comment ?? body.body ?? '').trim();
  if (comment) {
    const data = await ticketsService.addComment(
      id,
      orgId,
      { body: comment, internal: body.internal !== false },
      { name: 'QA Lead Agent' }
    );
    if (body.whatsappMessageId || body.whatsappGroupId) {
      await ServiceTicket.updateOne(
        { _id: id, taskflowOrganizationId: orgId },
        {
          $set: {
            ...(body.whatsappMessageId
              ? { whatsappMessageId: String(body.whatsappMessageId) }
              : {}),
            ...(body.whatsappGroupId
              ? { whatsappGroupId: String(body.whatsappGroupId) }
              : {}),
          },
        }
      );
    }
    res.json({
      success: true,
      data: {
        ...((data as object) || {}),
        id,
        key: issueKey || id,
        issueKey,
      },
    });
    return;
  }

  throw new ApiError(400, 'comment is required');
}
