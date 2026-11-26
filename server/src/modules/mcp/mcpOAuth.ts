import crypto from 'crypto';
import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { env } from '../../config/env';
import { authMiddleware } from '../../middleware/auth.middleware';
import { rateLimit } from '../../middleware/rateLimit';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { Organization } from '../organizations/organization.model';
import { createToken } from '../apiTokens/apiToken.service';
import { McpDeviceCode, McpOAuthClient, McpOAuthCode } from './mcpOAuth.model';

/**
 * OAuth 2.1 for MCP clients that cannot send a static header (claude.ai, Claude Desktop connectors, and
 * Claude Code / Cursor without a pasted token). The user approves in Atrium and the client receives an
 * ordinary personal API token, so read-only, revocation and every permission check work exactly as for
 * a token created by hand. Public clients with PKCE (S256) only; clients register themselves (RFC 7591).
 *
 * Command-line tools without a browser (SSH sessions, containers, CI) use the device flow (RFC 8628) instead:
 * they show a short code, the user approves it at /auth/device on any device, and the tool polls for the token.
 */

type AuthedRequest = Request & { user?: { id: string; userType?: string }; activeOrganizationId?: string; viaApiToken?: boolean };

const CODE_TTL_MS = 10 * 60 * 1000;
const UNUSED_CLIENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EXPIRY_CHOICES = [30, 90, 365];
export const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const DEVICE_TTL_MS = 10 * 60 * 1000;
const DEVICE_INTERVAL_S = 5;
/** No vowels or look-alikes, so codes are easy to read out and never spell words (RFC 8628 §6.1). */
const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';

function newUserCode(): string {
  let out = '';
  for (const b of crypto.randomBytes(8)) out += USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length];
  return out;
}
/** What the user typed, as stored: letters only, upper case ("bcdf-ghjk" → "BCDFGHJK"). */
export const normalizeUserCode = (raw: unknown) => String(raw ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 16);
const showUserCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;
const deviceVerificationUrl = () => `${env.appUrl.replace(/\/$/, '')}/auth/device`;

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest();
const hashCode = (code: string) => sha256(code).toString('hex');

/** Public URL of the MCP endpoint, e.g. https://atrium.example.com/api/mcp. MCP_PUBLIC_URL overrides the request's own host. */
export function mcpPublicUrl(req: Request) {
  const configured = process.env.MCP_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const first = (h: string | string[] | undefined) => String(Array.isArray(h) ? h[0] : (h ?? '')).split(',')[0].trim();
  const proto = first(req.headers['x-forwarded-proto']) || req.protocol;
  const host = first(req.headers['x-forwarded-host']) || req.get('host');
  return `${proto}://${host}/api/mcp`;
}

export const resourceMetadataUrl = (req: Request) => `${mcpPublicUrl(req)}/.well-known/oauth-protected-resource`;

function authorizationServerMetadata(req: Request) {
  const issuer = mcpPublicUrl(req);
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    device_authorization_endpoint: `${issuer}/oauth/device_authorization`,
    grant_types_supported: ['authorization_code', DEVICE_GRANT],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['atrium'],
  };
}

function protectedResourceMetadata(req: Request) {
  const resource = mcpPublicUrl(req);
  return { resource, authorization_servers: [resource], bearer_methods_supported: ['header'], scopes_supported: ['atrium'], resource_name: 'Atrium' };
}

/** Discovery documents, served both at the site root (the locations clients look first) and under /api/mcp. */
export function wellKnownRouter() {
  const r = Router();
  const as = (req: Request, res: Response) => void res.set('Cache-Control', 'public, max-age=300').json(authorizationServerMetadata(req));
  const pr = (req: Request, res: Response) => void res.set('Cache-Control', 'public, max-age=300').json(protectedResourceMetadata(req));
  r.get(['/oauth-authorization-server', '/oauth-authorization-server/api/mcp', '/openid-configuration', '/openid-configuration/api/mcp'], as);
  r.get(['/oauth-protected-resource', '/oauth-protected-resource/api/mcp'], pr);
  return r;
}

function isLoopback(u: URL) {
  return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
}

/** https anywhere, http only on this machine, or an app's own scheme (cursor://…). Never script/data/file URLs. */
function validRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 2000) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:') return isLoopback(u);
  return !['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:', 'ftp:', 'ws:', 'wss:'].includes(u.protocol);
}

