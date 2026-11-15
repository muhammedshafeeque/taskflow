/**
 * MCP as an ordinary project member (default "Project Member" designation, no global project rights):
 * what the member may do in Atrium must also work through the assistant, and only in the active workspace.
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
import { Issue } from '../issues/issue.model';
import { flushAuditLogs } from '../auditLogs/logAudit';
import { createToken } from '../apiTokens/apiToken.service';
import { createDefaultDesignations } from '../projects/projectDesignation.service';
import { ensureUserIsDefaultProjectMember } from '../projects/projectInvitations.service';

jest.setTimeout(180_000);

let mongo: MongoMemoryServer;
let server: http.Server;
let base = '';
const t: Record<string, string> = {};

let rpcId = 0;
async function call(token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`${base}/api/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content: Array<{ text: string }>; isError?: boolean }; error?: { message: string } };
  const text = body.result?.content?.[0]?.text ?? body.error?.message ?? '';
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { isError: Boolean(body.result?.isError || body.error), data, text };
}

async function rest(token: string, path: string) {
  const res = await fetch(`${base}/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: (await res.json()) as { data?: { total?: number } } };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await mongoose.connect(mongo.getUri());
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.MCP_LOOPBACK_URL = `${base}/api`;

  const [lead, mem, out] = await User.create([
    { email: 'lead@example.com', name: 'Lead', mustChangePassword: false },
    { email: 'mem@example.com', name: 'Mem', mustChangePassword: false },
    { email: 'out@example.com', name: 'Out', mustChangePassword: false },
  ]);
  // A second workspace, created first, where Mem is also on a project keyed APP with its own APP-1.
  const other = await Organization.create({ name: 'Other', slug: 'other', createdBy: lead._id });
  const org = await Organization.create({ name: 'Studio', slug: 'studio', createdBy: lead._id });
  await OrganizationMember.create([
    { organization: org._id, user: lead._id, role: 'org_member', status: 'active' },
    { organization: org._id, user: mem._id, role: 'org_member', status: 'active' },
    { organization: org._id, user: out._id, role: 'org_member', status: 'active' },
    { organization: other._id, user: mem._id, role: 'org_member', status: 'active' },
  ]);
  const otherApp = await Project.create({ name: 'Other app', key: 'APP', lead: lead._id, taskflowOrganizationId: other._id });
  const app1 = await Project.create({ name: 'App', key: 'APP', lead: lead._id, taskflowOrganizationId: org._id });
  for (const p of [otherApp, app1]) {
    await createDefaultDesignations(String(p._id));
    await ensureUserIsDefaultProjectMember(String(p._id), String(mem._id));
  }
  await Issue.create([
    { title: 'Elsewhere', key: 'APP-1', project: otherApp._id, reporter: lead._id, status: 'To Do' },
    { title: 'Login screen', key: 'APP-1', project: app1._id, reporter: lead._id, assignee: mem._id, status: 'To Do' },
  ]);
  t.app = String(app1._id);
  t.mem = (await createToken(String(mem._id), String(org._id), { name: 'claude' })).token;
  t.out = (await createToken(String(out._id), String(org._id), { name: 'claude' })).token;
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  await flushAuditLogs();
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('MCP for a default project member', () => {
  it('resolves issue keys in the active workspace only', async () => {
    const issue = await call(t.mem, 'get_issue', { issue: 'APP-1' });
    expect(issue.isError).toBe(false);
    expect(issue.data).toMatchObject({ key: 'APP-1', title: 'Login screen' });

    const found = await call(t.mem, 'search_issues', { text: 'APP-1' });
    expect((found.data as { issues: Array<{ title: string }> }).issues.map((i) => i.title)).toEqual(['Login screen']);
    const jql = await call(t.mem, 'jql_search', { jql: 'key = APP-1' });
    expect((jql.data as { total: number }).total).toBe(1);
  });

  it('can see what it may change: work logs and comments', async () => {
    expect((await call(t.mem, 'log_work', { issue: 'APP-1', minutes: 30 })).isError).toBe(false);
    const logs = await call(t.mem, 'list_work_logs', { issue: 'APP-1' });
    expect(logs.isError).toBe(false);
    expect((logs.data as { total: number }).total).toBe(1);

    expect((await call(t.mem, 'add_comment', { issue: 'APP-1', body: 'hello' })).isError).toBe(false);
    const issue = await call(t.mem, 'get_issue', { issue: 'APP-1' });
    expect((issue.data as { comments: unknown[]; unavailable?: unknown }).comments).toHaveLength(1);
    expect((issue.data as { unavailable?: unknown }).unavailable).toBeUndefined();
  });

  it('only offers tools the user can use', async () => {
    const res = await call(t.mem, 'my_allocations');
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/not found/i);
  });

  it('keeps non-members out of a project’s issues', async () => {
    expect((await rest(t.out, `/issues?project=${t.app}`)).body.data?.total).toBe(0);
    expect((await rest(t.out, `/issues/by-key?project=${t.app}&key=APP-1`)).status).toBe(403);
    expect((await rest(t.out, `/issues/search?project=${t.app}&q=Login`)).status).toBe(403);
    expect((await call(t.out, 'get_issue', { issue: 'APP-1' })).isError).toBe(true);
  });
});
