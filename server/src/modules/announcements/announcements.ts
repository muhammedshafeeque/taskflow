import mongoose, { Schema } from 'mongoose';
import { Router, type Request, type Response } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireTaskflowUser } from '../../middleware/requireTaskflowUser';
import { requireAnyPermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { notifyUsers } from '../notifications/domainNotify';

/** Company announcements shown on Home and sent as notifications to the workspace (or chosen roles). */
const announcementSchema = new Schema(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    pinned: { type: Boolean, default: false },
    /** Empty = everyone in the workspace; otherwise only users with these roles. */
    roleIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Role' }], default: [] },
    publishedAt: { type: Date },
    expiresAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
export const Announcement = mongoose.model('Announcement', announcementSchema);

type R = Request & { activeOrganizationId?: string; user?: { id: string; roleId?: string; permissions?: string[] } };
const M = [TASK_FLOW_PERMISSIONS.TASKFLOW.PLATFORM.ANNOUNCEMENT.MANAGE];

async function audience(orgOid: mongoose.Types.ObjectId, roleIds: mongoose.Types.ObjectId[]): Promise<string[]> {
  const members = await OrganizationMember.find({ organization: orgOid, status: 'active' }).populate('user', 'roleId enabled').lean();
  return members
    .map((m) => m.user as unknown as { _id: unknown; roleId?: unknown; enabled?: boolean } | null)
    .filter((u): u is { _id: unknown; roleId?: unknown; enabled?: boolean } => Boolean(u) && u!.enabled !== false)
    .filter((u) => !roleIds.length || roleIds.some((r) => String(r) === String(u.roleId)))
    .map((u) => String(u._id));
}

export const announcementRoutes = Router();
announcementRoutes.use(authMiddleware, requireTaskflowUser);

announcementRoutes.get(
  '/',
  asyncHandler(async (req: R, res: Response) => {
    const orgOid = toOrgOid(requireWorkspaceId(req.activeOrganizationId));
    const now = new Date();
    const manage = req.query.all === '1';
    const docs = await Announcement.find({
      taskflowOrganizationId: orgOid,
      ...(manage ? {} : { publishedAt: { $lte: now }, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }),
    })
      .populate('createdBy', 'name')
      .sort({ pinned: -1, publishedAt: -1, createdAt: -1 })
      .limit(50)
      .lean();
    const visible = manage ? docs : docs.filter((d) => !d.roleIds?.length || d.roleIds.some((r) => String(r) === req.user?.roleId));
    res.json({ success: true, data: visible });
  })
);

announcementRoutes.post(
  '/',
  requireAnyPermission(M),
  asyncHandler(async (req: R, res: Response) => {
    const orgOid = toOrgOid(requireWorkspaceId(req.activeOrganizationId));
    const b = req.body ?? {};
    if (!String(b.title ?? '').trim() || !String(b.body ?? '').trim()) throw new ApiError(400, 'title and body are required');
    const roleIds = (Array.isArray(b.roleIds) ? b.roleIds : []).filter((x: unknown) => mongoose.Types.ObjectId.isValid(String(x))).map((x: unknown) => new mongoose.Types.ObjectId(String(x)));
    const publish = b.publish !== false;
    const doc = await Announcement.create({
      taskflowOrganizationId: orgOid,
      title: String(b.title).trim().slice(0, 150),
      body: String(b.body).slice(0, 20_000),
      pinned: Boolean(b.pinned),
      roleIds,
      publishedAt: publish ? new Date() : undefined,
      expiresAt: b.expiresAt ? new Date(String(b.expiresAt)) : undefined,
      createdBy: new mongoose.Types.ObjectId(req.user!.id),
    });
    if (publish) {
      void audience(orgOid, roleIds).then((users) =>
        notifyUsers(users, 'workspace_announcement', { title: doc.title, body: doc.body.replace(/<[^>]+>/g, '').slice(0, 200), link: '/home' }, req.user!.id)
      );
    }
    res.status(201).json({ success: true, data: doc.toObject() });
  })
);

announcementRoutes.patch(
  '/:id',
  requireAnyPermission(M),
  asyncHandler(async (req: R, res: Response) => {
    const orgOid = toOrgOid(requireWorkspaceId(req.activeOrganizationId));
    const doc = await Announcement.findOne({ _id: req.params.id, taskflowOrganizationId: orgOid });
    if (!doc) throw new ApiError(404, 'Announcement not found');
    const b = req.body ?? {};
    if (typeof b.title === 'string') doc.title = b.title.slice(0, 150);
    if (typeof b.body === 'string') doc.body = b.body.slice(0, 20_000);
    if (typeof b.pinned === 'boolean') doc.pinned = b.pinned;
    if (b.expiresAt !== undefined) doc.expiresAt = b.expiresAt ? new Date(String(b.expiresAt)) : undefined;
    const publishNow = b.publish === true && !doc.publishedAt;
    if (publishNow) doc.publishedAt = new Date();
    await doc.save();
    if (publishNow) {
      void audience(orgOid, doc.roleIds as mongoose.Types.ObjectId[]).then((users) =>
        notifyUsers(users, 'workspace_announcement', { title: doc.title, body: doc.body.replace(/<[^>]+>/g, '').slice(0, 200), link: '/home' }, req.user!.id)
      );
    }
    res.json({ success: true, data: doc.toObject() });
  })
);

announcementRoutes.delete(
  '/:id',
  requireAnyPermission(M),
  asyncHandler(async (req: R, res: Response) => {
    const orgOid = toOrgOid(requireWorkspaceId(req.activeOrganizationId));
    await Announcement.deleteOne({ _id: req.params.id, taskflowOrganizationId: orgOid });
    res.json({ success: true, data: { ok: true } });
  })
);
