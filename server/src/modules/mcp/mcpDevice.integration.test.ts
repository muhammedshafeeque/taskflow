/**
 * Signing in from a terminal (OAuth device flow, RFC 8628) end to end over real HTTP: a CLI tool asks for a code,
 * the user approves it in Atrium, and the tool's next poll returns a personal API token that acts as the user.
 */
import http from 'http';
import type { AddressInfo } from 'net';
import { spawn } from 'child_process';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.PA_API_URL = 'off';
process.env.PA_DEFAULT_ORG_ID = '';

import app from '../../app';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { User } from '../auth/user.model';
import { flushAuditLogs } from '../auditLogs/logAudit';
import { createToken } from '../apiTokens/apiToken.service';
import { issueTaskflowAccessTokenForOAuth } from '../auth/auth.service';
import { ApiToken } from '../apiTokens/apiToken.model';
import { McpDeviceCode } from './mcpOAuth.model';
import { DEVICE_GRANT } from './mcpOAuth';

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
let server: http.Server;
let base = '';
const ids: Record<string, string> = {};
let apiToken = '';

const json = async (res: Response) => ({ status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> });
const form = (path: string, body: Record<string, string>) =>
  fetch(`${base}/api/mcp${path}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() }).then(json);
const start = (body: Record<string, string> = {}) => form('/oauth/device_authorization', body);
const poll = (device_code: string, client_id = '') => form('/oauth/token', { grant_type: DEVICE_GRANT, device_code, ...(client_id ? { client_id } : {}) });
async function asUser(method: string, path: string, body?: unknown, bearer?: string) {
  const jwt = bearer ?? (await issueTaskflowAccessTokenForOAuth(ids.ana));
  return json(
    await fetch(`${base}/api/mcp${path}`, {
      method,
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', 'X-Organization-Id': ids.org },
      body: body ? JSON.stringify(body) : undefined,
    })
  );
}
/** Lets the next poll through without tripping "slow down". */
const waitedLongEnough = (userCode: string) => McpDeviceCode.updateOne({ userCode: userCode.replace('-', '') }, { $set: { lastPolledAt: new Date(0) } });
async function whoami(token: string) {
  const res = await fetch(`${base}/api/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'whoami', arguments: {} } }),
  });
  const body = (await res.json()) as { result: { content: Array<{ text: string }> } };
  return JSON.parse(body.result.content[0].text);
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await mongoose.connect(mongo.getUri());
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.MCP_LOOPBACK_URL = `${base}/api`;
  delete process.env.MCP_PUBLIC_URL;
  const ana = await User.create({ email: 'ana@example.com', name: 'Ana', mustChangePassword: false });
  const org = await Organization.create({ name: 'Studio', slug: 'studio', createdBy: ana._id });
  await OrganizationMember.create({ organization: org._id, user: ana._id, role: 'org_member', status: 'active' });
  Object.assign(ids, { ana: String(ana._id), org: String(org._id) });
  apiToken = (await createToken(String(ana._id), String(org._id), { name: 'pasted' })).token;
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  await flushAuditLogs();
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('signing in from a terminal (device flow)', () => {
  it('is advertised next to the browser sign-in', async () => {
    const as = await json(await fetch(`${base}/.well-known/oauth-authorization-server`));
    expect(as.body.device_authorization_endpoint).toBe(`${base}/api/mcp/oauth/device_authorization`);
    expect(as.body.grant_types_supported).toEqual(['authorization_code', DEVICE_GRANT]);
  });

  it('shows a code, waits for approval, then gives the tool a token that acts as the user', async () => {
    const s = await start({ client_name: 'CI runner' });
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ expires_in: 600, interval: 5 });
    expect(s.body.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(s.body.verification_uri).toMatch(/\/auth\/device$/);
    expect(s.body.verification_uri_complete).toBe(`${s.body.verification_uri}?code=${s.body.user_code}`);

    expect((await poll(s.body.device_code, s.body.client_id)).body.error).toBe('authorization_pending');
    // Polling again at once is too fast.
    const fast = await poll(s.body.device_code, s.body.client_id);
    expect(fast.body.error).toBe('slow_down');

    // The user types the code however they like.
    const typed = s.body.user_code.toLowerCase().replace('-', ' ');
    const req = await asUser('GET', `/oauth/device/request?user_code=${encodeURIComponent(typed)}`);
    expect(req.status).toBe(200);
    expect(req.body.data).toMatchObject({ clientName: 'CI runner', userCode: s.body.user_code, workspace: { id: ids.org, name: 'Studio' } });

    expect((await asUser('POST', '/oauth/device/approve', { user_code: typed, approve: true, readOnly: true, expiresInDays: 30 })).status).toBe(200);
    await waitedLongEnough(s.body.user_code);
    const ok = await poll(s.body.device_code, s.body.client_id);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ token_type: 'Bearer', scope: 'atrium' });
    expect(ok.body.access_token).toMatch(/^atr_/);
    expect(ok.body.expires_in).toBeGreaterThan(29 * 86_400);

    expect(await whoami(ok.body.access_token)).toMatchObject({ user: { email: 'ana@example.com' }, workspace: { id: ids.org }, readOnly: true });
    expect(await ApiToken.findOne({ name: 'CI runner (connected)', readOnly: true }).lean()).toBeTruthy();
    // Once only, and the code is gone from the approval page.
    expect((await poll(s.body.device_code)).body.error).toBe('invalid_grant');
    expect((await asUser('GET', `/oauth/device/request?user_code=${s.body.user_code}`)).status).toBe(404);
  });

  it('tells the tool when the user declines or the code expires', async () => {
    const declined = await start();
    expect((await asUser('POST', '/oauth/device/approve', { user_code: declined.body.user_code, approve: false })).status).toBe(200);
    expect((await poll(declined.body.device_code)).body.error).toBe('access_denied');
    expect((await poll(declined.body.device_code)).body.error).toBe('invalid_grant');

    const late = await start();
    await McpDeviceCode.updateOne({ userCode: late.body.user_code.replace('-', '') }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await poll(late.body.device_code)).body.error).toBe('expired_token');
    expect((await asUser('POST', '/oauth/device/approve', { user_code: late.body.user_code, approve: true })).status).toBe(404);
  });

  it('only a signed-in person approves, never with an API token, and wrong codes are refused', async () => {
    const s = await start();
    expect((await asUser('POST', '/oauth/device/approve', { user_code: s.body.user_code, approve: true }, apiToken)).status).toBe(403);
    expect((await asUser('GET', `/oauth/device/request?user_code=${s.body.user_code}`, undefined, 'nonsense')).status).toBe(401);
    expect((await asUser('GET', '/oauth/device/request?user_code=BBBB-BBBB')).status).toBe(404);
    expect((await poll('not-a-real-code')).body.error).toBe('invalid_grant');
    // A device code belongs to the client it was issued to.
    expect((await poll(s.body.device_code, 'mcp_someone_else')).body.error).toBe('invalid_grant');
  });

  it('registered clients can use it, with or without redirect URIs', async () => {
    const reg = await json(
      await fetch(`${base}/api/mcp/oauth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_name: 'My CLI', grant_types: [DEVICE_GRANT], token_endpoint_auth_method: 'none' }),
      })
    );
    expect(reg.status).toBe(201);
    expect(reg.body.grant_types).toEqual([DEVICE_GRANT]);
    const s = await start({ client_id: reg.body.client_id });
    expect(s.body.client_id).toBe(reg.body.client_id);
    expect((await asUser('GET', `/oauth/device/request?user_code=${s.body.user_code}`)).body.data.clientName).toBe('My CLI');
    expect((await start({ client_id: 'mcp_unknown' })).body.error).toBe('invalid_client');
    const bad = await json(await fetch(`${base}/api/mcp/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_types: ['password'] }) }));
    expect(bad.body.error).toBe('invalid_client_metadata');
  });
});

