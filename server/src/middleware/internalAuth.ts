import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { INTERNAL_KEY_HEADER, isValidInternalKey } from '../config/internalSecret';
import { ApiError } from '../utils/ApiError';
import { Organization } from '../modules/organizations/organization.model';
import { User } from '../modules/auth/user.model';
import { OrganizationMember } from '../modules/organizations/organizationMember.model';
import {
  ensurePaServiceAccount,
  PA_ACTOR_LABEL,
  resolveDefaultOrganizationId,
} from '../modules/internal/paServiceAccount';
import { PA_OWNER_PERMISSION, resolveClientScope } from '../modules/internal/paScope';
import { logAudit } from '../modules/auditLogs/logAudit';
import { ALL_PROJECT_PERMISSIONS, ALL_TASK_FLOW_PERMISSIONS } from '../shared/constants/permissions';
import { userHasPermission } from '../shared/constants/legacyPermissionMap';
import type { AuthPayload, PaActor, PaRequestContext } from '../types/express';

/**
 * Service-to-service auth for the first-party WhatsApp PA.
 *
 *   x-atrium-internal-key  shared internal secret (config/internalSecret.ts)
 *   x-pa-actor             owner | client | system — who PA is acting for
 *   x-pa-on-behalf-of      owner: Atrium user id of the signed-in PA app user
 *   x-pa-chat-id           client: WhatsApp chat id
 *   x-pa-sender-phone      client: sender's phone (DM → CRM contact match)
 *   x-organization-id      optional workspace; defaults to the PA workspace
 *
 * The actor decides scope here on the server — never PA config or the LLM.
 */
export const PA_ACTOR_HEADER = 'x-pa-actor';
export const PA_ON_BEHALF_OF_HEADER = 'x-pa-on-behalf-of';
export const PA_CHAT_ID_HEADER = 'x-pa-chat-id';
export const PA_SENDER_PHONE_HEADER = 'x-pa-sender-phone';

/** Client chats may only use these endpoints; they filter by the resolved client. */
export const PA_CLIENT_API_PREFIX = '/api/internal/pa/client/';

const ACTORS: PaActor[] = ['owner', 'client', 'system'];

/** Owner/system get the whole staff catalog so new modules work without config. */
const FULL_ACCESS = [...new Set([...ALL_TASK_FLOW_PERMISSIONS, ...ALL_PROJECT_PERMISSIONS])];

function header(req: Request, name: string): string {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v ?? '').trim();
}

export function hasInternalKey(req: Request): boolean {
  return Boolean(header(req, INTERNAL_KEY_HEADER));
}

/** nginx (and any other reverse proxy) adds these; direct calls on the private network don't. */
export function cameThroughProxy(req: Request): boolean {
  return Boolean(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.headers.forwarded);
}

async function resolveOrganizationId(req: Request): Promise<string> {
  const requested = header(req, 'x-organization-id');
  if (requested && mongoose.Types.ObjectId.isValid(requested)) {
    const ok = await Organization.exists({ _id: requested, status: { $ne: 'archived' } });
    if (!ok) throw new ApiError(404, 'Organization not found');
    return requested;
  }
  return resolveDefaultOrganizationId();
}

function resourceFromPath(path: string): string {
  const parts = path.replace(/^\/api\//, '').split('/').filter(Boolean);
  if (parts[0] === 'internal' && parts[1] === 'pa') return ['pa', ...parts.slice(2, 4)].join('.');
  return parts[0] || 'api';
}

/**
 * One audit row per PA write, per client-context request (reads included) and
 * per denial. Reads in owner context would flood the log, so they are skipped.
 */
function auditOnFinish(req: Request, res: Response): void {
  res.on('finish', () => {
    const ctx = req.paContext;
    if (!ctx) return;
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const denied = res.statusCode === 401 || res.statusCode === 403;
    if (!write && !denied && ctx.actor !== 'client') return;
    const path = req.originalUrl.split('?')[0];
    logAudit({
      userId: ctx.serviceAccountId,
      actorType: 'ai',
      actorLabel: PA_ACTOR_LABEL,
      onBehalfOf: ctx.onBehalfOf,
      action: `pa.${ctx.actor}.${req.method.toLowerCase()}`,
      resourceType: resourceFromPath(path),
      meta: {
        path,
        status: res.statusCode,
        actor: ctx.actor,
        organizationId: ctx.organizationId,
        ...(ctx.chatId ? { chatId: ctx.chatId } : {}),
        ...(ctx.scope ? { customerOrgId: ctx.scope.customerOrgId, scopeSource: ctx.scope.source } : {}),
      },
      ip: req.ip,
    });
  });
}

function serviceUser(account: { id: string; email: string; name: string }, permissions: string[]): AuthPayload {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    // Never 'admin': platform-owner routes stay out of reach.
    role: 'user',
    permissions,
    mustChangePassword: false,
    userType: 'taskflow',
  };
}

