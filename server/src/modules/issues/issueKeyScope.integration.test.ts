import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Project } from '../projects/project.model';
import { Issue } from './issue.model';
import * as issuesService from './issues.service';
import { resolveProjectRef } from './issueKey';
import { migrateIssueKeyIndexIfNeeded } from '../../migrations/migrateDataScopes';

jest.mock('../projectRules/projectRules.automation', () => ({ runIssueAutomations: async () => undefined }));
jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const user = String(new mongoose.Types.ObjectId());
const project = async (key: string, ws: mongoose.Types.ObjectId, extra: Record<string, unknown> = {}) =>
  String((await Project.create({ name: key, key, lead: user, taskflowOrganizationId: ws, ...extra }))._id);
const create = async (p: string) => ((await issuesService.create({ project: p, title: 'x' }, user, { syncOrigin: 'ado' })) as { key: string }).key;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('issue keys are unique per project (AUT-66)', () => {
  it('fixes the old global index, so two workspaces can both have PC-1', async () => {
    // A database from before: one unique index on key alone.
    await Issue.collection.dropIndexes().catch(() => undefined);
    await Issue.collection.createIndex({ key: 1 }, { unique: true, sparse: true });
    expect((await migrateIssueKeyIndexIfNeeded()).dropped).toBe(true);
    const a = await project('PC', new mongoose.Types.ObjectId());
    const b = await project('PC', new mongoose.Types.ObjectId());
    expect(await create(a)).toBe('PC-1');
    expect(await create(b)).toBe('PC-1');
    // Still unique inside one project.
    await expect(Issue.create({ title: 'dupe', key: 'PC-1', project: a, reporter: user })).rejects.toMatchObject({ code: 11000 });
  });

  it('moves on to the next number when the counter is behind existing keys', async () => {
    const p = await project('LAG', new mongoose.Types.ObjectId(), { nextIssueNumber: 0 });
    await Issue.create({ title: 'imported', key: 'LAG-1', project: p, reporter: user });
    await Issue.create({ title: 'imported', key: 'LAG-2', project: p, reporter: user });
    expect(await create(p)).toBe('LAG-3');
  });

  it('resolves a project key only within the given workspace', async () => {
    const ws = new mongoose.Types.ObjectId();
    const mine = await project('ZED', ws);
    await project('ZED', new mongoose.Types.ObjectId());
    expect(await resolveProjectRef('zed', String(ws))).toBe(mine);
    expect(await resolveProjectRef('NOPE', String(ws))).toBeNull();
  });
});
