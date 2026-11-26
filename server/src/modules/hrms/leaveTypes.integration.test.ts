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
import { hrmsRoutes } from './hrms.routes';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsLeaveType } from './models/hrmsPolicy.model';
import { flushAuditLogs } from '../auditLogs/logAudit';

jest.mock('../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
let server: Server;
let base = '';
let org: mongoose.Types.ObjectId;
let empId = '';
let casual = '';
const token: Record<string, string> = {};

async function call(who: string, method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as { message?: string; data?: any } };
}
// Mondays to Fridays in 2026-12, so each request is a whole number of working days.
const hrRequest = (body: Record<string, unknown>) => call('hana', 'POST', '/hrms/leave', { employeeId: empId, ...body });
const casualLeft = async () => (await call('hana', 'GET', `/hrms/employees/${empId}/balances`)).body.data.find((b: { leaveTypeId: string }) => b.leaveTypeId === casual).available;

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
  await flushAuditLogs();
  await mongoose.connection.dropDatabase();
  org = (await Organization.create({ name: 'Co', slug: 'co', createdBy: new mongoose.Types.ObjectId() }))._id as mongoose.Types.ObjectId;
  const roles = {
    hana: await Role.create({ name: 'HR', permissions: ['taskflow.hr.leave.manage', 'taskflow.hr.employee.list', 'taskflow.hr.scope.all'] }),
    jo: await Role.create({ name: 'Staff', permissions: ['taskflow.self.leave.apply'] }),
  };
  for (const [name, role] of Object.entries(roles)) {
    const user = await User.create({ email: `${name}@example.com`, name, password: 'Passw0rd!x', mustChangePassword: false, roleId: role._id });
    await OrganizationMember.create({ organization: org, user: user._id, role: 'org_member', status: 'active' });
    token[name] = (await createToken(String(user._id), String(org), { name: 't' })).token;
    if (name === 'jo') empId = String((await HrmsEmployee.create({ taskflowOrganizationId: org, userId: user._id, employeeCode: 'J', name: 'Jo', joinedDate: new Date('2025-01-01'), leaveBalanceDays: 20 }))._id);
  }
  casual = String((await HrmsLeaveType.create({ taskflowOrganizationId: org, name: 'Casual', code: 'casual', annualAllowance: 12, accrual: 'yearly' }))._id);
  await HrmsLeaveType.create({ taskflowOrganizationId: org, name: 'Old', code: 'old', active: false });
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await flushAuditLogs();
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('HR leave uses the configured leave types (AUT-15)', () => {
  it('lists the active types for the HR form', async () => {
    const types = (await call('hana', 'GET', '/hrms/leave-types?active=1')).body.data;
    expect(types.map((t: { name: string }) => t.name)).toEqual(['Casual']);
  });

  it('refuses the old fixed types once types are set up', async () => {
    const res = await hrRequest({ type: 'annual', startDate: '2026-12-07', endDate: '2026-12-07' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Choose a leave type');
  });

  it('HR and self-service requests draw on the same balance, shown with the real name', async () => {
    const before = await casualLeft();
    const hr = await hrRequest({ leaveTypeId: casual, startDate: '2026-12-07', endDate: '2026-12-08' });
    expect(hr.status).toBe(201);
    await call('hana', 'PATCH', `/hrms/leave/${hr.body.data._id}/decision`, { status: 'approved' });
    const self = await call('jo', 'POST', '/me/hr/leave', { leaveTypeId: casual, startDate: '2026-12-14', endDate: '2026-12-14' });
    expect(self.status).toBe(200);
    await call('hana', 'PATCH', `/hrms/leave/${self.body.data._id}/decision`, { status: 'approved' });
    expect(await casualLeft()).toBe(before - 3);
    expect((await HrmsEmployee.findById(empId).lean())?.leaveBalanceDays).toBe(20);

    const list = (await call('hana', 'GET', '/hrms/leave')).body.data;
    expect(list.map((l: { leaveTypeId: { name: string } }) => l.leaveTypeId.name)).toEqual(['Casual', 'Casual']);
    // Either side refuses more than is left, counting the other side's requests.
    const tooMuch = await call('jo', 'POST', '/me/hr/leave', { leaveTypeId: casual, startDate: '2026-12-21', endDate: '2027-01-29' });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.message).toMatch(/Not enough Casual balance/);
  });

  it('keeps working with the fixed types where none are set up', async () => {
    await HrmsLeaveType.deleteMany({});
    const res = await hrRequest({ type: 'sick', startDate: '2026-12-07', endDate: '2026-12-07' });
    expect(res.status).toBe(201);
    await call('hana', 'PATCH', `/hrms/leave/${res.body.data._id}/decision`, { status: 'approved' });
    expect((await HrmsEmployee.findById(empId).lean())?.leaveBalanceDays).toBe(19);
  });
});
