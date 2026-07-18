import crypto from 'crypto';
import { CrmWebhook } from '../models/crmWebhook.model';
import { CrmDeal } from '../models/crmDeal.model';
import { CrmLead } from '../models/crmLead.model';
import { ApiError } from '../../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crmWorkspace';
import { notifyUser } from '../../notifications/notificationDispatch.service';

export async function listWebhooks(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  return CrmWebhook.find({ taskflowOrganizationId: toOrgOid(orgId) })
    .select('-secret')
    .sort({ createdAt: -1 })
    .lean();
}

export async function createWebhook(workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const doc = await CrmWebhook.create({
    taskflowOrganizationId: toOrgOid(orgId),
    name: String(input.name ?? 'Webhook').trim(),
    url: String(input.url ?? '').trim(),
    events: input.events ?? [],
    secret: crypto.randomBytes(24).toString('hex'),
    enabled: true,
  });
  const obj = doc.toObject();
  return { ...obj, secret: doc.secret };
}

export async function deleteWebhook(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const deleted = await CrmWebhook.findOneAndDelete({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!deleted) throw new ApiError(404, 'Webhook not found');
  return { ok: true };
}

export async function dispatchWebhook(
  workspaceId: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const hooks = await CrmWebhook.find({
    taskflowOrganizationId: toOrgOid(workspaceId),
    enabled: true,
    events: event,
  }).lean();
  await Promise.allSettled(
    hooks.map(async (hook) => {
      const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
      const sig = crypto.createHmac('sha256', hook.secret).update(body).digest('hex');
      await fetch(hook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-TaskFlow-Signature': sig },
        body,
      });
    })
  );
}

export async function runStaleDealAlerts(workspaceId: string): Promise<number> {
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const stale = await CrmDeal.find({
    taskflowOrganizationId: toOrgOid(workspaceId),
    status: 'open',
    updatedAt: { $lt: cutoff },
    ownerId: { $exists: true },
  }).lean();
  for (const deal of stale) {
    if (deal.ownerId) {
      await notifyUser({
        userId: String(deal.ownerId),
        eventKey: 'system_alert',
        title: 'Stale deal',
        body: `Deal "${deal.title}" has had no activity for 14+ days.`,
        link: `/crm/deals`,
      }).catch(() => undefined);
    }
  }
  return stale.length;
}

export async function assignLeadRoundRobin(workspaceId: string, leadId: string, assigneeIds: string[]): Promise<void> {
  if (!assigneeIds.length) return;
  const count = await CrmLead.countDocuments({ taskflowOrganizationId: toOrgOid(workspaceId) });
  const assigneeId = assigneeIds[count % assigneeIds.length];
  await CrmLead.findByIdAndUpdate(leadId, { $set: { assigneeId } });
}
