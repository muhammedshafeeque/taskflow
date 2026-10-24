/**
 * MCP endpoint end to end over real HTTP against an in-memory Mongo: the assistant acts as the token's user,
 * sees only that user's projects and issues, and read-only tokens can neither see nor use write tools.
 */
import http from 'http';
import type { AddressInfo } from 'net';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.PA_API_URL = 'off';
process.env.PA_DEFAULT_ORG_ID = '';

import app from '../../app';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { User } from '../auth/user.model';
import { Project } from '../projects/project.model';
import { ProjectMember } from '../projects/projectMember.model';
import { Issue } from '../issues/issue.model';
import { flushAuditLogs } from '../auditLogs/logAudit';
import { createToken } from '../apiTokens/apiToken.service';
import { toHtml } from './mcp.tools';
import crypto from 'crypto';
import { issueTaskflowAccessTokenForOAuth } from '../auth/auth.service';
import { ApiToken } from '../apiTokens/apiToken.model';

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
let server: http.Server;
let base = '';
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};

const MEMBER_PERMS = [
  'issue.issue.read',
  'issue.issue.create',
  'issue.issue.update',
  'issue.comment.create',
  'issue.comment.read',
  'project.project.read',
];

let rpcId = 0;
async function rpc(token: string, method: string, params: Record<string, unknown> = {}) {
  const res = await fetch(`${base}/api/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as { result?: Record<string, unknown>; error?: { message: string }; message?: string } };
}

async function call(token: string, name: string, args: Record<string, unknown> = {}) {
  const { body } = await rpc(token, 'tools/call', { name, arguments: args });
  const result = body.result as { content: Array<{ text: string }>; isError?: boolean };
  const text = result.content[0]?.text ?? '';
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { isError: Boolean(result.isError), data, text };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.MCP_LOOPBACK_URL = `${base}/api`;

  const [ana, ben, boss] = await User.create([
    { email: 'ana@example.com', name: 'Ana', mustChangePassword: false },
    { email: 'ben@example.com', name: 'Ben', mustChangePassword: false },
    { email: 'boss@example.com', name: 'Boss', role: 'admin', mustChangePassword: false },
  ]);
  const org = await Organization.create({ name: 'Studio', slug: 'studio', createdBy: ana._id });
  await OrganizationMember.create([
    { organization: org._id, user: ana._id, role: 'org_member', status: 'active' },
    { organization: org._id, user: ben._id, role: 'org_member', status: 'active' },
    { organization: org._id, user: boss._id, role: 'org_admin', status: 'active' },
  ]);
  const [app1, secret] = await Project.create([
    { name: 'App', key: 'APP', lead: ana._id, taskflowOrganizationId: org._id },
    { name: 'Secret', key: 'SEC', lead: ben._id, taskflowOrganizationId: org._id },
  ]);
  await ProjectMember.create([
    { project: app1._id, user: ana._id, permissions: MEMBER_PERMS },
    { project: secret._id, user: ben._id, permissions: MEMBER_PERMS },
  ]);
  await Issue.create([
    { title: 'Login screen', key: 'APP-1', project: app1._id, reporter: ana._id, assignee: ana._id, status: 'To Do' },
    { title: 'Payroll export', key: 'SEC-1', project: secret._id, reporter: ben._id, status: 'To Do' },
  ]);
  Object.assign(ids, { org: String(org._id), ana: String(ana._id), app: String(app1._id) });
  tokens.ana = (await createToken(String(ana._id), String(org._id), { name: 'claude' })).token;
  tokens.anaRead = (await createToken(String(ana._id), String(org._id), { name: 'claude ro', readOnly: true })).token;
  tokens.boss = (await createToken(String(boss._id), String(org._id), { name: 'claude' })).token;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await flushAuditLogs();
  await mongoose.disconnect();
  await mongo.stop();
});

describe('MCP endpoint', () => {
  it('initialises and identifies the token user', async () => {
    const init = await rpc(tokens.ana, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    expect(init.status).toBe(200);
    expect((init.body.result as { serverInfo: { name: string } }).serverInfo.name).toBe('atrium');
    const me = await call(tokens.ana, 'whoami');
    expect(me.data).toMatchObject({ user: { email: 'ana@example.com' }, workspace: { id: ids.org, name: 'Studio' }, readOnly: false });
  });

  it('rejects requests without an API token', async () => {
    const res = await fetch(`${base}/api/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(401);
    const bad = await rpc('atr_not-a-real-token', 'tools/list');
    expect(bad.status).toBe(401);
  });

  it('only shows the user’s own projects and issues', async () => {
    const projects = await call(tokens.ana, 'list_projects');
    expect((projects.data as { projects: Array<{ key: string }> }).projects.map((p) => p.key)).toEqual(['APP']);

    const mine = await call(tokens.ana, 'search_issues', { assignee: 'me' });
    expect((mine.data as { issues: Array<{ key: string }> }).issues.map((i) => i.key)).toEqual(['APP-1']);

    const issue = await call(tokens.ana, 'get_issue', { issue: 'app-1' });
    expect(issue.isError).toBe(false);
    expect(issue.data).toMatchObject({ key: 'APP-1', title: 'Login screen' });

    // Ben's project and issue don't exist as far as Ana's assistant can tell.
    const hidden = await call(tokens.ana, 'get_issue', { issue: 'SEC-1' });
    expect(hidden.isError).toBe(true);
    const searched = await call(tokens.ana, 'search_issues', { text: 'Payroll' });
    expect((searched.data as { issues: unknown[] }).issues).toEqual([]);
    const otherProject = await call(tokens.ana, 'get_project', { project: 'SEC' });
    expect(otherProject.isError).toBe(true);
  });

  it('writes as the user when the token allows it', async () => {
    const created = await call(tokens.ana, 'create_issue', { project: 'APP', title: 'From Claude' });
    expect(created.isError).toBe(false);
    const key = (created.data as { created: { key: string } }).created.key;
    expect(key).toMatch(/^APP-/);
    const commented = await call(tokens.ana, 'add_comment', { issue: key, body: 'Looks good' });
    expect(commented.isError).toBe(false);
    const issue = await call(tokens.ana, 'get_issue', { issue: key });
    expect((issue.data as { comments: Array<{ text: string }> }).comments.map((c) => c.text)).toContain('Looks good');
  });

  it('hides write tools from read-only tokens and the API refuses their writes', async () => {
    const list = await rpc(tokens.anaRead, 'tools/list');
    const names = (list.body.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    expect(names).toContain('search_issues');
    expect(names).not.toContain('create_issue');
    expect(names).not.toContain('update_issue');

    const write = await call(tokens.anaRead, 'create_issue', { project: 'APP', title: 'Nope' });
    expect(write.isError).toBe(true);

    // The token itself cannot write through the REST API either.
    const direct = await fetch(`${base}/api/issues`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.anaRead}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: ids.app, title: 'Nope' }),
    });
    expect(direct.status).toBe(403);
    expect(await Issue.countDocuments({ title: 'Nope' })).toBe(0);
  });
});