describe('sign-in script for terminals', () => {
  it('is served with this installation’s URL, and nothing else can be written into it', async () => {
    const res = await fetch(`${base}/api/mcp/cli/login.sh`, { headers: { 'X-Forwarded-Host': 'evil.example";rm -rf ~;"' } });
    expect(res.headers.get('content-type')).toMatch(/text\/x-shellscript/);
    const text = await res.text();
    expect(text).toMatch(/^#!\/bin\/sh/);
    // Quotes, semicolons and spaces from a forged header never reach the script.
    const line = text.split('\n').find((l) => l.startsWith('MCP_URL='));
    expect(line).toMatch(/^MCP_URL="[A-Za-z0-9.:/_%-]+"$/);
    expect(text).not.toContain('rm -rf');
    const own = await (await fetch(`${base}/api/mcp/cli/login.sh`)).text();
    expect(own).toContain(`MCP_URL="${base}/api/mcp"`);
  });

  it('really signs a terminal in: run the script, approve the code, get a working token', async () => {
    const script = await (await fetch(`${base}/api/mcp/cli/login.sh`)).text();
    const child = spawn('sh', ['-s'], { env: { ...process.env, ATRIUM_CLIENT_NAME: 'Build box' } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stdin.end(script);
    const code = await new Promise<string>((resolve, reject) => {
      child.stderr.on('data', (d) => {
        stderr += String(d);
        const m = /enter the code:\s+([A-Z]{4}-[A-Z]{4})/.exec(stderr);
        if (m) resolve(m[1]);
      });
      child.on('exit', () => reject(new Error(`script ended early: ${stderr}`)));
    });
    expect(stderr).toContain('/auth/device');
    expect((await asUser('GET', `/oauth/device/request?user_code=${code}`)).body.data.clientName).toBe('Build box');
    await asUser('POST', '/oauth/device/approve', { user_code: code, approve: true });
    const exit = await new Promise<number>((resolve) => child.on('exit', (c) => resolve(c ?? -1)));
    expect(exit).toBe(0);
    const token = stdout.trim();
    expect(token).toMatch(/^atr_/);
    expect(stderr).toContain('Signed in.');
    expect(await whoami(token)).toMatchObject({ user: { email: 'ana@example.com' }, readOnly: false });
  });
});
