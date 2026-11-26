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
import { flushAuditLogs } from '../auditLogs/logAudit';
import { errorHandler } from '../../middleware/errorHandler';
import { hrmsRoutes } from './hrms.routes';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsCandidate, HrmsJobOpening } from './models/hrmsPeople.model';

jest.setTimeout(120_000);
const H = 'taskflow.hr.';
const EMP = ['employee.list', 'employee.create', 'employee.update', 'dashboard.read', 'recruitment.manage'];
const ROLES: Record<string, string[]> = {
  list: ['employee.list'],
  read: ['employee.read'],
  dash: ['dashboard.read'],
  leave: ['leave.read'],
  hr: EMP,
  salaryRead: [...EMP, 'salary.read'],
  salary: [...EMP, 'salary.manage'],
  payrollRead: [...EMP, 'payroll.read'],
  payroll: [...EMP, 'payroll.manage'],
  rate: [...EMP, 'cost_rate.manage'],
};
let mongo: MongoMemoryServer;
let server: Server;
let base = '';
let org: mongoose.Types.ObjectId;
let empId = '';
const token: Record<string, string> = {};

async function call(who: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/hrms${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as { message?: string; data?: any } };
}
const stored = () => HrmsEmployee.findById(empId).lean();
const hasPay = (o: object) => ['annualCtc', 'hourlyCostRate', 'notes'].filter((k) => k in o);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  org = (await Organization.create({ name: 'Co', slug: 'co', createdBy: new mongoose.Types.ObjectId() }))._id as mongoose.Types.ObjectId;
  for (const [name, codes] of Object.entries({ ...ROLES, admin: [] })) {
    const role = await Role.create({ name, permissions: [...codes.map((c) => H + c), H + 'scope.all'] });
    const user = await User.create({ email: `${name}@example.com`.toLowerCase(), name, password: 'Passw0rd!x', mustChangePassword: false, role: name === 'admin' ? 'admin' : 'user', roleId: role._id });
    await OrganizationMember.create({ organization: org, user: user._id, role: 'org_member', status: 'active' });
    token[name] = (await createToken(String(user._id), String(org), { name: 't' })).token;
  }
  const app = express();
  app.use(express.json());
  app.use('/hrms', hrmsRoutes);
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await HrmsEmployee.deleteMany({});
  empId = String((await HrmsEmployee.create({ taskflowOrganizationId: org, employeeCode: 'E1', name: 'Dev', joinedDate: new Date(), annualCtc: 1200, hourlyCostRate: 7, notes: 'private' }))._id);
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await flushAuditLogs();
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('seeing pay (AUT-10)', () => {
  it.each([
    ['list', []], ['read', []], ['dash', []], ['hr', []], ['rate', ['hourlyCostRate']],
    ...['salaryRead', 'salary', 'payrollRead', 'payroll', 'admin'].map((w) => [w, ['annualCtc', 'hourlyCostRate', 'notes']] as [string, string[]]),
  ] as Array<[string, string[]]>)('employee list for %s shows pay fields %j', async (who, fields) => {
    const res = await call(who, 'GET', '/employees');
    expect(res.status).toBe(200);
    expect(res.body.data[0].name).toBe('Dev');
    expect(hasPay(res.body.data[0])).toEqual(fields);
  });

  it('dashboard payroll totals need pay access', async () => {
    for (const who of ['list', 'dash', 'leave', 'hr', 'rate']) {
      expect((await call(who, 'GET', '/dashboard')).body.data).toMatchObject({ monthlyPayroll: null, annualPayroll: null, counts: { headcount: 1 } });
    }
    expect((await call('salaryRead', 'GET', '/dashboard')).body.data).toMatchObject({ monthlyPayroll: 100, annualPayroll: 1200 });
  });

  it('create, update and hire responses follow the same rule', async () => {
    expect(hasPay((await call('hr', 'POST', '/employees', { name: 'New' })).body.data)).toEqual([]);
    expect(hasPay((await call('hr', 'PATCH', `/employees/${empId}`, { location: 'Kochi' })).body.data)).toEqual([]);
    expect(hasPay((await call('salary', 'PATCH', `/employees/${empId}`, { location: 'Goa' })).body.data)).toContain('annualCtc');
    const job = await HrmsJobOpening.create({ taskflowOrganizationId: org, title: 'Dev', stages: ['A', 'B'] });
    const cand = () => HrmsCandidate.create({ taskflowOrganizationId: org, jobId: job._id, name: 'Jo', stage: 'A', expectedSalary: 500 });
    const hired = await call('hr', 'POST', `/candidates/${(await cand())._id}/hire`, { employeeCode: 'H1' });
    expect(hired.status).toBe(200);
    expect(hasPay(hired.body.data.employee)).toEqual([]);
    expect((await call('hr', 'POST', `/candidates/${(await cand())._id}/hire`, { employeeCode: 'H2', annualCtc: 9 })).status).toBe(403);
    expect((await call('salary', 'POST', `/candidates/${(await cand())._id}/hire`, { employeeCode: 'H3', annualCtc: 9 })).body.data.employee.annualCtc).toBe(9);
  });
});

describe('setting pay (AUT-10)', () => {
  it('an editor without pay access keeps hidden values intact', async () => {
    expect((await call('hr', 'PATCH', `/employees/${empId}`, { name: 'Devi', leaveBalanceDays: 5 })).status).toBe(200);
    expect(await stored()).toMatchObject({ name: 'Devi', annualCtc: 1200, hourlyCostRate: 7, notes: 'private' });
  });

  it('refuses pay fields, and saves nothing, whatever the value', async () => {
    for (const who of ['hr', 'salaryRead', 'payrollRead']) {
      // The same answer for a right and a wrong guess, so a hidden salary can't be found by trying.
      for (const body of [{ annualCtc: 1200 }, { annualCtc: 1 }, { hourlyCostRate: null }, { notes: '' }]) {
        expect((await call(who, 'PATCH', `/employees/${empId}`, { name: 'X', ...body })).status).toBe(403);
      }
      expect((await call(who, 'POST', '/employees', { name: 'New', annualCtc: 5 })).status).toBe(403);
    }
    expect(await stored()).toMatchObject({ name: 'Dev', annualCtc: 1200, hourlyCostRate: 7, notes: 'private' });
    expect(await HrmsEmployee.countDocuments()).toBe(1);
  });

  it('allows salary and payroll managers, and cost-rate managers for the rate only', async () => {
    expect((await call('salary', 'PATCH', `/employees/${empId}`, { annualCtc: 2400 })).status).toBe(200);
    expect((await call('payroll', 'PATCH', `/employees/${empId}`, { notes: 'n' })).status).toBe(200);
    expect((await call('rate', 'PATCH', `/employees/${empId}`, { hourlyCostRate: 9 })).status).toBe(200);
    expect((await call('rate', 'PATCH', `/employees/${empId}`, { annualCtc: 9 })).status).toBe(403);
    expect(await stored()).toMatchObject({ annualCtc: 2400, hourlyCostRate: 9, notes: 'n' });
  });
});
