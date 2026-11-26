import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { User } from '../auth/user.model';
import { Role } from '../roles/role.model';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { AuditLog } from '../auditLogs/auditLog.model';
import { flushAuditLogs } from '../auditLogs/logAudit';
import { createToken } from '../apiTokens/apiToken.service';
import { notifyUser } from '../notifications/notificationDispatch.service';
import { authMiddleware } from '../../middleware/auth.middleware';
import { errorHandler } from '../../middleware/errorHandler';
import { selfServiceRouter } from '../me/selfService.routes';
import { hrmsRoutes } from './hrms.routes';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsLeaveRequest } from './models/hrmsLeaveRequest.model';

jest.mock('../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
let server: Server;
let base = '';
let org: mongoose.Types.ObjectId;
const u: Record<string, string> = {};
const emp: Record<string, string> = {};
const token: Record<string, string> = {};

async function call(who: string, method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as { message?: string; data?: any } };
}
const edit = (who: string, body: unknown) => call('hana', 'PATCH', `/hrms/employees/${emp[who]}`, body);
const decide = (who: string, id: unknown, status: string) => call(who, 'PATCH', `/me/hr/team/leave/${id}/decision`, { status }).then((r) => r.status);
const leaveFor = async (who: string, extra: Record<string, unknown> = {}) =>
  HrmsLeaveRequest.create({ taskflowOrganizationId: org, employeeId: emp[who], type: 'annual', startDate: new Date('2026-12-01'), endDate: new Date('2026-12-02'), days: 2, ...extra });
const told = () => (notifyUser as jest.Mock).mock.calls.map(([c]) => c as { userId: string; link: string; title: string });

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
  jest.clearAllMocks();
  await flushAuditLogs();
  await mongoose.connection.dropDatabase();
  await HrmsEmployee.syncIndexes();
  const hr = await Role.create({ name: 'HR', permissions: ['taskflow.hr.employee.list', 'taskflow.hr.employee.update', 'taskflow.hr.employee.create', 'taskflow.hr.leave.manage', 'taskflow.hr.scope.all'] });
  const staff = await Role.create({ name: 'Staff', permissions: ['taskflow.self.leave.apply'] });
  org = (await Organization.create({ name: 'Co', slug: 'co', createdBy: new mongoose.Types.ObjectId() }))._id as mongoose.Types.ObjectId;
  // tara ← dev ← jo; lena is another lead
  for (const name of ['hana', 'tara', 'dev', 'jo', 'lena']) {
    const user = await User.create({ email: `${name}@example.com`, name, password: 'Passw0rd!x', mustChangePassword: false, roleId: name === 'hana' ? hr._id : staff._id });
    u[name] = String(user._id);
    await OrganizationMember.create({ organization: org, user: user._id, role: 'org_member', status: 'active' });
    token[name] = (await createToken(u[name], String(org), { name: 't' })).token;
    emp[name] = String((await HrmsEmployee.create({ taskflowOrganizationId: org, userId: user._id, employeeCode: name, name, email: user.email, joinedDate: new Date(), leaveBalanceDays: 10 }))._id);
  }
  await HrmsEmployee.updateOne({ _id: emp.dev }, { managerId: emp.tara });
  await HrmsEmployee.updateOne({ _id: emp.jo }, { managerId: emp.dev });
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await flushAuditLogs();
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('employee form fields (AUT-13)', () => {
  it('sets, edits and clears manager, phone, code and currency', async () => {
    const made = await call('hana', 'POST', '/hrms/employees', { name: 'New', managerId: emp.tara, phone: '+91 1', employeeCode: 'N1', currency: 'inr' });
    expect(made.status).toBe(201);
    expect(made.body.data).toMatchObject({ managerId: emp.tara, phone: '+91 1', employeeCode: 'N1', currency: 'INR' });
    emp.new = made.body.data._id;
    const edited = await edit('new', { managerId: emp.lena, phone: '+91 2', employeeCode: 'N2', currency: 'USD' });
    expect(edited.body.data).toMatchObject({ managerId: emp.lena, phone: '+91 2', employeeCode: 'N2', currency: 'USD' });
    expect((await edit('new', { managerId: '' })).body.data.managerId).toBeUndefined();
    await flushAuditLogs();
    expect(await AuditLog.countDocuments({ action: 'hr.employee.manager_changed', user: u.hana, 'meta.from': emp.tara, 'meta.to': emp.lena })).toBe(1);
  });

  it('refuses a taken or empty code and a bad currency', async () => {
    expect((await edit('jo', { employeeCode: 'dev' })).status).toBe(409);
    expect((await edit('jo', { employeeCode: ' ' })).status).toBe(400);
    expect((await edit('jo', { currency: 'rupees' })).status).toBe(400);
    expect((await HrmsEmployee.findById(emp.jo).lean())?.employeeCode).toBe('jo');
  });
});

