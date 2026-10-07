import mongoose, { Schema } from 'mongoose';
import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { requireProjectPermission } from '../../middleware/requireProjectPermission';
import { customerAuthMiddleware } from '../customer-portal/middleware/customerAuth.middleware';
import { PROJECT_PERMISSIONS } from '../../shared/constants/permissions';
import { Issue } from '../issues/issue.model';
import { Sprint } from '../sprints/sprint.model';
import { Project } from './project.model';
import { getClosedStatusNamesFromStatuses } from './statusClassification';
import { CustomerProjectMapping } from '../customer-portal/customer-project-mapping/customerProjectMapping.model';
import { getAiStatus, aiComplete } from '../../services/ai.service';
import { notifyUsers } from '../notifications/domainNotify';

// ── Models ───────────────────────────────────────────────────────────────

const riskSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String },
    category: { type: String, trim: true },
    /** 1 (rare) – 5 (almost certain) */
    probability: { type: Number, min: 1, max: 5, default: 3 },
    /** 1 (minor) – 5 (severe) */
    impact: { type: Number, min: 1, max: 5, default: 3 },
    status: { type: String, enum: ['open', 'mitigating', 'closed', 'occurred'], default: 'open', index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User' },
    mitigation: { type: String },
    reviewDate: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
export const ProjectRisk = mongoose.model('ProjectRisk', riskSchema);

const statusReportSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    title: { type: String, required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    health: { type: String, enum: ['green', 'amber', 'red'], default: 'green' },
    summary: { type: String, default: '' },
    accomplishments: { type: String, default: '' },
    nextSteps: { type: String, default: '' },
    risksAndIssues: { type: String, default: '' },
    /** Snapshot numbers at the time of writing. */
    metrics: { type: Schema.Types.Mixed, default: {} },
    /** Visible to the client in the customer portal once published. */
    shareWithCustomer: { type: Boolean, default: false },
    publishedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
export const ProjectStatusReport = mongoose.model('ProjectStatusReport', statusReportSchema);

type R = Request & { user?: { id: string }; params: Record<string, string> };
const ok = (res: Response, data: unknown) => res.json({ success: true, data });
const RK = PROJECT_PERMISSIONS.RISK.RISK;
const SR = PROJECT_PERMISSIONS.STATUS_REPORT.STATUS_REPORT;

async function metricsFor(projectId: string, from: Date, to: Date) {
  const project = await Project.findById(projectId).select('statuses').lean();
  const closed = getClosedStatusNamesFromStatuses(project?.statuses);
  const [completed, created, open, overdue, activeSprint, risks] = await Promise.all([
    Issue.countDocuments({ project: projectId, status: { $in: closed }, updatedAt: { $gte: from, $lte: to } }),
    Issue.countDocuments({ project: projectId, createdAt: { $gte: from, $lte: to } }),
    Issue.countDocuments({ project: projectId, status: { $nin: closed } }),
    Issue.countDocuments({ project: projectId, status: { $nin: closed }, dueDate: { $lt: new Date() } }),
    Sprint.findOne({ project: projectId, status: 'active' }).select('name endDate').lean(),
    ProjectRisk.countDocuments({ project: projectId, status: { $in: ['open', 'mitigating'] } }),
  ]);
  let sprintProgress: number | null = null;
  if (activeSprint) {
    const [total, done] = await Promise.all([
      Issue.countDocuments({ sprint: activeSprint._id }),
      Issue.countDocuments({ sprint: activeSprint._id, status: { $in: closed } }),
    ]);
    sprintProgress = total ? Math.round((done / total) * 100) : 0;
  }
  return { completed, created, open, overdue, openRisks: risks, activeSprint: activeSprint?.name ?? null, sprintProgress };
}

/** Project-member routes, mounted at /projects/:id/governance. */
export const governanceRouter = Router({ mergeParams: true });
const g = governanceRouter;

g.get('/risks', requireProjectPermission(RK.READ), asyncHandler(async (req: R, res) => {
  ok(res, await ProjectRisk.find({ project: req.params.id }).populate('ownerId', 'name').sort({ status: 1, updatedAt: -1 }).lean());
}));

g.post('/risks', requireProjectPermission(RK.MANAGE), asyncHandler(async (req: R, res) => {
  const b = req.body ?? {};
  if (!String(b.title ?? '').trim()) throw new ApiError(400, 'Title is required');
  const risk = await ProjectRisk.create({
    project: req.params.id,
    title: String(b.title).trim().slice(0, 200),
    description: b.description ? String(b.description).slice(0, 5000) : undefined,
    category: b.category ? String(b.category).slice(0, 60) : undefined,
    probability: Math.min(5, Math.max(1, Number(b.probability) || 3)),
    impact: Math.min(5, Math.max(1, Number(b.impact) || 3)),
    ownerId: b.ownerId && mongoose.Types.ObjectId.isValid(b.ownerId) ? b.ownerId : undefined,
    mitigation: b.mitigation ? String(b.mitigation).slice(0, 5000) : undefined,
    reviewDate: b.reviewDate ? new Date(b.reviewDate) : undefined,
    createdBy: req.user!.id,
  });
  if (risk.ownerId) void notifyUsers([risk.ownerId], 'task_assigned', { title: `Risk assigned: ${risk.title}`, link: `/projects/${req.params.id}/risks` }, req.user!.id);
  ok(res, risk.toObject());
}));

g.patch('/risks/:riskId', requireProjectPermission(RK.MANAGE), asyncHandler(async (req: R, res) => {
  const risk = await ProjectRisk.findOne({ _id: req.params.riskId, project: req.params.id });
  if (!risk) throw new ApiError(404, 'Risk not found');
  const b = req.body ?? {};
  for (const k of ['title', 'description', 'category', 'mitigation'] as const) if (typeof b[k] === 'string') risk.set(k, b[k].slice(0, 5000));
  for (const k of ['probability', 'impact'] as const) if (b[k] !== undefined) risk.set(k, Math.min(5, Math.max(1, Number(b[k]))));
  if (['open', 'mitigating', 'closed', 'occurred'].includes(b.status)) risk.status = b.status;
  if (b.ownerId !== undefined) risk.set('ownerId', b.ownerId || undefined);
  if (b.reviewDate !== undefined) risk.set('reviewDate', b.reviewDate ? new Date(b.reviewDate) : undefined);
  await risk.save();
  ok(res, risk.toObject());
}));

g.delete('/risks/:riskId', requireProjectPermission(RK.MANAGE), asyncHandler(async (req: R, res) => {
  await ProjectRisk.deleteOne({ _id: req.params.riskId, project: req.params.id });
  ok(res, { ok: true });
}));

g.get('/status-reports', requireProjectPermission(SR.READ), asyncHandler(async (req: R, res) => {
  ok(res, await ProjectStatusReport.find({ project: req.params.id }).populate('createdBy', 'name').sort({ periodEnd: -1 }).limit(50).lean());
}));

/** Draft a report: fills the numbers (and, if AI is configured, a first-pass summary). */
g.post('/status-reports/draft', requireProjectPermission(SR.MANAGE), asyncHandler(async (req: R, res) => {
  const to = req.body?.periodEnd ? new Date(req.body.periodEnd) : new Date();
  const from = req.body?.periodStart ? new Date(req.body.periodStart) : new Date(to.getTime() - 7 * 86_400_000);
  const metrics = await metricsFor(req.params.id, from, to);
  const health = metrics.overdue > 5 || metrics.openRisks > 3 ? 'red' : metrics.overdue > 0 || metrics.openRisks > 0 ? 'amber' : 'green';
  let summary = '';
  if (getAiStatus().enabled) {
    const done = await Issue.find({ project: req.params.id, updatedAt: { $gte: from, $lte: to } }).select('key title status').limit(40).lean();
    const risks = await ProjectRisk.find({ project: req.params.id, status: { $in: ['open', 'mitigating'] } }).select('title probability impact').lean();
    summary = await aiComplete({
      system: 'Write a short, factual client-facing weekly project status summary (4–6 sentences). Use only the data given.',
      user: `Metrics: ${JSON.stringify(metrics)}\nRecently updated issues:\n${done.map((i) => `- ${i.key} ${i.title} (${i.status})`).join('\n')}\nOpen risks:\n${risks.map((r) => `- ${r.title} (P${r.probability}/I${r.impact})`).join('\n') || 'none'}`,
      maxTokens: 800,
    }).catch(() => '');
  }
  ok(res, { periodStart: from, periodEnd: to, metrics, health, summary });
}));

g.post('/status-reports', requireProjectPermission(SR.MANAGE), asyncHandler(async (req: R, res) => {
  const b = req.body ?? {};
  const from = new Date(b.periodStart);
  const to = new Date(b.periodEnd);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new ApiError(400, 'Valid period required');
  const report = await ProjectStatusReport.create({
    project: req.params.id,
    title: String(b.title ?? `Status ${to.toDateString()}`).slice(0, 150),
    periodStart: from,
    periodEnd: to,
    health: ['green', 'amber', 'red'].includes(b.health) ? b.health : 'green',
    summary: String(b.summary ?? '').slice(0, 10_000),
    accomplishments: String(b.accomplishments ?? '').slice(0, 10_000),
    nextSteps: String(b.nextSteps ?? '').slice(0, 10_000),
    risksAndIssues: String(b.risksAndIssues ?? '').slice(0, 10_000),
    metrics: b.metrics ?? (await metricsFor(req.params.id, from, to)),
    shareWithCustomer: Boolean(b.shareWithCustomer),
    publishedAt: b.publish ? new Date() : undefined,
    createdBy: req.user!.id,
  });
  ok(res, report.toObject());
}));

g.patch('/status-reports/:reportId', requireProjectPermission(SR.MANAGE), asyncHandler(async (req: R, res) => {
  const report = await ProjectStatusReport.findOne({ _id: req.params.reportId, project: req.params.id });
  if (!report) throw new ApiError(404, 'Report not found');
  const b = req.body ?? {};
  for (const k of ['title', 'summary', 'accomplishments', 'nextSteps', 'risksAndIssues'] as const) if (typeof b[k] === 'string') report.set(k, b[k].slice(0, 10_000));
  if (['green', 'amber', 'red'].includes(b.health)) report.health = b.health;
  if (typeof b.shareWithCustomer === 'boolean') report.shareWithCustomer = b.shareWithCustomer;
  if (b.publish === true && !report.publishedAt) report.publishedAt = new Date();
  await report.save();
  ok(res, report.toObject());
}));

/** Customer portal: published, shared reports for projects mapped to the customer's organisation. */
export const customerStatusReportRoutes = Router();
customerStatusReportRoutes.get(
  '/',
  customerAuthMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const cu = (req as Request & { customerUser?: { orgId: string } }).customerUser!;
    const projectIds = await CustomerProjectMapping.find({ customerOrgId: cu.orgId, status: 'active' }).distinct('projectId');
    const filter: Record<string, unknown> = { project: { $in: projectIds }, shareWithCustomer: true, publishedAt: { $ne: null } };
    if (req.query.projectId) {
      if (!projectIds.some((p) => String(p) === String(req.query.projectId))) throw new ApiError(404, 'Project not found');
      filter.project = req.query.projectId;
    }
    ok(res, await ProjectStatusReport.find(filter).select('-createdBy').populate('project', 'name key').sort({ periodEnd: -1 }).limit(50).lean());
  })
);
