import crypto from 'crypto';
import { CrmWebhook } from '../models/crmWebhook.model';
import { CrmDeal } from '../models/crmDeal.model';
import { CrmLead } from '../models/crmLead.model';
import { ApiError } from '../../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crmWorkspace';
import { notifyUser } from '../../notifications/notificationDispatch.service';
import { assertSafeOutboundUrl } from '../../../utils/safeUrl';

export async function listWebhooks(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  return CrmWebhook.find({ taskflowOrganizationId: toOrgOid(orgId) })
    .select('-secret')
    .sort({ createdAt: -1 })
    .lean();
}

export async function createWebhook(workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  let url: string;
  try {
    url = assertSafeOutboundUrl(String(input.url ?? ''), 'Webhook URL');
  } catch (err) {
    throw new ApiError(400, err instanceof Error ? err.message : 'Invalid webhook URL');
  }
  const doc = await CrmWebhook.create({
    taskflowOrganizationId: toOrgOid(orgId),
    name: String(input.name ?? 'Webhook').trim(),
    url,
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
      try {
        assertSafeOutboundUrl(hook.url, 'Webhook URL');
      } catch {
        return;
      }
      const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
      const sig = crypto.createHmac('sha256', hook.secret).update(body).digest('hex');
      await fetch(hook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-TaskFlow-Signature': sig },
        body,
        signal: AbortSignal.timeout(10000),
      });
    })
  );
}


export async function assignLeadRoundRobin(workspaceId: string, leadId: string, assigneeIds: string[]): Promise<void> {
  if (!assigneeIds.length) return;
  const count = await CrmLead.countDocuments({ taskflowOrganizationId: toOrgOid(workspaceId) });
  const assigneeId = assigneeIds[count % assigneeIds.length];
  await CrmLead.findByIdAndUpdate(leadId, { $set: { assigneeId } });
}