describe('whole-API access', () => {
  type Areas = { areas: Array<{ area: string }> };

  it('lists only the areas the user’s permissions open', async () => {
    const ana = (await call(tokens.ana, 'api_areas')).data as Areas;
    const anaAreas = ana.areas.map((a) => a.area);
    expect(anaAreas).toEqual(expect.arrayContaining(['issues', 'projects', 'docs']));
    expect(anaAreas).not.toContain('crm');
    expect(anaAreas).not.toContain('api-tokens');

    const boss = (await call(tokens.boss, 'api_areas')).data as Areas;
    expect(boss.areas.map((a) => a.area)).toEqual(expect.arrayContaining(['crm', 'hrms', 'billing', 'issues']));
  });

  it('calls any permitted endpoint as the user', async () => {
    const issues = await call(tokens.ana, 'api_request', { method: 'GET', path: '/issues', query: { project: ids.app } });
    expect(issues.isError).toBe(false);
    expect((issues.data as { data: Array<{ key: string }> }).data.map((i) => i.key)).toContain('APP-1');

    const deals = await call(tokens.boss, 'api_request', { method: 'GET', path: '/api/crm/deals' });
    expect(deals.isError).toBe(false);
  });

  it('refuses endpoints the user lacks, blocked areas, and writes on read-only tokens', async () => {
    const crm = await call(tokens.ana, 'api_request', { method: 'GET', path: '/crm/deals' });
    expect(crm.isError).toBe(true);
    expect(crm.text).toMatch(/not an endpoint you can use/);

    for (const path of ['/api-tokens', '/auth/login', '/mcp', '/internal/pa/whoami', '/issues/../api-tokens']) {
      const r = await call(tokens.boss, 'api_request', { method: path === '/auth/login' ? 'POST' : 'GET', path });
      expect(r.isError).toBe(true);
    }

    const ro = await call(tokens.anaRead, 'api_request', { method: 'POST', path: '/issues', body: { project: ids.app, title: 'Nope 2' } });
    expect(ro.isError).toBe(true);
    expect(await Issue.countDocuments({ title: 'Nope 2' })).toBe(0);
  });
});

