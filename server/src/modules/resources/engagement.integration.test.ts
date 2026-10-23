/**
 * Engagement sources end to end against an in-memory Mongo: assigned task estimates, logged time,
 * calendar meetings and manual entries all land on the right day, and the settings toggles work.
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { User } from '../auth/user.model';
import { Project } from '../projects/project.model';
import { Issue } from '../issues/issue.model';
import { WorkLog } from '../workLogs/workLog.model';
import { CalendarEvent } from '../calendar/models/calendarEvent.model';
import { flushAuditLogs } from '../auditLogs/logAudit';
import { getEngagement } from './engagement.service';
import { createEntry } from './engagementEntries.service';
import { updateResourceSettings } from './resourceSettings.service';

jest.setTimeout(120_000);

const DAY_MS = 24 * 60 * 60 * 1000;
let mongo: MongoMemoryServer;
const ids: Record<string, string> = {};

function utcDay(offset: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offset * DAY_MS);
}

/** First Mon–Fri day found stepping from `start` by `step` days. */
function weekday(start: number, step: number): Date {
  for (let i = start; ; i += step) {
    const d = utcDay(i);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) return d;
  }
}

const key = (d: Date) => d.toISOString().slice(0, 10);
const past = weekday(-1, -1);
const future = weekday(2, 1);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  const [lead, dev] = await User.create([
    { email: 'lead@example.com', name: 'Lead', mustChangePassword: false },
    { email: 'dev@example.com', name: 'Dev', mustChangePassword: false },
  ]);
  const org = await Organization.create({ name: 'Studio', slug: 'studio', createdBy: lead._id });
  await OrganizationMember.create([
    { organization: org._id, user: lead._id, role: 'org_admin', status: 'active' },
    { organization: org._id, user: dev._id, role: 'org_member', status: 'active' },
  ]);
  const project = await Project.create({ name: 'App', key: 'APP', lead: lead._id, taskflowOrganizationId: org._id });
  const [dated, undated] = await Issue.create([
    // 4h of estimated work due on the future day.
    { title: 'Dated', key: 'APP-1', project: project._id, reporter: lead._id, assignee: dev._id, startDate: future, dueDate: future, timeEstimateMinutes: 240 },
    // No deadline: never placed on the calendar, but time logged on it still counts.
    { title: 'Undated', key: 'APP-2', project: project._id, reporter: lead._id, assignee: dev._id },
  ]);
  await WorkLog.create({ issue: undated._id, author: dev._id, minutesSpent: 360, date: past });
  await CalendarEvent.create({
    taskflowOrganizationId: org._id,
    title: 'Planning',
    start: new Date(future.getTime() + 10 * 3_600_000),
    end: new Date(future.getTime() + 11 * 3_600_000),
    ownerId: lead._id,
    attendeeIds: [dev._id],
  });
  Object.assign(ids, { org: String(org._id), lead: String(lead._id), dev: String(dev._id), dated: String(dated._id) });
});

afterAll(async () => {
  await flushAuditLogs();
  await mongoose.disconnect();
  await mongo.stop();
});

async function devDay(date: Date) {
  const report = await getEngagement(ids.org, { from: key(past), to: key(future), userId: ids.dev });
  const day = report.people[0].days.find((d) => d.date === key(date));
  if (!day) throw new Error(`no row for ${key(date)}`);
  return { report, day };
}

describe('engagement sources', () => {
  it('counts logged time on past days', async () => {
    const { day } = await devDay(past);
    expect(day).toMatchObject({ loggedHours: 6, workHours: 6, engagementPct: 75 });
  });

  it('adds manual entries and meetings to task work on future days', async () => {
    const entry = await createEntry(ids.org, { id: ids.dev, canManageOthers: false }, {
      title: 'Support rota',
      category: 'Support',
      startDate: key(future),
      mode: 'hours',
      value: 2,
    });
    expect(entry).toMatchObject({ title: 'Support rota', mode: 'hours', value: 2 });

    const { report, day } = await devDay(future);
    // 8h day: 4h task + 2h manual + 1h meeting.
    expect(day).toMatchObject({ taskHours: 4, manualHours: 2, meetingHours: 1, meetingCount: 1, workHours: 7, engagementPct: 88 });
    expect(report.people[0].entries).toHaveLength(1);
    expect(report.summary).toMatchObject({ manualHours: 2, meetingHours: 1, manualEntries: 1 });
  });

  it('lets people manage only their own entries unless they are managers', async () => {
    await expect(
      createEntry(ids.org, { id: ids.dev, canManageOthers: false }, { userId: ids.lead, title: 'x', startDate: key(future), value: 1 })
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      createEntry(ids.org, { id: ids.lead, canManageOthers: true }, { userId: ids.dev, title: 'Pre-sales', startDate: key(future), mode: 'percent', value: 10 })
    ).resolves.toBeTruthy();
  });

  it('honours the logged-time and calendar toggles', async () => {
    await updateResourceSettings(ids.org, { includeLoggedTime: false, includeCalendarEvents: false });
    expect((await devDay(past)).day).toMatchObject({ loggedHours: 0, engagementPct: 0 });
    expect((await devDay(future)).day).toMatchObject({ meetingHours: 0 });
  });
});
