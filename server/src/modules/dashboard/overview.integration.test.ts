/**
 * PM dashboard overview against an in-memory Mongo: membership scoping, completion from status history,
 * overdue / unassigned counts, sprint progress and project health.
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Organization } from '../organizations/organization.model';
import { User } from '../auth/user.model';
import { Project } from '../projects/project.model';
import { ProjectMember } from '../projects/projectMember.model';
import { Issue } from '../issues/issue.model';
import { IssueHistory } from '../issues/issueHistory.model';
import { Sprint } from '../sprints/sprint.model';
import { WorkLog } from '../workLogs/workLog.model';
import { getOverview } from './overview.service';

jest.setTimeout(120_000);

const DAY_MS = 24 * 60 * 60 * 1000;
let mongo: MongoMemoryServer;
const ids: Record<string, string> = {};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await mongoose.connect(mongo.getUri());
  const [pm, dev] = await User.create([
    { email: 'pm@example.com', name: 'PM', mustChangePassword: false },
    { email: 'dev@example.com', name: 'Dev', mustChangePassword: false },
  ]);
  const org = await Organization.create({ name: 'Studio', slug: 'studio', createdBy: pm._id });
  const statuses = [
    { id: 'todo', name: 'To Do', order: 0 },
    { id: 'doing', name: 'Doing', order: 1 },
    { id: 'done', name: 'Done', order: 2, isClosed: true },
  ];
  const [app, hidden] = await Project.create([
    { name: 'App', key: 'APP', lead: pm._id, taskflowOrganizationId: org._id, statuses },
    { name: 'Hidden', key: 'HID', lead: dev._id, taskflowOrganizationId: org._id, statuses },
  ]);
  await ProjectMember.create([
    { project: app._id, user: pm._id },
    { project: app._id, user: dev._id },
    { project: hidden._id, user: dev._id },
  ]);
  const board = await mongoose.connection.collection('boards').insertOne({ name: 'B', type: 'Scrum', project: app._id, columns: [] });
  const now = Date.now();
  const sprint = await Sprint.create({
    name: 'Sprint 1',
    project: app._id,
    board: board.insertedId,
    status: 'active',
    startDate: new Date(now - 5 * DAY_MS),
    endDate: new Date(now + 5 * DAY_MS),
  });
  const [overdue, , done] = await Issue.create([
    { title: 'Late', key: 'APP-1', project: app._id, reporter: pm._id, assignee: pm._id, status: 'To Do', dueDate: new Date(now - 3 * DAY_MS), sprint: sprint._id },
    { title: 'Nobody', key: 'APP-2', project: app._id, reporter: pm._id, status: 'Doing', dueDate: new Date(now + 2 * DAY_MS), sprint: sprint._id },
    { title: 'Shipped', key: 'APP-3', project: app._id, reporter: pm._id, assignee: dev._id, status: 'Done', sprint: sprint._id },
    { title: 'Secret', key: 'HID-1', project: hidden._id, reporter: dev._id, assignee: dev._id, status: 'To Do' },
  ]);
  await IssueHistory.create({ issue: done._id, author: dev._id, action: 'field_change', field: 'status', fromValue: 'Doing', toValue: 'Done' });
  await WorkLog.create({ issue: overdue._id, author: pm._id, minutesSpent: 90, date: new Date() });
  Object.assign(ids, { org: String(org._id), pm: String(pm._id), dev: String(dev._id), app: String(app._id) });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('dashboard overview', () => {
  it('scopes to the projects the user is a member of', async () => {
    const o = await getOverview(ids.pm, ids.org);
    expect(o.scope.projects).toBe(1);
    expect(o.projects.map((p) => p.key)).toEqual(['APP']);
    expect(o.kpis.totalIssues).toBe(3);
  });

  it('counts open, overdue, unassigned, completion and logged time', async () => {
    const o = await getOverview(ids.pm, ids.org);
    expect(o.kpis.openIssues).toBe(2);
    expect(o.kpis.overdue).toBe(1);
    expect(o.kpis.unassigned).toBe(1);
    expect(o.kpis.dueThisWeek).toBe(1);
    expect(o.kpis.completedThisWeek).toBe(1);
    expect(o.kpis.loggedHoursThisWeek).toBe(1.5);
    expect(o.trend[o.trend.length - 1]).toMatchObject({ completed: 1, created: 3 });
    expect(o.byStatus.map((s) => s.name)).toEqual(['To Do', 'Doing', 'Done']);
    expect(o.aging[0]).toEqual({ label: '0–7 days', count: 2 });
  });

  it('reports sprint progress, health, my work and team load', async () => {
    const o = await getOverview(ids.pm, ids.org);
    expect(o.sprints[0]).toMatchObject({ name: 'Sprint 1', total: 3, done: 1, progressPct: 33 });
    // 1 of 2 dated open issues is overdue → over 25% → off track.
    expect(o.projects[0].health).toBe('off_track');
    expect(o.myWork).toMatchObject({ open: 1, overdue: 1 });
    expect(o.attention.unassignedDueSoon.map((i) => i.key)).toEqual(['APP-2']);
    expect(o.team.find((t) => t.name === 'Dev')).toMatchObject({ open: 0, completed14: 1 });
  });
});