/** Load a human the owner context acts for; they must be an active member holding the PA owner permission. */
async function loadOnBehalfOf(
  userId: string,
  organizationId: string,
  authenticateStaffUser: (req: Request, userId: string, orgId?: string) => Promise<ApiError | null>,
  req: Request
): Promise<ApiError | null> {
  if (!mongoose.Types.ObjectId.isValid(userId)) return new ApiError(400, 'Invalid x-pa-on-behalf-of');
  const [user, member] = await Promise.all([
    User.findById(userId).select('isServiceAccount userType').lean(),
    OrganizationMember.exists({ organization: organizationId, user: userId, status: 'active' }),
  ]);
  if (!user || user.isServiceAccount || user.userType === 'customer' || !member) {
    return new ApiError(403, 'PA can only act for active staff in this workspace');
  }
  const err = await authenticateStaffUser(req, userId, organizationId);
  if (err) return err;
  req.activeOrganizationId = organizationId;
  if (!userHasPermission(req.user?.permissions ?? [], PA_OWNER_PERMISSION)) {
    return new ApiError(403, 'This user is not allowed to use the PA assistant');
  }
  return null;
}

/**
 * Called by authMiddleware when the internal key header is present.
 * Returns an error instead of throwing (same contract as staff auth).
 */
export async function authenticateInternal(
  req: Request,
  res: Response,
  authenticateStaffUser: (req: Request, userId: string, orgId?: string) => Promise<ApiError | null>
): Promise<ApiError | null> {
  if (cameThroughProxy(req)) {
    return new ApiError(403, 'Internal API is only reachable on the private network');
  }
  if (!isValidInternalKey(header(req, INTERNAL_KEY_HEADER))) {
    logAudit({ actorType: 'system', action: 'pa.internal.denied', resourceType: 'internal', meta: { path: req.originalUrl.split('?')[0] }, ip: req.ip });
    return new ApiError(401, 'Invalid internal key');
  }
  const actor = header(req, PA_ACTOR_HEADER) as PaActor;
  if (!ACTORS.includes(actor)) {
    return new ApiError(400, `${PA_ACTOR_HEADER} must be one of: ${ACTORS.join(', ')}`);
  }

  const organizationId = await resolveOrganizationId(req);
  const account = await ensurePaServiceAccount(organizationId);
  const ctx: PaRequestContext = { actor, organizationId, serviceAccountId: account.id };
  req.paContext = ctx;
  req.activeOrganizationId = organizationId;
  auditOnFinish(req, res);

  if (actor === 'system') {
    return new ApiError(403, 'The system actor may only use PA ingest endpoints');
  }

  if (actor === 'client') {
    const chatId = header(req, PA_CHAT_ID_HEADER);
    if (!chatId) return new ApiError(400, `${PA_CHAT_ID_HEADER} is required for client context`);
    ctx.chatId = chatId;
    ctx.senderPhone = header(req, PA_SENDER_PHONE_HEADER) || undefined;
    ctx.scope = await resolveClientScope(organizationId, chatId, ctx.senderPhone);
    req.user = serviceUser(account, []);
    if (!req.originalUrl.startsWith(PA_CLIENT_API_PREFIX)) {
      return new ApiError(403, 'Client chats can only use the client-scoped PA API');
    }
    return null;
  }

  const onBehalfOf = header(req, PA_ON_BEHALF_OF_HEADER);
  if (onBehalfOf) {
    ctx.onBehalfOf = onBehalfOf;
    return loadOnBehalfOf(onBehalfOf, organizationId, authenticateStaffUser, req);
  }
  req.user = serviceUser(account, FULL_ACCESS);
  return null;
}

/**
 * Guard for PA ingest endpoints (lead capture, service requests). Accepts owner
 * and system actors; client chats must use the client-scoped API instead.
 */
export async function requirePaInternalService(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (cameThroughProxy(req)) throw new ApiError(403, 'Internal API is only reachable on the private network');
    if (!isValidInternalKey(header(req, INTERNAL_KEY_HEADER))) throw new ApiError(401, 'Invalid internal key');
    const actor = (header(req, PA_ACTOR_HEADER) || 'system') as PaActor;
    if (actor !== 'owner' && actor !== 'system') {
      throw new ApiError(403, 'Client chats can only use the client-scoped PA API');
    }
    const organizationId = await resolveOrganizationId(req);
    const account = await ensurePaServiceAccount(organizationId);
    const ctx: PaRequestContext = { actor, organizationId, serviceAccountId: account.id };
    // Owner approvals from the PA apps record the human who clicked.
    const onBehalfOf = actor === 'owner' ? header(req, PA_ON_BEHALF_OF_HEADER) : '';
    if (onBehalfOf && mongoose.Types.ObjectId.isValid(onBehalfOf)) {
      const member = await OrganizationMember.exists({ organization: organizationId, user: onBehalfOf, status: 'active' });
      if (!member) throw new ApiError(403, 'PA can only act for active staff in this workspace');
      ctx.onBehalfOf = onBehalfOf;
    }
    req.paContext = ctx;
    req.activeOrganizationId = organizationId;
    auditOnFinish(req, res);
    next();
  } catch (err) {
    next(err);
  }
}
