import mongoose, { Schema } from 'mongoose';
import { Router, type Request, type Response } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireTaskflowUser } from '../../middleware/requireTaskflowUser';
import { requireAnyPermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { MonitorUptimeCheck, MonitorUptimeSample } from './monitor.models';

/**
 * Public status pages (one per slug) built from uptime checks, with manually
 * posted incidents, plus internal postmortems for incidents / error groups.
 */
const INCIDENT_STATES = ['investigating', 'identified', 'monitoring', 'resolved'] as const;

const statusPageSchema = new Schema(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, match: /^[a-z0-9-]{3,60}$/ },
    title: { type: String, required: true, trim: true },
    description: { type: String },
    logoUrl: { type: String },
    published: { type: Boolean, default: false },
    components: {
      type: [{ _id: false, name: String, checkId: { type: Schema.Types.ObjectId, ref: 'MonitorUptimeCheck' } }],
      default: [],
    },
    incidents: {
      type: [
        {
          title: { type: String, required: true },
          impact: { type: String, enum: ['none', 'minor', 'major', 'critical'], default: 'minor' },
          status: { type: String, enum: INCIDENT_STATES, default: 'investigating' },
          startedAt: { type: Date, default: Date.now },
          resolvedAt: { type: Date },
          updates: { type: [{ _id: false, at: { type: Date, default: Date.now }, status: String, message: String }], default: [] },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);
export const StatusPage = mongoose.model('StatusPage', statusPageSchema);

const postmortemSchema = new Schema(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    monitorProjectId: { type: Schema.Types.ObjectId, ref: 'MonitorProject' },
    errorGroupId: { type: Schema.Types.ObjectId, ref: 'MonitorErrorGroup' },
    statusPageId: { type: Schema.Types.ObjectId, ref: 'StatusPage' },
    incidentId: { type: Schema.Types.ObjectId },
    title: { type: String, required: true, trim: true },
    severity: { type: String, default: 'sev3' },
    startedAt: { type: Date },
    resolvedAt: { type: Date },
    summary: { type: String, default: '' },
    impact: { type: String, default: '' },
    rootCause: { type: String, default: '' },
    resolution: { type: String, default: '' },
    lessons: { type: String, default: '' },
    timeline: { type: [{ _id: false, at: Date, note: String }], default: [] },
    actionItems: {
      type: [{ text: String, ownerId: { type: Schema.Types.ObjectId, ref: 'User' }, issueKey: String, done: { type: Boolean, default: false } }],
      default: [],
    },
    status: { type: String, enum: ['draft', 'in_review', 'published'], default: 'draft' },
    authorId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
export const Postmortem = mongoose.model('Postmortem', postmortemSchema);

type R = Request & { activeOrganizationId?: string; user?: { id: string } };
const M = TASK_FLOW_PERMISSIONS.TASKFLOW.MONITOR;
const org = (req: R) => toOrgOid(requireWorkspaceId(req.activeOrganizationId));
const pick = (b: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
const PAGE_KEYS = ['slug', 'title', 'description', 'logoUrl', 'published', 'components'];
const PM_KEYS = ['monitorProjectId', 'errorGroupId', 'statusPageId', 'incidentId', 'title', 'severity', 'startedAt', 'resolvedAt', 'summary', 'impact', 'rootCause', 'resolution', 'lessons', 'timeline', 'actionItems', 'status'];

export const statusPageRoutes = Router();
statusPageRoutes.use(authMiddleware, requireTaskflowUser, requireAnyPermission([M.STATUS_PAGE.MANAGE]));

statusPageRoutes.get('/', asyncHandler(async (req: R, res: Response) => {
  res.json({ success: true, data: await StatusPage.find({ taskflowOrganizationId: org(req) }).sort({ title: 1 }).lean() });
}));
statusPageRoutes.post('/', asyncHandler(async (req: R, res: Response) => {
  res.status(201).json({ success: true, data: await StatusPage.create({ ...pick(req.body ?? {}, PAGE_KEYS), taskflowOrganizationId: org(req) }) });
}));
statusPageRoutes.patch('/:id', asyncHandler(async (req: R, res: Response) => {
  const doc = await StatusPage.findOneAndUpdate({ _id: req.params.id, taskflowOrganizationId: org(req) }, { $set: pick(req.body ?? {}, PAGE_KEYS) }, { new: true, runValidators: true });
  if (!doc) throw new ApiError(404, 'Status page not found');
  res.json({ success: true, data: doc });
}));
statusPageRoutes.delete('/:id', asyncHandler(async (req: R, res: Response) => {
  await StatusPage.deleteOne({ _id: req.params.id, taskflowOrganizationId: org(req) });
  res.json({ success: true });
}));
/** Open an incident: { title, impact, message } */
statusPageRoutes.post('/:id/incidents', asyncHandler(async (req: R, res: Response) => {
  const { title, impact, message } = req.body ?? {};
  if (!title) throw new ApiError(400, 'title is required');
  const doc = await StatusPage.findOneAndUpdate(
    { _id: req.params.id, taskflowOrganizationId: org(req) },
    { $push: { incidents: { title, impact, status: 'investigating', updates: message ? [{ status: 'investigating', message }] : [] } } },
    { new: true, runValidators: true }
  );
  if (!doc) throw new ApiError(404, 'Status page not found');
  res.status(201).json({ success: true, data: doc });
}));
/** Post an update: { status, message } — status "resolved" closes it. */
statusPageRoutes.post('/:id/incidents/:incidentId/updates', asyncHandler(async (req: R, res: Response) => {
  const { status, message } = req.body ?? {};
  if (!INCIDENT_STATES.includes(status)) throw new ApiError(400, `status must be one of ${INCIDENT_STATES.join(', ')}`);
  const doc = await StatusPage.findOneAndUpdate(
    { _id: req.params.id, taskflowOrganizationId: org(req), 'incidents._id': req.params.incidentId },
    {
      $set: { 'incidents.$.status': status, ...(status === 'resolved' ? { 'incidents.$.resolvedAt': new Date() } : {}) },
      $push: { 'incidents.$.updates': { status, message: message ?? '' } },
    },
    { new: true }
  );
  if (!doc) throw new ApiError(404, 'Incident not found');
  res.json({ success: true, data: doc });
}));

export const postmortemRoutes = Router();
postmortemRoutes.use(authMiddleware, requireTaskflowUser);
postmortemRoutes.get('/', requireAnyPermission([M.POSTMORTEM.READ, M.POSTMORTEM.MANAGE]), asyncHandler(async (req: R, res: Response) => {
  const filter: Record<string, unknown> = { taskflowOrganizationId: org(req) };
  if (req.query.monitorProjectId) filter.monitorProjectId = req.query.monitorProjectId;
  if (req.query.errorGroupId) filter.errorGroupId = req.query.errorGroupId;
  res.json({ success: true, data: await Postmortem.find(filter).populate('authorId', 'name').sort({ createdAt: -1 }).limit(200).lean() });
}));
postmortemRoutes.get('/:id', requireAnyPermission([M.POSTMORTEM.READ, M.POSTMORTEM.MANAGE]), asyncHandler(async (req: R, res: Response) => {
  const doc = await Postmortem.findOne({ _id: req.params.id, taskflowOrganizationId: org(req) }).populate('authorId', 'name').populate('actionItems.ownerId', 'name').lean();
  if (!doc) throw new ApiError(404, 'Postmortem not found');
  res.json({ success: true, data: doc });
}));
postmortemRoutes.post('/', requireAnyPermission([M.POSTMORTEM.MANAGE]), asyncHandler(async (req: R, res: Response) => {
  const doc = await Postmortem.create({ ...pick(req.body ?? {}, PM_KEYS), taskflowOrganizationId: org(req), authorId: req.user?.id });
  res.status(201).json({ success: true, data: doc });
}));
postmortemRoutes.patch('/:id', requireAnyPermission([M.POSTMORTEM.MANAGE]), asyncHandler(async (req: R, res: Response) => {
  const doc = await Postmortem.findOneAndUpdate({ _id: req.params.id, taskflowOrganizationId: org(req) }, { $set: pick(req.body ?? {}, PM_KEYS) }, { new: true, runValidators: true });
  if (!doc) throw new ApiError(404, 'Postmortem not found');
  res.json({ success: true, data: doc });
}));
postmortemRoutes.delete('/:id', requireAnyPermission([M.POSTMORTEM.MANAGE]), asyncHandler(async (req: R, res: Response) => {
  await Postmortem.deleteOne({ _id: req.params.id, taskflowOrganizationId: org(req) });
  res.json({ success: true });
}));

/** Public, unauthenticated: GET /api/public/status/:slug */
export const publicStatusRoutes = Router();
publicStatusRoutes.get('/:slug', asyncHandler(async (req: Request, res: Response) => {
  const page = await StatusPage.findOne({ slug: String(req.params.slug).toLowerCase(), published: true }).lean();
  if (!page) throw new ApiError(404, 'Status page not found');
  const since = new Date(Date.now() - 14 * 86_400_000);
  const checkIds = page.components.map((c) => c.checkId).filter(Boolean) as mongoose.Types.ObjectId[];
  const [checks, stats, latest] = await Promise.all([
    MonitorUptimeCheck.find({ _id: { $in: checkIds }, taskflowOrganizationId: page.taskflowOrganizationId }).select('_id name').lean(),
    MonitorUptimeSample.aggregate<{ _id: mongoose.Types.ObjectId; total: number; ok: number }>([
      { $match: { checkId: { $in: checkIds }, timestamp: { $gte: since } } },
      { $group: { _id: '$checkId', total: { $sum: 1 }, ok: { $sum: { $cond: ['$ok', 1, 0] } } } },
    ]),
    MonitorUptimeSample.aggregate<{ _id: mongoose.Types.ObjectId; ok: boolean; at: Date }>([
      { $match: { checkId: { $in: checkIds } } },
      { $sort: { timestamp: -1 } },
      { $group: { _id: '$checkId', ok: { $first: '$ok' }, at: { $first: '$timestamp' } } },
    ]),
  ]);
  const known = new Set(checks.map((c) => String(c._id)));
  const components = page.components
    .filter((c) => c.checkId && known.has(String(c.checkId)))
    .map((c) => {
      const s = stats.find((x) => String(x._id) === String(c.checkId));
      const l = latest.find((x) => String(x._id) === String(c.checkId));
      return {
        name: c.name || checks.find((x) => String(x._id) === String(c.checkId))?.name,
        status: l ? (l.ok ? 'operational' : 'down') : 'unknown',
        uptimePct14d: s?.total ? Math.round((s.ok / s.total) * 10000) / 100 : null,
        checkedAt: l?.at ?? null,
      };
    });
  const incidents = page.incidents
    .filter((i) => i.status !== 'resolved' || (i.resolvedAt && i.resolvedAt > since))
    .sort((a, b) => +new Date(b.startedAt ?? 0) - +new Date(a.startedAt ?? 0));
  const open = incidents.filter((i) => i.status !== 'resolved');
  const overall = open.some((i) => i.impact === 'critical' || i.impact === 'major') || components.some((c) => c.status === 'down')
    ? 'major_outage'
    : open.length
      ? 'degraded'
      : 'operational';
  res.setHeader('Cache-Control', 'public, max-age=30');
  res.json({ success: true, data: { title: page.title, description: page.description, logoUrl: page.logoUrl, overall, components, incidents } });
}));
