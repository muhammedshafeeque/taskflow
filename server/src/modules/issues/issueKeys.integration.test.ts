import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Project } from '../projects/project.model';
import { Issue } from './issue.model';
import * as issuesService from './issues.service';

// Background automations aren't under test and would outlive the database.
jest.mock('../projectRules/projectRules.automation', () => ({ runIssueAutomations: async () => undefined }));

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const user = String(new mongoose.Types.ObjectId());

async function newProject(key: string, extra: Record<string, unknown> = {}) {
  const doc = await Project.create({ name: key, key, lead: user, taskflowOrganizationId: new mongoose.Types.ObjectId(), ...extra });
  return String(doc._id);
}

async function create(project: string, title = 'Issue') {
  return ((await issuesService.create({ project, title }, user, { syncOrigin: 'ado' })) as { key: string }).key;
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('issue keys (AUT-4)', () => {
  it('starts a new project at -1 and counts up', async () => {
    const p = await newProject('NEW');
    expect([await create(p), await create(p), await create(p)]).toEqual(['NEW-1', 'NEW-2', 'NEW-3']);
  });

  it('continues an existing project without reusing a key', async () => {
    const p = await newProject('OLD', { nextIssueNumber: 45 });
    await Issue.create({ title: 'Last', key: 'OLD-45', project: p, reporter: user });
    expect(await create(p)).toBe('OLD-46');
  });

  it('starts at -1 when a legacy project has no counter', async () => {
    const p = await newProject('LEG');
    await Project.collection.updateOne({ _id: new mongoose.Types.ObjectId(p) }, { $unset: { nextIssueNumber: 1 } });
    expect(await create(p)).toBe('LEG-1');
  });

  it('gives unique keys to issues created at the same time', async () => {
    const p = await newProject('PAR');
    const keys = await Promise.all(Array.from({ length: 10 }, (_, i) => create(p, `Issue ${i}`)));
    expect(keys.map((k) => Number(k.split('-')[1])).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
