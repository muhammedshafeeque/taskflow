import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { Organization } from '../organizations/organization.model';
import { User } from '../auth/user.model';
import { CustomerOrg } from '../customer-portal/customer-org/customerOrg.model';
import { getStorage } from '../../services/storage';
import { PaChatBinding } from './paChatBinding.model';
import { inOrgProjectIds, resolveClientScope, resolveOwnerByPhone } from './paScope';

/** Internal routes are only for the PA (internal key); user JWTs never get here. */
export function requireInternalCaller(req: Request, _res: Response, next: NextFunction): void {
  next(req.paContext ? undefined : new ApiError(403, 'Internal endpoint'));
}

export function requireOwnerActor(req: Request, _res: Response, next: NextFunction): void {
  next(req.paContext?.actor === 'owner' ? undefined : new ApiError(403, 'Owner context required'));
}

/** GET /internal/pa/health — what PA shows as "Connected to Atrium ✓". */
export async function health(req: Request, res: Response) {
  const ctx = req.paContext!;
  const [org, account, onBehalfOf] = await Promise.all([
    Organization.findById(ctx.organizationId).select('_id name').lean(),
    User.findById(ctx.serviceAccountId).select('_id name').lean(),
    ctx.onBehalfOf ? User.findById(ctx.onBehalfOf).select('_id name email').lean() : Promise.resolve(null),
  ]);
  res.json({
    success: true,
    data: {
      connected: true,
      organization: org ? { id: String(org._id), name: org.name } : null,
      serviceAccount: account ? { id: String(account._id), name: account.name } : null,
      actingFor: onBehalfOf ? { id: String(onBehalfOf._id), name: onBehalfOf.name, email: onBehalfOf.email } : null,
      storage: getStorage().name,
      at: new Date().toISOString(),
    },
  });
}

/**
 * POST /internal/pa/resolve-chat { chatId, senderPhone } — owner, client or
 * unknown, decided from Atrium data so PA can route the conversation.
 */
export async function resolveChat(req: Request, res: Response) {
  const { organizationId } = req.paContext!;
  const chatId = String(req.body?.chatId ?? '').trim();
  const senderPhone = String(req.body?.senderPhone ?? '').trim() || undefined;
  if (!chatId) throw new ApiError(400, 'chatId is required');

  const ownerUserId = chatId.endsWith('@g.us') ? null : await resolveOwnerByPhone(organizationId, senderPhone);
  if (ownerUserId) {
    res.json({ success: true, data: { context: 'owner', ownerUserId } });
    return;
  }
  const scope = await resolveClientScope(organizationId, chatId, senderPhone);
  const linked = Boolean(scope.customerOrgId || scope.projectIds.length);
  res.json({
    success: true,
    data: {
      context: linked ? 'client' : 'unknown',
      client: linked
        ? { customerOrgId: scope.customerOrgId, name: scope.customerOrgName, projectIds: scope.projectIds, source: scope.source }
        : null,
    },
  });
}

function toBinding(b: Record<string, unknown>) {
  return {
    chatId: b.chatId,
    label: b.label,
    customerOrgId: b.customerOrgId ? String(b.customerOrgId) : null,
    projectIds: ((b.projectIds as unknown[]) ?? []).map(String),
    updatedAt: b.updatedAt,
  };
}

/** GET /internal/pa/chat-bindings */
export async function listBindings(req: Request, res: Response) {
  const rows = await PaChatBinding.find({ taskflowOrganizationId: req.paContext!.organizationId }).sort({ updatedAt: -1 }).lean();
  res.json({ success: true, data: rows.map((r) => toBinding(r as unknown as Record<string, unknown>)) });
}

/** PUT /internal/pa/chat-bindings/:chatId { customerOrgId?, projectIds?, label? } — owner links a chat to a client. */
export async function upsertBinding(req: Request, res: Response) {
  const { organizationId, serviceAccountId, onBehalfOf } = req.paContext!;
  const chatId = decodeURIComponent(req.params.chatId).trim();
  if (!chatId) throw new ApiError(400, 'chatId is required');
  const body = (req.body ?? {}) as { customerOrgId?: unknown; projectIds?: unknown; label?: unknown };

  let customerOrgId: string | null = null;
  if (body.customerOrgId) {
    const id = String(body.customerOrgId);
    const ok =
      mongoose.Types.ObjectId.isValid(id) &&
      (await CustomerOrg.exists({ _id: id, taskflowOrganizationId: organizationId }));
    if (!ok) throw new ApiError(404, 'Customer org not found in this workspace');
    customerOrgId = id;
  }
  const requested = Array.isArray(body.projectIds) ? body.projectIds.map(String) : [];
  const projectIds = await inOrgProjectIds(organizationId, requested);
  if (projectIds.length !== new Set(requested).size) {
    throw new ApiError(400, 'Every project must belong to this workspace');
  }

  const doc = await PaChatBinding.findOneAndUpdate(
    { taskflowOrganizationId: organizationId, chatId },
    {
      $set: {
        customerOrgId,
        projectIds,
        label: body.label ? String(body.label).slice(0, 200) : undefined,
        updatedBy: onBehalfOf || serviceAccountId,
      },
    },
    { upsert: true, new: true }
  ).lean();
  res.json({ success: true, data: toBinding(doc as unknown as Record<string, unknown>) });
}

/** DELETE /internal/pa/chat-bindings/:chatId */
export async function deleteBinding(req: Request, res: Response) {
  await PaChatBinding.deleteOne({
    taskflowOrganizationId: req.paContext!.organizationId,
    chatId: decodeURIComponent(req.params.chatId).trim(),
  });
  res.json({ success: true, data: { deleted: true } });
}
