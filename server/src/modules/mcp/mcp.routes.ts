import { Router, type Request, type Response, type NextFunction } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { authMiddleware } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { Organization } from '../organizations/organization.model';
import { AtriumApi } from './mcp.api';
import { registerTools, type McpContext } from './mcp.tools';
import { oauthRouter, resourceMetadataUrl, wellKnownRouter } from './mcpOAuth';

type McpRequest = Request & { viaApiToken?: boolean; apiTokenReadOnly?: boolean };

const INSTRUCTIONS = `Atrium is a work-management platform (projects, issues, sprints, docs, resources).
This connection acts as one signed-in user: every tool sees and changes only what that user can see and change in Atrium.
Refer to projects by key (e.g. APP) and issues by key (e.g. APP-12). Use whoami to check the user and whether the token is read-only.
Before creating or updating issues, read the project (get_project) to use status, type and priority names that exist there.
For anything else in Atrium (CRM, HR, billing, accounts, service desk, assets, procurement, contracts, calendar, monitor, resources…),
use api_areas → api_endpoints → api_request. Those only list and allow what this user's role permits, and Atrium re-checks every call.
Ask the user before creating, changing or deleting data.`;

/**
 * MCP endpoint for AI assistants (Claude Code, Claude Desktop, Cursor…).
 * Authenticated with a personal API token; stateless, so every request builds a server bound to that user.
 */
const router = Router();

router.use('/oauth', oauthRouter());
router.use('/.well-known', wellKnownRouter());

/** Tells MCP clients where to sign in when they have no (valid) token (RFC 9728). */
function challenge(req: Request, res: Response, next: NextFunction) {
  res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl(req)}", scope="atrium"`);
  if (!/^Bearer\s+\S/i.test(req.headers.authorization ?? '')) return next(new ApiError(401, 'Sign in to Atrium or use a personal API token'));
  next();
}

function onlyApiTokens(req: McpRequest, res: Response, next: NextFunction) {
  if (!req.viaApiToken) return next(new ApiError(401, 'Use a personal API token (Profile → API tokens) to connect an AI assistant'));
  res.removeHeader('WWW-Authenticate');
  if (req.user?.userType === 'customer') return next(new ApiError(403, 'Not available for portal users'));
  if (!req.activeOrganizationId) return next(new ApiError(400, 'This token has no workspace. Create it while a workspace is active.'));
  next();
}

router.post(
  '/',
  challenge,
  authMiddleware,
  onlyApiTokens,
  asyncHandler(async (req: McpRequest, res: Response) => {
    const org = await Organization.findById(req.activeOrganizationId).select('name').lean();
    const ctx: McpContext = {
      api: new AtriumApi(String(req.headers.authorization), req.activeOrganizationId),
      user: { id: req.user!.id, name: req.user!.name, email: req.user!.email, role: req.user!.role, permissions: req.user!.permissions ?? [] },
      workspace: req.activeOrganizationId ? { id: req.activeOrganizationId, name: org?.name } : null,
      readOnly: req.apiTokenReadOnly === true,
    };
    const server = new McpServer({ name: 'atrium', version: '1.0.0' }, { instructions: INSTRUCTIONS });
    registerTools(server, ctx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  })
);

// Stateless server: no server-initiated streams or sessions to end.
const methodNotAllowed = (_req: Request, res: Response) =>
  res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
router.get('/', methodNotAllowed);
router.delete('/', methodNotAllowed);

export const mcpRoutes = router;
