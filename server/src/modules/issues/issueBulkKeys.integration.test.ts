import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Project } from '../projects/project.model';
import { ProjectMember } from '../projects/projectMember.model';
import { Issue } from './issue.model';
import { IssueHistory } from './issueHistory.model';
import { bulkUpdateHandler, bulkDeleteHandler, backlogOrderHandler } from './issues.controller';
import { errorHandler } from '../../middleware/errorHandler';

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
let server: Server;
let base = '';
const user = new mongoose.Types.ObjectId();
let app1: mongoose.Types.ObjectId;
let secret: mongoose.Types.ObjectId;

async function call(method: string, path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as { message?: string; data?: { updated?: number; deleted?: number } } };
}

const seed = (key: string, project: mongoose.Types.ObjectId) => Issue.create({ title: key, key, project, reporter: user, status: 'Todo' });
const byKey = (key: string, project = app1) => Issue.findOne({ key, project }).lean();

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: { id: string } }).user = { id: String(user) };
    next();
  });
  app.patch('/bulk', bulkUpdateHandler);
  app.delete('/bulk', bulkDeleteHandler);
  app.put('/order', ...backlogOrderHandler);
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await Promise.all([Project, ProjectMember, Issue, IssueHistory].map((m) => (m as typeof Issue).deleteMany({})));
  const org = new mongoose.Types.ObjectId();
  const [a, s] = await Project.create([
    { name: 'App', key: 'APP', lead: user, taskflowOrganizationId: org },
    { name: 'Secret', key: 'SEC', lead: user, taskflowOrganizationId: org },
  ]);
  app1 = a._id as mongoose.Types.ObjectId;
  secret = s._id as mongoose.Types.ObjectId;
  await ProjectMember.create({ project: app1, user, permissions: [] });
  await seed('APP-1', app1);
  await seed('APP-2', app1);
  await seed('SEC-1', secret);
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('bulk issue endpoints accept keys (AUT-5)', () => {
  it('updates by key, any case, and by id in one call, with history', async () => {
    const two = await byKey('APP-2');
    const res = await call('PATCH', '/bulk', { issueIds: ['app-1', String(two!._id)], updates: { priority: 'High' } });
    expect(res.status).toBe(200);
    expect(res.body.data?.updated).toBe(2);
    expect((await byKey('APP-1'))?.priority).toBe('High');
    const one = await byKey('APP-1');
    expect(await IssueHistory.countDocuments({ issue: one!._id, field: 'priority' })).toBe(1);
  });

  it('treats a key and its id as one issue', async () => {
    const one = await byKey('APP-1');
    const res = await call('PATCH', '/bulk', { issueIds: ['APP-1', String(one!._id)], updates: { priority: 'High' } });
    expect(res.status).toBe(200);
    expect(await IssueHistory.countDocuments({ issue: one!._id })).toBe(1);
  });

  it.each([['APP-999'], ['SEC-1'], ['not a key'], ['507f1f77bcf86cd799439011']])('rejects %s with 400 and changes nothing', async (ref) => {
    const res = await call('PATCH', '/bulk', { issueIds: ['APP-1', ref], updates: { priority: 'High' } });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain(ref);
    expect((await byKey('APP-1'))?.priority).not.toBe('High');
    expect((await byKey('SEC-1', secret))?.priority).not.toBe('High');
  });

  it('deletes by key, and never touches a project the user is not in', async () => {
    expect((await call('DELETE', '/bulk', { issueIds: ['APP-1', 'SEC-1'] })).status).toBe(400);
    expect(await Issue.countDocuments({})).toBe(3);
    const res = await call('DELETE', '/bulk', { issueIds: ['APP-1'] });
    expect(res.status).toBe(200);
    expect(await byKey('APP-1')).toBeNull();
    expect(await Issue.countDocuments({})).toBe(2);
  });

  it('orders the backlog by key', async () => {
    const res = await call('PUT', '/order', { issueIds: ['APP-2', 'APP-1'] });
    expect(res.status).toBe(200);
    expect(res.body.data?.updated).toBe(2);
  });
});
