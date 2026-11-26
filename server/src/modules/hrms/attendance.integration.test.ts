import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { User } from '../auth/user.model';
import { Role } from '../roles/role.model';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { createToken } from '../apiTokens/apiToken.service';
import { authMiddleware } from '../../middleware/auth.middleware';
import { errorHandler } from '../../middleware/errorHandler';
import { selfServiceRouter } from '../me/selfService.routes';
import { migrateAttendanceDaysIfNeeded } from '../../migrations/migrateAttendanceDays';
import { hrmsRoutes } from './hrms.routes';
import { attendanceDay, ownToday } from './attendanceDay';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsAttendance } from './models/hrmsAttendance.model';

jest.setTimeout(120_000);
let mongo: MongoMemoryServer;
let server: Server;
let base = '';
let org: mongoose.Types.ObjectId;
const emp: Record<string, string> = {};
const token: Record<string, string> = {};
const call = async (who: string, method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as { message?: string; data?: any } };
};
const rowsOf = (who: string) => HrmsAttendance.find({ employeeId: emp[who] }).lean();

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const app = express();
  app.use(express.json());
  app.use('/me/hr', authMiddleware, selfServiceRouter);
  app.use('/hrms', hrmsRoutes);
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  await HrmsAttendance.syncIndexes();
  org = (await Organization.create({ name: 'Co', slug: 'co', createdBy: new mongoose.Types.ObjectId() }))._id as mongoose.Types.ObjectId;
  const hr = await Role.create({ name: 'HR', permissions: ['taskflow.hr.attendance.manage', 'taskflow.hr.attendance.read', 'taskflow.hr.scope.all'] });
  const staff = await Role.create({ name: 'Staff', permissions: ['taskflow.self.attendance.mark'] });
  for (const name of ['hana', 'jo', 'dev', 'left']) {
    const user = await User.create({ email: `${name}@example.com`, name, password: 'Passw0rd!x', mustChangePassword: false, roleId: name === 'hana' ? hr._id : staff._id });
    await OrganizationMember.create({ organization: org, user: user._id, role: 'org_member', status: 'active' });
    token[name] = (await createToken(String(user._id), String(org), { name: 't' })).token;
    emp[name] = String((await HrmsEmployee.create({ taskflowOrganizationId: org, userId: user._id, employeeCode: name, name, joinedDate: new Date(), status: name === 'left' ? 'terminated' : 'active' }))._id);
  }
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('attendance days (AUT-20)', () => {
  it('stores HR and self-service marks for the same day as one record', async () => {
    const today = new Date().toISOString().slice(0, 10);
    expect((await call('jo', 'POST', '/me/hr/attendance', { status: 'remote', date: today })).status).toBe(200);
    expect((await call('hana', 'POST', '/hrms/attendance', { employeeId: emp.jo, date: today, status: 'present' })).status).toBe(201);
    const rows = await rowsOf('jo');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'present', date: new Date(`${today}T00:00:00Z`) });
  });

  it('reads a local-midnight timestamp as the day it stands for', () => {
    expect(attendanceDay('2026-12-01T18:30:00.000Z').toISOString()).toBe('2026-12-02T00:00:00.000Z'); // midnight in India
    expect(attendanceDay('2026-12-02').toISOString()).toBe('2026-12-02T00:00:00.000Z');
    expect(() => attendanceDay('soon')).toThrow();
  });

  it("uses the employee's own today, within a day of the server's", () => {
    const now = new Date('2026-12-01T20:00:00Z'); // 1:30 am on the 2nd in India
    expect(ownToday('2026-12-02', now).toISOString()).toBe('2026-12-02T00:00:00.000Z');
    expect(ownToday(undefined, now).toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(() => ownToday('2026-12-09', now)).toThrow(/today/);
  });

  it('refuses unknown statuses and impossible hours', async () => {
    expect((await call('hana', 'POST', '/hrms/attendance', { employeeId: emp.jo, date: '2026-12-02', status: 'sleeping' })).status).toBe(400);
    expect((await call('hana', 'POST', '/hrms/attendance', { employeeId: emp.jo, date: '2026-12-02', hoursWorked: 30 })).status).toBe(400);
    expect(await rowsOf('jo')).toHaveLength(0);
  });
});

describe('marking many at once (AUT-20)', () => {
  it('marks everyone chosen for one day, and replaces earlier marks', async () => {
    await call('hana', 'POST', '/hrms/attendance', { employeeId: emp.jo, date: '2026-12-02', status: 'absent' });
    const res = await call('hana', 'POST', '/hrms/attendance/bulk', { employeeIds: [emp.jo, emp.dev, emp.dev], date: '2026-12-02', status: 'present' });
    expect(res.body.data).toEqual({ marked: 2, created: 1, updated: 1 });
    expect((await HrmsAttendance.find({ date: new Date('2026-12-02T00:00:00Z') }).lean()).map((r) => [r.status, r.hoursWorked])).toEqual([['present', 8], ['present', 8]]);
  });

  it('refuses leavers, strangers, an empty list and staff without attendance rights', async () => {
    const bulk = (who: string, body: unknown) => call(who, 'POST', '/hrms/attendance/bulk', body).then((r) => r.status);
    expect(await bulk('hana', { employeeIds: [emp.jo, emp.left], date: '2026-12-02' })).toBe(400);
    expect(await bulk('hana', { employeeIds: [emp.jo, String(new mongoose.Types.ObjectId())], date: '2026-12-02' })).toBe(400);
    expect(await bulk('hana', { employeeIds: [], date: '2026-12-02' })).toBe(400);
    expect(await bulk('hana', { employeeIds: [emp.jo] })).toBe(400);
    expect(await bulk('jo', { employeeIds: [emp.jo], date: '2026-12-02' })).toBe(403);
    expect(await HrmsAttendance.countDocuments()).toBe(0);
  });
});

describe('merging old records (AUT-20)', () => {
  it('moves every record to its calendar day and keeps the latest of duplicates, once', async () => {
    const raw = mongoose.connection.collection('hrmsattendances');
    await HrmsAttendance.collection.dropIndexes().catch(() => undefined);
    const o = { taskflowOrganizationId: org, employeeId: new mongoose.Types.ObjectId(emp.jo) };
    await raw.insertMany([
      { ...o, date: new Date('2026-12-01T18:30:00Z'), status: 'absent', updatedAt: new Date('2026-12-02T09:00:00Z') }, // HR, India
      { ...o, date: new Date('2026-12-02T00:00:00Z'), status: 'present', updatedAt: new Date('2026-12-02T04:00:00Z') }, // self
      { ...o, date: new Date('2026-12-02T18:30:00Z'), status: 'remote', updatedAt: new Date('2026-12-03T09:00:00Z') },
    ]);
    expect(await migrateAttendanceDaysIfNeeded()).toEqual({ moved: 2, merged: 1 });
    const rows = (await rowsOf('jo')).map((r) => [r.date.toISOString().slice(0, 10), r.status]).sort();
    expect(rows).toEqual([['2026-12-02', 'absent'], ['2026-12-03', 'remote']]);
    await HrmsAttendance.syncIndexes();
    expect(await migrateAttendanceDaysIfNeeded()).toEqual({ moved: 0, merged: 0 });
  });
});