/** Exact match, except loopback redirects may use any port (RFC 8252 §7.3). */
function redirectMatches(registered: string[], uri: string) {
  if (registered.includes(uri)) return true;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (!isLoopback(u)) return false;
  return registered.some((r) => {
    try {
      const x = new URL(r);
      return isLoopback(x) && x.protocol === u.protocol && x.hostname === u.hostname && x.pathname === u.pathname && x.search === u.search;
    } catch {
      return false;
    }
  });
}

class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

/** OAuth endpoints answer in RFC 6749 shape ({ error, error_description }), not the API's usual envelope. */
const oauth = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch((e: unknown) => {
    if (e instanceof OAuthError) return void res.status(e.status).set('Cache-Control', 'no-store').json({ error: e.code, error_description: e.message });
    next(e);
  });

type AuthorizeParams = {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  code_challenge: string;
  code_challenge_method: string;
  state?: string;
  scope?: string;
  resource?: string;
};

function pick(src: Record<string, unknown>): AuthorizeParams {
  const s = (k: string) => (typeof src[k] === 'string' ? (src[k] as string) : '');
  return {
    client_id: s('client_id'),
    redirect_uri: s('redirect_uri'),
    response_type: s('response_type'),
    code_challenge: s('code_challenge'),
    code_challenge_method: s('code_challenge_method') || 'plain',
    state: s('state') || undefined,
    scope: s('scope') || undefined,
    resource: s('resource') || undefined,
  };
}

/** Checks an authorization request. Problems with the client or redirect must not redirect (they'd go to an unverified URL). */
async function checkAuthorize(p: AuthorizeParams) {
  const client = await McpOAuthClient.findOne({ clientId: p.client_id }).lean();
  if (!client) throw new OAuthError('invalid_client', 'Unknown client. Remove the connector and add it again.');
  if (!p.redirect_uri || !redirectMatches(client.redirectUris, p.redirect_uri)) throw new OAuthError('invalid_request', 'redirect_uri is not registered for this client');
  const redirectError = (error: string, description: string) => {
    const u = new URL(p.redirect_uri);
    u.searchParams.set('error', error);
    u.searchParams.set('error_description', description);
    if (p.state) u.searchParams.set('state', p.state);
    return u.toString();
  };
  if (p.response_type !== 'code') return { client, redirectError: redirectError('unsupported_response_type', 'Only response_type=code is supported') };
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(p.code_challenge) || p.code_challenge_method !== 'S256') {
    return { client, redirectError: redirectError('invalid_request', 'PKCE with code_challenge_method=S256 is required') };
  }
  return { client, redirectError: null as string | null, deny: () => redirectError('access_denied', 'The user declined access') };
}

function requireSignedInStaff(req: AuthedRequest, _res: Response, next: NextFunction) {
  if (req.viaApiToken) return next(new ApiError(403, 'Sign in to Atrium to approve an assistant'));
  if (req.user?.userType === 'customer') return next(new ApiError(403, 'Not available for portal users'));
  next();
}

/** The personal API token an approved sign-in becomes, in RFC 6749 token-response shape. */
async function issueToken(res: Response, grant: { clientId: string; userId?: unknown; organizationId?: unknown; expiresInDays: number; readOnly: boolean }) {
  const client = await McpOAuthClient.findOne({ clientId: grant.clientId }).select('name').lean();
  let issued;
  try {
    issued = await createToken(
      String(grant.userId),
      grant.organizationId ? String(grant.organizationId) : undefined,
      { name: `${client?.name ?? 'MCP client'} (connected)`, expiresInDays: grant.expiresInDays, readOnly: grant.readOnly },
      grant.clientId
    );
  } catch (e) {
    throw new OAuthError('invalid_grant', e instanceof Error ? e.message : 'Could not issue a token');
  }
  const expiresAt = issued.record.expiresAt as Date | undefined;
  res.set('Cache-Control', 'no-store').json({
    access_token: issued.token,
    token_type: 'Bearer',
    expires_in: expiresAt ? Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)) : undefined,
    scope: 'atrium',
  });
}