describe('reporting lines (AUT-13)', () => {
  it('refuses circular lines of any length', async () => {
    expect((await edit('tara', { managerId: emp.tara })).status).toBe(400);
    expect((await edit('tara', { managerId: emp.dev })).status).toBe(400);
    expect((await edit('tara', { managerId: emp.jo })).status).toBe(400);
    expect((await edit('tara', { managerId: emp.lena })).status).toBe(200);
    expect((await edit('lena', { managerId: emp.jo })).status).toBe(400);
  });

  it('refuses leavers, other workspaces and unknown people', async () => {
    const other = await HrmsEmployee.create({ taskflowOrganizationId: new mongoose.Types.ObjectId(), employeeCode: 'o', name: 'o', joinedDate: new Date() });
    const left = await HrmsEmployee.create({ taskflowOrganizationId: org, employeeCode: 'l', name: 'l', status: 'terminated', joinedDate: new Date() });
    for (const managerId of [String(other._id), String(left._id), String(new mongoose.Types.ObjectId()), 'x']) {
      expect((await edit('jo', { managerId })).status).toBe(400);
      expect((await call('hana', 'POST', '/hrms/employees', { name: 'N', managerId })).status).toBe(400);
    }
  });

  it('still saves other changes for someone whose old line is circular', async () => {
    await HrmsEmployee.updateOne({ _id: emp.tara }, { managerId: emp.jo });
    expect((await edit('tara', { managerId: emp.jo, location: 'Kochi' })).status).toBe(200);
    expect((await edit('tara', { managerId: '' })).status).toBe(200);
  });
});

describe('managers decide leave (AUT-13)', () => {
  it('shows only direct reports, without pay', async () => {
    await leaveFor('dev');
    await leaveFor('jo');
    const team = (await call('tara', 'GET', '/me/hr/team')).body.data;
    expect(team.people.map((p: { name: string }) => p.name)).toEqual(['dev']);
    expect(team.people[0]).not.toHaveProperty('annualCtc');
    expect(team.leave.map((l: { employeeId: { name: string } }) => l.employeeId.name)).toEqual(['dev']);
    expect((await call('jo', 'GET', '/me/hr/team')).body.data).toEqual({ people: [], leave: [] });
  });

  it('approves or rejects a direct report without the company-wide permission', async () => {
    const a = await leaveFor('dev');
    expect((await call('tara', 'PATCH', `/hrms/leave/${a._id}/decision`, { status: 'approved' })).status).toBe(403);
    expect(await decide('tara', a._id, 'approved')).toBe(200);
    expect(await HrmsLeaveRequest.findById(a._id).lean()).toMatchObject({ status: 'approved', decidedBy: new mongoose.Types.ObjectId(u.tara) });
    expect((await HrmsEmployee.findById(emp.dev).lean())?.leaveBalanceDays).toBe(8);
    const b = await leaveFor('dev');
    expect(await decide('tara', b._id, 'rejected')).toBe(200);
    expect((await HrmsEmployee.findById(emp.dev).lean())?.leaveBalanceDays).toBe(8);
    expect(told().filter((c) => c.userId === u.dev).map((c) => c.title)).toEqual(['Leave approved', 'Leave rejected']);
  });

  it('cannot decide for anyone else: indirect reports, other teams, themselves, other workspaces', async () => {
    const jo = await leaveFor('jo');
    const own = await leaveFor('tara');
    const lena = await leaveFor('lena');
    for (const l of [jo, own, lena]) expect(await decide('tara', l._id, 'approved')).toBe(404);
    expect(await decide('lena', jo._id, 'approved')).toBe(404);
    expect(await decide('jo', jo._id, 'approved')).toBe(404);
    expect(await decide('tara', 'nope', 'approved')).toBe(404);
    expect(await HrmsLeaveRequest.countDocuments({ status: 'pending' })).toBe(3);
    // Listed as your own manager in old data: still not your own approver.
    await HrmsEmployee.updateOne({ _id: emp.tara }, { managerId: emp.tara });
    expect(await decide('tara', own._id, 'approved')).toBe(404);
  });

  it('decides once, and only approve or reject', async () => {
    const l = await leaveFor('dev');
    expect(await decide('tara', l._id, 'cancelled')).toBe(400);
    const both = await Promise.all([decide('tara', l._id, 'approved'), decide('tara', l._id, 'approved')]);
    expect(both.sort()).toEqual([200, 409]);
    expect((await HrmsEmployee.findById(emp.dev).lean())?.leaveBalanceDays).toBe(8);
    expect(await decide('tara', l._id, 'rejected')).toBe(409);
  });

  it('stops when they are no longer the manager', async () => {
    const l = await leaveFor('dev');
    await edit('dev', { managerId: emp.lena });
    expect(await decide('tara', l._id, 'approved')).toBe(404);
    expect(await decide('lena', l._id, 'approved')).toBe(200);
  });

  it('sends the request to the manager, or to HR when the manager has left or cannot sign in', async () => {
    const apply = (d: string) => call('dev', 'POST', '/me/hr/leave', { startDate: d, endDate: d });
    expect((await apply('2026-12-01')).status).toBe(200);
    expect(told().map((c) => [c.userId, c.link])).toEqual([[u.tara, '/me?tab=team']]);
    jest.clearAllMocks();
    await User.updateOne({ _id: u.tara }, { enabled: false });
    await apply('2026-12-02');
    expect(told().map((c) => [c.userId, c.link])).toEqual([[u.hana, '/hrms/leave']]);
  });
});
