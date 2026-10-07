import mongoose from 'mongoose';
import { Router, type Request, type Response } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireTaskflowUser } from '../../middleware/requireTaskflowUser';
import { requireAnyPermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { MailAccount, MailMessage } from './models/mail.models';
import { connectAccount, updateAccount, syncAccount, sendFromAccount, type LinkType } from './mailSync.service';

/**
 * Sales email sync. Each user connects their own mailbox (IMAP/SMTP); mail to
 * and from CRM contacts/leads is logged on the contact, lead, account and open
 * deals. Access is purely permission based:
 *   mail.mailbox.read   – connect & use your own mailbox
 *   mail.mailbox.send   – send from it
 *   mail.mailbox.manage – see / manage everyone's mailboxes in the workspace
 *   mail.message.read   – read synced CRM emails (own + mailboxes shared with the team)
 *   mail.message.delete – remove a synced email
 */
const P = TASK_FLOW_PERMISSIONS.TASKFLOW.MAIL;
type R = Request & { activeOrganizationId?: string; user?: { id: string; permissions?: string[] } };

const can = (req: R, perm: string) => userHasPermission(req.user?.permissions ?? [], perm);

async function ownedAccount(req: R, id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(400, 'Invalid id');
  const orgOid = toOrgOid(requireWorkspaceId(req.activeOrganizationId));
  const acc = await MailAccount.findOne({ _id: id, taskflowOrganizationId: orgOid }).lean();
  if (!acc) throw new ApiError(404, 'Mailbox not found');
  if (String(acc.userId) !== req.user?.id && !can(req, P.MAILBOX.MANAGE)) throw new ApiError(403, 'Not your mailbox');
  return acc;
}

export const mailRoutes = Router();
mailRoutes.use(authMiddleware, requireTaskflowUser);

const useMailbox = requireAnyPermission([P.MAILBOX.READ, P.MAILBOX.MANAGE]);

mailRoutes.get('/accounts', useMailbox, asyncHandler(async (req: R, res: Response) => {
  const orgOid = toOrgOid(requireWorkspaceId(req.activeOrganizationId));
  const all = req.query.all === '1' && can(req, P.MAILBOX.MANAGE);
  const docs = await MailAccount.find({ taskflowOrganizationId: orgOid, ...(all ? {} : { userId: req.user!.id }) })
    .populate('userId', 'name email')
    .sort({ createdAt: -1 })
    .lean();
  res.json({ success: true, data: docs });
}));

mailRoutes.post('/accounts', useMailbox, asyncHandler(async (req: R, res: Response) => {
  const ws = requireWorkspaceId(req.activeOrganizationId);
  res.status(201).json({ success: true, data: await connectAccount(ws, req.user!.id, req.body ?? {}) });
}));

mailRoutes.patch('/accounts/:id', useMailbox, asyncHandler(async (req: R, res: Response) => {
  await ownedAccount(req, req.params.id);
  res.json({ success: true, data: await updateAccount(req.params.id, req.body ?? {}) });
}));

mailRoutes.delete('/accounts/:id', useMailbox, asyncHandler(async (req: R, res: Response) => {
  await ownedAccount(req, req.params.id);
  await MailAccount.deleteOne({ _id: req.params.id });
  // Synced messages stay on the CRM timeline unless explicitly purged.
  if (req.query.purge === '1') await MailMessage.deleteMany({ mailAccountId: req.params.id });
  res.json({ success: true });
}));

mailRoutes.post('/accounts/:id/sync', useMailbox, asyncHandler(async (req: R, res: Response) => {
  await ownedAccount(req, req.params.id);
  const stored = await syncAccount(req.params.id);
  const acc = await MailAccount.findById(req.params.id).select('lastSyncAt lastError').lean();
  res.json({ success: true, data: { stored, lastSyncAt: acc?.lastSyncAt, lastError: acc?.lastError ?? null } });
}));

mailRoutes.post('/accounts/:id/send', requireAnyPermission([P.MAILBOX.SEND]), asyncHandler(async (req: R, res: Response) => {
  const acc = await ownedAccount(req, req.params.id);
  if (String(acc.userId) !== req.user?.id) throw new ApiError(403, 'You can only send from your own mailbox');
  res.status(201).json({ success: true, data: await sendFromAccount(req.params.id, req.body ?? {}) });
}));

/** Synced emails, optionally for one CRM record (?relatedType=deal&relatedId=…). */
mailRoutes.get('/messages', requireAnyPermission([P.MESSAGE.READ, P.MAILBOX.MANAGE]), asyncHandler(async (req: R, res: Response) => {
  const orgOid = toOrgOid(requireWorkspaceId(req.activeOrganizationId));
  const filter: Record<string, unknown> = { taskflowOrganizationId: orgOid };
  const type = String(req.query.relatedType ?? '') as LinkType;
  const rid = String(req.query.relatedId ?? '');
  if (type && mongoose.Types.ObjectId.isValid(rid)) filter.links = { $elemMatch: { type, id: new mongoose.Types.ObjectId(rid) } };
  if (!can(req, P.MAILBOX.MANAGE)) {
    const shared = await MailAccount.find({ taskflowOrganizationId: orgOid, shareWithTeam: true }).distinct('_id');
    filter.$or = [{ userId: req.user!.id }, { mailAccountId: { $in: shared } }];
  }
  const limit = Math.min(200, Number(req.query.limit) || 50);
  const docs = await MailMessage.find(filter)
    .select(req.query.full === '1' ? '' : '-text')
    .populate('userId', 'name')
    .sort({ date: -1 })
    .limit(limit)
    .lean();
  res.json({ success: true, data: docs });
}));

mailRoutes.get('/messages/:id', requireAnyPermission([P.MESSAGE.READ, P.MAILBOX.MANAGE]), asyncHandler(async (req: R, res: Response) => {
  const orgOid = toOrgOid(requireWorkspaceId(req.activeOrganizationId));
  const msg = await MailMessage.findOne({ _id: req.params.id, taskflowOrganizationId: orgOid }).populate('userId', 'name').lean();
  if (!msg) throw new ApiError(404, 'Email not found');
  const ownerId = String((msg.userId as unknown as { _id?: unknown })?._id ?? msg.userId);
  if (ownerId !== req.user?.id && !can(req, P.MAILBOX.MANAGE)) {
    const acc = await MailAccount.findById(msg.mailAccountId).select('shareWithTeam').lean();
    if (!acc?.shareWithTeam) throw new ApiError(403, 'This mailbox is private');
  }
  res.json({ success: true, data: msg });
}));

mailRoutes.delete('/messages/:id', requireAnyPermission([P.MESSAGE.DELETE]), asyncHandler(async (req: R, res: Response) => {
  const orgOid = toOrgOid(requireWorkspaceId(req.activeOrganizationId));
  const msg = await MailMessage.findOneAndDelete({ _id: req.params.id, taskflowOrganizationId: orgOid });
  if (!msg) throw new ApiError(404, 'Email not found');
  const { CrmActivity } = await import('../crm/models/crmActivity.model');
  await CrmActivity.deleteMany({ mailMessageId: msg._id });
  res.json({ success: true });
}));
