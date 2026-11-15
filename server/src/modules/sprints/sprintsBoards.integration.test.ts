/**
 * Sprints ↔ boards over real HTTP: a sprint always runs on a Scrum board of its own project, boards keep their
 * sprints when changed or deleted, and both are limited to project members with the right permissions.
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
import { flushAuditLogs } from '../auditLogs/logAudit';
import { createToken } from '../apiTokens/apiToken.service';
import { createDefaultDesignations } from '../projects/projectDesignation.service';
import { ensureUserIsDefaultProjectMember } from '../projects/projectInvitations.service';

jest.setTimeout(180_000);

let mongo: MongoMemoryServer;
let server: http.Server;
let base = '';
const t: Record<string, string> = {};
const id: Record<string, string> = {};

type Json = { success?: boolean; message?: string; data?: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
async function req(token: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
}

async function mcp(token: string, name: string, args: Record<string, unknown>) {
  const res = await fetch(`${base}/api/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content: Array<{ text: string }>; isError?: boolean } };
  const text = body.result?.content?.[0]?.text ?? '';
  return { isError: Boolean(body.result?.isError), data: JSON.parse(text.startsWith('{') || text.startsWith('[') ? text : 'null'), text };
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
  const org = await Organization.create({ name: 'Studio', slug: 'studio', createdBy: lead._id });
  await OrganizationMember.create([lead, mem, out].map((u) => ({ organization: org._id, user: u._id, role: 'org_member', status: 'active' })));
  const [app1, other] = await Project.create([
    { name: 'App', key: 'APP', lead: lead._id, taskflowOrganizationId: org._id },
    { name: 'Other', key: 'OTH', lead: lead._id, taskflowOrganizationId: org._id },
  ]);
  for (const p of [app1, other]) {
    await createDefaultDesignations(String(p._id));
    await ensureUserIsDefaultProjectMember(String(p._id), String(mem._id));
  }
  Object.assign(id, { app: String(app1._id), other: String(other._id) });
  t.mem = (await createToken(String(mem._id), String(org._id), { name: 'm' })).token;
  t.out = (await createToken(String(out._id), String(org._id), { name: 'o' })).token;
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  await flushAuditLogs();
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('sprints and boards', () => {
  it('puts a sprint on the project’s Scrum board, creating one when there is none', async () => {
    const first = await req(t.mem, 'POST', '/sprints', { name: 'Sprint 1', project: id.app });
    expect(first.status).toBe(201);
    expect(first.body.data.boardCreated).toBe(true);
    expect(first.body.data.board).toMatchObject({ name: 'APP Scrum', type: 'Scrum' });
    id.scrum = first.body.data.board._id;
    id.s1 = first.body.data._id;

    const board = await req(t.mem, 'GET', `/boards/${id.scrum}`);
    expect(board.body.data.columns.map((c: { name: string }) => c.name)).toEqual(['Backlog', 'Todo', 'In Progress', 'Done']);

    const second = await req(t.mem, 'POST', '/sprints', { name: 'Sprint 2', project: id.app });
    expect(second.body.data.board._id).toBe(id.scrum);
    expect(second.body.data.boardCreated).toBeUndefined();
    id.s2 = second.body.data._id;
  });

  it('refuses Kanban boards and boards of another project', async () => {
    const kanban = await req(t.mem, 'POST', '/boards', { name: 'Flow', type: 'Kanban', project: id.app });
    expect(kanban.status).toBe(201);
    id.kanban = kanban.body.data._id;
    const onKanban = await req(t.mem, 'POST', '/sprints', { name: 'X', project: id.app, board: id.kanban });
    expect(onKanban.status).toBe(400);
    expect(onKanban.body.message).toMatch(/Kanban/);

    const otherBoard = await req(t.mem, 'POST', '/boards', { name: 'Other scrum', type: 'Scrum', project: id.other });
    const foreign = await req(t.mem, 'POST', '/sprints', { name: 'X', project: id.app, board: otherBoard.body.data._id });
    expect(foreign.status).toBe(400);
  });

  it('shows each board’s sprints and the one running', async () => {
    expect((await req(t.mem, 'POST', `/sprints/${id.s1}/start`)).status).toBe(200);
    const boards = await req(t.mem, 'GET', `/boards?project=${id.app}`);
    const scrum = boards.body.data.data.find((b: { _id: string }) => b._id === id.scrum);
    expect(scrum).toMatchObject({ sprintCount: 2, activeSprint: { name: 'Sprint 1' } });
    const onBoard = await req(t.mem, 'GET', `/sprints?board=${id.scrum}`);
    expect(onBoard.body.data.total).toBe(2);
  });

  it('moves sprints between Scrum boards of the project only', async () => {
    const second = await req(t.mem, 'POST', '/boards', { name: 'Team B', type: 'Scrum', project: id.app });
    id.scrumB = second.body.data._id;
    const moved = await req(t.mem, 'PATCH', `/sprints/${id.s2}`, { board: id.scrumB });
    expect(moved.status).toBe(200);
    expect(moved.body.data.board._id).toBe(id.scrumB);
    expect((await req(t.mem, 'PATCH', `/sprints/${id.s2}`, { board: id.kanban })).status).toBe(400);
    expect((await req(t.mem, 'PATCH', `/sprints/${id.s2}`, { status: 'active' })).status).toBe(400);
  });

  it('keeps sprints when a board changes type or is deleted', async () => {
    const toKanban = await req(t.mem, 'PATCH', `/boards/${id.scrumB}`, { type: 'Kanban' });
    expect(toKanban.status).toBe(400);

    const del = await req(t.mem, 'DELETE', `/boards/${id.scrumB}`);
    expect(del.status).toBe(200);
    expect(del.body.data).toMatchObject({ movedSprints: 1, movedTo: { _id: id.scrum } });
    expect((await req(t.mem, 'GET', `/sprints/${id.s2}`)).body.data.board._id).toBe(id.scrum);

    // The last Scrum board can't take its sprints anywhere.
    const last = await req(t.mem, 'DELETE', `/boards/${id.scrum}`);
    expect(last.status).toBe(400);
    expect((await req(t.mem, 'DELETE', `/boards/${id.kanban}`)).status).toBe(200);
  });

  it('lets members with "edit sprints" run the sprint cycle', async () => {
    expect((await req(t.mem, 'GET', `/sprints/${id.s1}/completion-preview`)).status).toBe(200);
    expect((await req(t.mem, 'POST', `/sprints/${id.s1}/complete`)).status).toBe(200);
  });

  it('keeps non-members out', async () => {
    expect((await req(t.out, 'GET', `/sprints?project=${id.app}`)).status).toBe(403);
    expect((await req(t.out, 'GET', `/sprints/${id.s2}`)).status).toBe(403);
    expect((await req(t.out, 'POST', '/sprints', { name: 'X', project: id.app })).status).toBe(403);
    expect((await req(t.out, 'POST', `/sprints/${id.s2}/start`)).status).toBe(403);
    expect((await req(t.out, 'DELETE', `/sprints/${id.s2}`)).status).toBe(403);
    expect((await req(t.out, 'GET', `/boards?project=${id.app}`)).status).toBe(403);
    expect((await req(t.out, 'GET', `/boards/${id.scrum}`)).status).toBe(403);
    expect((await req(t.out, 'POST', '/boards', { name: 'X', type: 'Scrum', project: id.app })).status).toBe(403);
    // Without a project, lists only cover the caller's own projects.
    expect((await req(t.out, 'GET', '/sprints')).body.data.total).toBe(0);
    expect((await req(t.out, 'GET', '/boards')).body.data.total).toBe(0);
    expect((await req(t.mem, 'GET', '/sprints')).body.data.total).toBeGreaterThan(0);
  });

  it('works through MCP', async () => {
    const created = await mcp(t.mem, 'create_sprint', { project: 'OTH', name: 'From Claude', board: 'Other scrum' });
    expect(created.isError).toBe(false);
    expect(created.data).toMatchObject({ sprint: { name: 'From Claude' }, board: { name: 'Other scrum', created: false } });
    const boards = await mcp(t.mem, 'list_boards', { project: 'OTH' });
    expect(boards.data).toEqual([expect.objectContaining({ name: 'Other scrum', type: 'Scrum', sprints: 1 })]);
    const sprints = await mcp(t.mem, 'list_sprints', { project: 'OTH' });
    expect(sprints.data.sprints[0]).toMatchObject({ name: 'From Claude', board: 'Other scrum' });
  });
});