/** One poll of a device code (RFC 8628 §3.5): pending, slow down, declined, expired, or the token (once). */
async function redeemDeviceCode(deviceCode: string, clientId: string, res: Response) {
  if (!deviceCode) throw new OAuthError('invalid_request', 'device_code is required');
  const grant = await McpDeviceCode.findOne({ deviceCodeHash: hashCode(deviceCode) }).lean();
  if (!grant || grant.issuedAt) throw new OAuthError('invalid_grant', 'The device code is invalid or already used');
  if (clientId && grant.clientId !== clientId) throw new OAuthError('invalid_grant', 'client_id does not match the device code');
  if (grant.expiresAt <= new Date()) throw new OAuthError('expired_token', 'The code expired. Start signing in again.');
  if (grant.status === 'denied') {
    await McpDeviceCode.deleteOne({ _id: grant._id });
    throw new OAuthError('access_denied', 'The user declined access');
  }
  if (grant.status === 'pending') {
    const now = Date.now();
    const tooSoon = grant.lastPolledAt && now - grant.lastPolledAt.getTime() < grant.interval * 1000;
    await McpDeviceCode.updateOne({ _id: grant._id }, { $set: { lastPolledAt: new Date(now), ...(tooSoon ? { interval: grant.interval + 5 } : {}) } });
    if (tooSoon) throw new OAuthError('slow_down', `Poll at most every ${grant.interval + 5} seconds`);
    throw new OAuthError('authorization_pending', 'Waiting for the user to approve in Atrium');
  }
  // Approved: claim it, so two polls at once get one token.
  const claimed = await McpDeviceCode.findOneAndUpdate({ _id: grant._id, status: 'approved', issuedAt: null }, { $set: { issuedAt: new Date() } }, { new: true }).lean();
  if (!claimed) throw new OAuthError('invalid_grant', 'The device code is invalid or already used');
  await issueToken(res, claimed as never);
}