describe('MCP OAuth sign-in', () => {
  const redirect = 'http://localhost:33418/callback';
  const pkce = () => {
    const verifier = crypto.randomBytes(32).toString('base64url');
    return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
  };
  const json = async (res: Response) => ({ status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> });
  const session = (jwt: string) => ({ Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', 'X-Organization-Id': ids.org });

  async function register() {
    const r = await json(
      await fetch(`${base}/api/mcp/oauth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirect], token_endpoint_auth_method: 'none' }),
      })
    );
    expect(r.status).toBe(201);
    return r.body.client_id as string;
  }

  async function authorize(clientId: string, challenge: string, extra: Record<string, unknown> = {}) {
    const jwt = await issueTaskflowAccessTokenForOAuth(ids.ana);
    const params = { client_id: clientId, redirect_uri: redirect, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz' };
    const r = await json(await fetch(`${base}/api/mcp/oauth/approve`, { method: 'POST', headers: session(jwt), body: JSON.stringify({ ...params, approve: true, ...extra }) }));
    expect(r.status).toBe(200);
    return new URL(r.body.data.redirect as string);
  }

  const exchange = (body: Record<string, string>) =>
    fetch(`${base}/api/mcp/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() }).then(json);

  it('advertises how to sign in', async () => {
    const res = await fetch(`${base}/api/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(401);
    const meta = /resource_metadata="([^"]+)"/.exec(res.headers.get('www-authenticate') ?? '')?.[1];
    expect(meta).toBe(`${base}/api/mcp/.well-known/oauth-protected-resource`);
    const pr = await json(await fetch(meta!));
    expect(pr.body.authorization_servers).toEqual([`${base}/api/mcp`]);
    for (const url of [`${base}/.well-known/oauth-authorization-server/api/mcp`, `${base}/.well-known/oauth-authorization-server`, `${base}/api/mcp/.well-known/openid-configuration`]) {
      const as = await json(await fetch(url));
      expect(as.body).toMatchObject({ issuer: `${base}/api/mcp`, token_endpoint: `${base}/api/mcp/oauth/token`, code_challenge_methods_supported: ['S256'] });
    }
  });

  it('registers, gets consent and issues a token that acts as the user', async () => {
    const clientId = await register();
    const { challenge } = pkce();

    const start = await fetch(
      `${base}/api/mcp/oauth/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz' })}`,
      { redirect: 'manual' }
    );
    expect(start.status).toBe(302);
    expect(start.headers.get('location')).toMatch(/\/auth\/mcp\?.*client_id=/);

    const back = await authorize(clientId, challenge, { readOnly: true });
    expect(back.origin + back.pathname).toBe(redirect);
    expect(back.searchParams.get('state')).toBe('xyz');
    const code = back.searchParams.get('code')!;

    // Wrong PKCE verifier.
    expect((await exchange({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirect, code_verifier: pkce().verifier })).body.error).toBe('invalid_grant');

    const { verifier: v2, challenge: c2 } = pkce();
    const code2 = (await authorize(clientId, c2, { readOnly: true })).searchParams.get('code')!;
    const ok = await exchange({ grant_type: 'authorization_code', code: code2, client_id: clientId, redirect_uri: redirect, code_verifier: v2 });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ token_type: 'Bearer' });
    expect(ok.body.access_token).toMatch(/^atr_/);
    // A code works once.
    expect((await exchange({ grant_type: 'authorization_code', code: code2, client_id: clientId, redirect_uri: redirect, code_verifier: v2 })).body.error).toBe('invalid_grant');

    const me = await call(ok.body.access_token, 'whoami');
    expect(me.data).toMatchObject({ user: { email: 'ana@example.com' }, workspace: { id: ids.org }, readOnly: true });
  });

  it('replaces the earlier token when the same client reconnects', async () => {
    const clientId = await register();
    const issue = async () => {
      const { verifier, challenge } = pkce();
      const code = (await authorize(clientId, challenge)).searchParams.get('code')!;
      return (await exchange({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirect, code_verifier: verifier })).body.access_token as string;
    };
    const first = await issue();
    const second = await issue();
    expect((await rpc(first, 'tools/list')).status).toBe(401);
    expect((await rpc(second, 'tools/list')).status).toBe(200);
    expect(await ApiToken.countDocuments({ oauthClientId: clientId, revokedAt: null })).toBe(1);
  });

  it('refuses unknown redirects, plain PKCE and API-token approvals', async () => {
    const clientId = await register();
    const bad = await json(await fetch(`${base}/api/mcp/oauth/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: 'https://evil.example/cb', response_type: 'code', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' })}`, { redirect: 'manual' }));
    expect(bad.status).toBe(400);
    const plain = await fetch(`${base}/api/mcp/oauth/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', code_challenge: 'x'.repeat(43), code_challenge_method: 'plain' })}`, { redirect: 'manual' });
    expect(plain.headers.get('location')).toMatch(/^http:\/\/localhost:33418\/callback\?error=invalid_request/);
    const viaToken = await fetch(`${base}/api/mcp/oauth/approve`, { method: 'POST', headers: session(tokens.ana), body: JSON.stringify({ client_id: clientId, approve: true }) });
    expect(viaToken.status).toBe(403);
    const js = await json(await fetch(`${base}/api/mcp/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['javascript:alert(1)'] }) }));
    expect(js.body.error).toBe('invalid_redirect_uri');
  });
});

describe('toHtml', () => {
  it('turns simple Markdown into editor HTML and passes HTML through', () => {
    expect(toHtml('# Title\n\n- a\n- **b**\n\n`x`')).toBe('<h1>Title</h1><ul><li><p>a</p></li><li><p><strong>b</strong></p></li></ul><p><code>x</code></p>');
    expect(toHtml('<p>keep</p>')).toBe('<p>keep</p>');
  });
});