export function oauthRouter() {
  const r = Router();
  const limiter = rateLimit('mcp_oauth', { max: 30, windowSec: 60 });
  r.use(express.urlencoded({ extended: false, limit: '20kb' }));

  /** RFC 7591 dynamic client registration (public clients). */
  r.post(
    '/register',
    limiter,
    oauth(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
      // Clients commonly ask for grants we don't offer (Claude sends ["authorization_code", "refresh_token"]).
      // RFC 7591 §3.2.1 lets the server register only what it supports, so drop the rest instead of refusing.
      const requested = Array.isArray(body.grant_types) ? body.grant_types.map(String) : ['authorization_code'];
      const grants = [...new Set(requested.filter((g) => g === 'authorization_code' || g === DEVICE_GRANT))];
      if (!grants.length) {
        throw new OAuthError('invalid_client_metadata', `grant_types must include authorization_code or ${DEVICE_GRANT}`);
      }
      const deviceOnly = !grants.includes('authorization_code');
      if (deviceOnly ? uris.length > 0 : !uris.length || uris.length > 10 || !uris.every(validRedirectUri)) {
        throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be 1–10 https URLs, http://localhost URLs or app URLs');
      }
      const method = typeof body.token_endpoint_auth_method === 'string' ? body.token_endpoint_auth_method : 'none';
      if (method !== 'none') throw new OAuthError('invalid_client_metadata', 'Only public clients (token_endpoint_auth_method "none") are supported');
      const name = (typeof body.client_name === 'string' && body.client_name.trim().slice(0, 60)) || 'MCP client';
      const clientId = `mcp_${crypto.randomBytes(18).toString('base64url')}`;
      const doc = await McpOAuthClient.create({ clientId, name, redirectUris: uris as string[], expiresAt: new Date(Date.now() + UNUSED_CLIENT_TTL_MS) });
      res.status(201).set('Cache-Control', 'no-store').json({
        client_id: clientId,
        client_id_issued_at: Math.floor(doc.createdAt.getTime() / 1000),
        client_name: name,
        redirect_uris: doc.redirectUris,
        grant_types: grants,
        response_types: deviceOnly ? [] : ['code'],
        token_endpoint_auth_method: 'none',
      });
    })
  );

  /** Browser lands here from the client; send it to the consent screen in the web app. */
  r.get(
    '/authorize',
    oauth(async (req, res) => {
      const p = pick(req.query as Record<string, unknown>);
      const { redirectError } = await checkAuthorize(p);
      if (redirectError) return res.redirect(302, redirectError);
      const qs = new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== ''));
      res.redirect(302, `${env.appUrl.replace(/\/$/, '')}/auth/mcp?${qs}`);
    })
  );

  /** Consent screen: who is asking and where the result goes. */
  r.get(
    '/request',
    authMiddleware,
    requireSignedInStaff,
    asyncHandler(async (req: AuthedRequest, res) => {
      const p = pick(req.query as Record<string, unknown>);
      let checked;
      try {
        checked = await checkAuthorize(p);
      } catch (e) {
        throw new ApiError(400, e instanceof Error ? e.message : 'Invalid request');
      }
      const org = req.activeOrganizationId ? await Organization.findById(req.activeOrganizationId).select('name').lean() : null;
      res.json({
        success: true,
        data: {
          clientName: checked.client.name,
          redirectHost: new URL(p.redirect_uri).host || new URL(p.redirect_uri).protocol.replace(/:$/, ''),
          workspace: org ? { id: String(org._id), name: org.name } : null,
          error: checked.redirectError ? new URL(checked.redirectError).searchParams.get('error_description') : null,
          errorRedirect: checked.redirectError,
          expiryChoices: EXPIRY_CHOICES,
        },
      });
    })
  );

  /** The signed-in user approves (or declines); returns where to send the browser next. */
  r.post(
    '/approve',
    authMiddleware,
    requireSignedInStaff,
    asyncHandler(async (req: AuthedRequest, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const p = pick(body);
      let checked;
      try {
        checked = await checkAuthorize(p);
      } catch (e) {
        throw new ApiError(400, e instanceof Error ? e.message : 'Invalid request');
      }
      if (checked.redirectError) return res.json({ success: true, data: { redirect: checked.redirectError } });
      if (body.approve !== true) return res.json({ success: true, data: { redirect: checked.deny!() } });
      if (!req.activeOrganizationId) throw new ApiError(400, 'Choose a workspace first');

      const days = EXPIRY_CHOICES.includes(Number(body.expiresInDays)) ? Number(body.expiresInDays) : 90;
      const code = crypto.randomBytes(32).toString('base64url');
      await McpOAuthCode.create({
        codeHash: hashCode(code),
        clientId: p.client_id,
        userId: req.user!.id,
        organizationId: req.activeOrganizationId,
        redirectUri: p.redirect_uri,
        codeChallenge: p.code_challenge,
        readOnly: body.readOnly === true,
        expiresInDays: days,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      });
      await McpOAuthClient.updateOne({ clientId: p.client_id }, { $unset: { expiresAt: 1 } });
      const u = new URL(p.redirect_uri);
      u.searchParams.set('code', code);
      if (p.state) u.searchParams.set('state', p.state);
      u.searchParams.set('iss', mcpPublicUrl(req));
      res.json({ success: true, data: { redirect: u.toString() } });
    })
  );

  /**
   * Device flow, step 1 (RFC 8628 §3.1): a command-line tool asks for codes. `client_id` is optional, so a script
   * can sign in without registering first; it then appears under its `client_name`.
   */
  r.post(
    '/device_authorization',
    limiter,
    oauth(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      let clientId = typeof b.client_id === 'string' ? b.client_id : '';
      if (clientId) {
        if (!(await McpOAuthClient.exists({ clientId }))) throw new OAuthError('invalid_client', 'Unknown client', 401);
      } else {
        const name = (typeof b.client_name === 'string' && b.client_name.trim().slice(0, 60)) || 'Command-line tool';
        clientId = `mcp_${crypto.randomBytes(18).toString('base64url')}`;
        await McpOAuthClient.create({ clientId, name, redirectUris: [], expiresAt: new Date(Date.now() + UNUSED_CLIENT_TTL_MS) });
      }
      const deviceCode = crypto.randomBytes(32).toString('base64url');
      let userCode = '';
      for (let i = 0; i < 5 && !userCode; i++) {
        const candidate = newUserCode();
        try {
          await McpDeviceCode.create({ deviceCodeHash: hashCode(deviceCode), userCode: candidate, clientId, interval: DEVICE_INTERVAL_S, expiresAt: new Date(Date.now() + DEVICE_TTL_MS) });
          userCode = candidate;
        } catch (e) {
          if ((e as { code?: number }).code !== 11000) throw e;
        }
      }
      if (!userCode) throw new OAuthError('temporarily_unavailable', 'Try again', 503);
      res.set('Cache-Control', 'no-store').json({
        device_code: deviceCode,
        user_code: showUserCode(userCode),
        verification_uri: deviceVerificationUrl(),
        verification_uri_complete: `${deviceVerificationUrl()}?code=${showUserCode(userCode)}`,
        expires_in: Math.floor(DEVICE_TTL_MS / 1000),
        interval: DEVICE_INTERVAL_S,
        client_id: clientId,
      });
    })
  );

  /** Device flow, step 2: the signed-in user looks up the code their terminal shows. */
  const deviceLimiter = rateLimit('mcp_device', { max: 20, windowSec: 60 });
  const findPending = async (raw: unknown) => {
    const userCode = normalizeUserCode(raw);
    const grant = userCode.length === 8 ? await McpDeviceCode.findOne({ userCode, status: 'pending', expiresAt: { $gt: new Date() } }).lean() : null;
    if (!grant) throw new ApiError(404, 'That code is not valid or has expired. Check the code in your terminal, or start signing in again.');
    return grant;
  };
  r.get(
    '/device/request',
    authMiddleware,
    requireSignedInStaff,
    deviceLimiter,
    asyncHandler(async (req: AuthedRequest, res) => {
      const grant = await findPending(req.query.user_code);
      const [client, org] = await Promise.all([
        McpOAuthClient.findOne({ clientId: grant.clientId }).select('name').lean(),
        req.activeOrganizationId ? Organization.findById(req.activeOrganizationId).select('name').lean() : null,
      ]);
      res.json({
        success: true,
        data: {
          clientName: client?.name ?? 'Command-line tool',
          userCode: showUserCode(grant.userCode),
          workspace: org ? { id: String(org._id), name: org.name } : null,
          expiresAt: grant.expiresAt,
          expiryChoices: EXPIRY_CHOICES,
        },
      });
    })
  );

  /** Device flow, step 3: allow or decline. The tool picks the result up on its next poll. */
  r.post(
    '/device/approve',
    authMiddleware,
    requireSignedInStaff,
    deviceLimiter,
    asyncHandler(async (req: AuthedRequest, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const grant = await findPending(body.user_code);
      const approve = body.approve === true;
      if (approve && !req.activeOrganizationId) throw new ApiError(400, 'Choose a workspace first');
      const days = EXPIRY_CHOICES.includes(Number(body.expiresInDays)) ? Number(body.expiresInDays) : 90;
      const done = await McpDeviceCode.updateOne(
        { _id: grant._id, status: 'pending' },
        {
          $set: approve
            ? { status: 'approved', userId: req.user!.id, organizationId: req.activeOrganizationId, readOnly: body.readOnly === true, expiresInDays: days }
            : { status: 'denied', userId: req.user!.id },
        }
      );
      if (!done.modifiedCount) throw new ApiError(409, 'This code has just been used');
      if (approve) await McpOAuthClient.updateOne({ clientId: grant.clientId }, { $unset: { expiresAt: 1 } });
      res.json({ success: true, data: { status: approve ? 'approved' : 'denied' } });
    })
  );

  /** Code → personal API token (RFC 6749 §4.1.3 with PKCE), or device code → token (RFC 8628 §3.4). */
  r.post(
    '/token',
    limiter,
    oauth(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const s = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : '');
      if (s('grant_type') === DEVICE_GRANT) return redeemDeviceCode(s('device_code'), s('client_id'), res);
      if (s('grant_type') !== 'authorization_code') throw new OAuthError('unsupported_grant_type', `Use authorization_code or ${DEVICE_GRANT}`);
      const code = s('code');
      const verifier = s('code_verifier');
      if (!code || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new OAuthError('invalid_request', 'code and a valid code_verifier are required');

      // Claim the code atomically so it can be redeemed once.
      const grant = await McpOAuthCode.findOneAndUpdate(
        { codeHash: hashCode(code), usedAt: null, expiresAt: { $gt: new Date() } },
        { $set: { usedAt: new Date() } },
        { new: true }
      ).lean();
      if (!grant) throw new OAuthError('invalid_grant', 'The authorization code is invalid, expired or already used');
      if (grant.clientId !== s('client_id') || grant.redirectUri !== s('redirect_uri')) throw new OAuthError('invalid_grant', 'client_id or redirect_uri does not match the authorization');
      const challenge = sha256(verifier).toString('base64url');
      if (challenge.length !== grant.codeChallenge.length || !crypto.timingSafeEqual(Buffer.from(challenge), Buffer.from(grant.codeChallenge))) {
        throw new OAuthError('invalid_grant', 'PKCE verification failed');
      }

      await issueToken(res, grant);
    })
  );

  return r;
}
