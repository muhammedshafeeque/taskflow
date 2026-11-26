import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { apiRoutes } from '../../routes';
import { errorHandler } from '../../middleware/errorHandler';
import { User } from '../auth/user.model';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { createToken } from '../apiTokens/apiToken.service';
import { flushAuditLogs } from '../auditLogs/logAudit';
import { forgetAccessRules } from '../auth/accessProfile';
import { ResourceTeam } from '../resources/models/resourceTeam.model';
import { Role } from '../roles/role.model';
import { WorkLog } from '../workLogs/workLog.model';
import { TimesheetSubmission } from '../workLogs/timesheetApproval';
import { migrateDataScopesIfNeeded, scopesToKeep } from '../../migrations/migrateDataScopes';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsLeaveRequest } from './models/hrmsLeaveRequest.model';
import { HrmsCandidate, HrmsJobOpening } from './models/hrmsPeople.model';

jest.mock('../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(180_000);

/** The same HR job, four reaches. */
const HR_WORK = [
  'taskflow.hr.dashboard.read',
  'taskflow.hr.employee.list',
  'taskflow.hr.employee.read',
  'taskflow.hr.employee.create',
  'taskflow.hr.employee.update',
  'taskflow.hr.leave.read',
  'taskflow.hr.leave.manage',
  'taskflow.hr.attendance.read',
  'taskflow.hr.attendance.manage',
  'taskflow.hr.recruitment.read',
  'taskflow.hr.recruitment.manage',
  'taskflow.hr.payroll.read',
  'taskflow.timesheet.approve',
];

let mongo: MongoMemoryServer;
let server: Server;
let base = '';
let org: mongoose.Types.ObjectId;
const id: Record<string, string> = {};
const token: Record<string, string> = {};

async function call(who: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as { message?: string; data?: any } };
}
const names = (rows: Array<{ name?: string; employeeId?: { name?: string } }>) => rows.map((r) => r.name ?? r.employeeId?.name).sort();

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const app = express();
  app.use(express.json());
  app.use('/api', apiRoutes);
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

/*
 * Eng:   lena (lead) ← ann ← bob (two levels down), ann2 ← lena; yuri (Eng, unrelated)
 * Ops:   cid, a member of the "Platform" team lena leads
 * Sales: xena, unrelated
 * HR staff with the same rights and different reach: lena (team), dina (department, Eng), olga (none = own), hana (all).
 */
beforeEach(async () => {
  forgetAccessRules();
  await flushAuditLogs();
  await mongoose.connection.dropDatabase();
  org = (await Organization.create({ name: 'Co', slug: 'co', createdBy: new mongoose.Types.ObjectId() }))._id as mongoose.Types.ObjectId;
  const [team, dept, own, all, staff] = await Role.create([
    { name: 'HR team', permissions: [...HR_WORK, 'taskflow.hr.scope.team', 'taskflow.timesheet.scope.team'] },
    { name: 'HR department', permissions: [...HR_WORK, 'taskflow.hr.scope.department', 'taskflow.timesheet.scope.department'] },
    { name: 'HR own', permissions: HR_WORK },
    { name: 'HR all', permissions: [...HR_WORK, 'taskflow.hr.scope.all', 'taskflow.timesheet.scope.all'] },
    { name: 'Staff', permissions: ['taskflow.timesheet.submit', 'taskflow.self.profile.read'] },
  ]);
  const people: Array<[string, mongoose.Types.ObjectId, string, string | null]> = [
    ['lena', team._id as mongoose.Types.ObjectId, 'Eng', null],
    ['dina', dept._id as mongoose.Types.ObjectId, 'Eng', null],
    ['olga', own._id as mongoose.Types.ObjectId, 'HR', null],
    ['hana', all._id as mongoose.Types.ObjectId, 'HR', null],
    ['ann', staff._id as mongoose.Types.ObjectId, 'Eng', 'lena'],
    ['ann2', staff._id as mongoose.Types.ObjectId, 'Eng', 'lena'],
    ['bob', staff._id as mongoose.Types.ObjectId, 'Eng', 'ann'],
    ['yuri', staff._id as mongoose.Types.ObjectId, 'Eng', null],
    ['cid', staff._id as mongoose.Types.ObjectId, 'Ops', null],
    ['xena', staff._id as mongoose.Types.ObjectId, 'Sales', null],
  ];
  for (const [name, roleId, department, manager] of people) {
    const u = await User.create({ email: `${name}@example.com`, name, password: 'Passw0rd!x', mustChangePassword: false, role: 'user', roleId });
    id[name] = String(u._id);
    await OrganizationMember.create({ organization: org, user: u._id, role: 'org_member', status: 'active' });
    token[name] = (await createToken(id[name], String(org), { name: 't' })).token;
    id[`${name}Emp`] = String(
      (await HrmsEmployee.create({ taskflowOrganizationId: org, userId: u._id, employeeCode: name, name, department, joinedDate: new Date(), managerId: manager ? id[`${manager}Emp`] : undefined }))._id
    );
  }
  await ResourceTeam.create({ taskflowOrganizationId: org, name: 'Platform', memberIds: [id.cid], leadId: id.lena });
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await flushAuditLogs();
  await mongoose.disconnect();
  await mongo?.stop();
});

const TEAM = ['ann', 'ann2', 'bob', 'cid', 'lena'];
const ENG = ['ann', 'ann2', 'bob', 'cid', 'dina', 'lena', 'yuri'].filter((n) => n !== 'cid');

describe('HR reach: lists and dashboards (AUT-22)', () => {
  it('each reach sees its own slice of the employee list', async () => {
    expect(names((await call('lena', 'GET', '/hrms/employees')).body.data)).toEqual(TEAM);
    expect(names((await call('dina', 'GET', '/hrms/employees')).body.data)).toEqual(ENG);
    expect(names((await call('olga', 'GET', '/hrms/employees')).body.data)).toEqual(['olga']);
    expect((await call('hana', 'GET', '/hrms/employees')).body.data).toHaveLength(10);
  });

  it('leave, attendance and the dashboard follow the same reach', async () => {
    for (const n of ['ann', 'xena']) {
      await HrmsLeaveRequest.create({ taskflowOrganizationId: org, employeeId: id[`${n}Emp`], startDate: new Date(), endDate: new Date(), days: 1, status: 'pending' });
    }
    expect(names((await call('lena', 'GET', '/hrms/leave')).body.data)).toEqual(['ann']);
    expect(names((await call('hana', 'GET', '/hrms/leave')).body.data)).toEqual(['ann', 'xena']);
    expect((await call('lena', 'GET', `/hrms/leave?employeeId=${id.xenaEmp}`)).body.data).toEqual([]);

    expect((await call('hana', 'POST', '/hrms/attendance/bulk', { date: '2026-11-20', status: 'present', employeeIds: [id.annEmp, id.xenaEmp] })).status).toBe(200);
    expect(names((await call('lena', 'GET', '/hrms/attendance')).body.data)).toEqual(['ann']);

    const dash = (await call('lena', 'GET', '/hrms/dashboard')).body.data;
    expect(dash.counts.headcount).toBe(TEAM.length);
    expect(dash.counts.pendingLeave).toBe(1);
  });
});

describe('HR reach: acting on records (AUT-22)', () => {
  it('a lead acts on their own team only; outside it the record looks missing', async () => {
    expect((await call('lena', 'PATCH', `/hrms/employees/${id.bobEmp}`, { designation: 'Engineer II' })).status).toBe(200);
    expect((await call('lena', 'PATCH', `/hrms/employees/${id.xenaEmp}`, { designation: 'Hacked' })).status).toBe(404);
    expect((await call('lena', 'DELETE', `/hrms/employees/${id.xenaEmp}`)).status).toBe(404);
    expect((await call('lena', 'POST', '/hrms/leave', { employeeId: id.xenaEmp, startDate: '2026-12-01', endDate: '2026-12-01' })).status).toBe(404);
    expect((await call('lena', 'POST', '/hrms/attendance', { employeeId: id.xenaEmp, date: '2026-11-20', status: 'absent' })).status).toBe(404);
    expect((await call('lena', 'POST', '/hrms/attendance/bulk', { date: '2026-11-20', status: 'present', employeeIds: [id.annEmp, id.xenaEmp] })).status).toBe(400);
    expect((await call('lena', 'POST', '/hrms/attendance/bulk', { date: '2026-11-20', status: 'present', employeeIds: [id.annEmp, id.cidEmp] })).status).toBe(200);
    const leave = await HrmsLeaveRequest.create({ taskflowOrganizationId: org, employeeId: id.xenaEmp, startDate: new Date(), endDate: new Date(), days: 1, status: 'pending' });
    expect((await call('lena', 'PATCH', `/hrms/leave/${leave._id}/decision`, { status: 'approved' })).status).toBe(404);
    expect((await HrmsLeaveRequest.findById(leave._id).lean())!.status).toBe('pending');
    expect((await call('lena', 'GET', `/hrms/employees/${id.xenaEmp}/balances`)).status).toBe(404);
    expect((await HrmsEmployee.findById(id.xenaEmp).lean())!.designation).toBeUndefined();
  });

  it('a lead adds people under their team, not elsewhere, and cannot move someone out of reach', async () => {
    expect((await call('lena', 'POST', '/hrms/employees', { name: 'New Dev', managerId: id.annEmp })).status).toBe(201);
    expect((await call('lena', 'POST', '/hrms/employees', { name: 'Floater' })).status).toBe(403);
    expect((await call('lena', 'POST', '/hrms/employees', { name: 'Sales rep', managerId: id.xenaEmp })).status).toBe(403);
    expect((await call('lena', 'PATCH', `/hrms/employees/${id.bobEmp}`, { managerId: id.xenaEmp })).status).toBe(403);
    // Department reach may add to its own department.
    expect((await call('dina', 'POST', '/hrms/employees', { name: 'Eng hire', department: 'Eng' })).status).toBe(201);
    expect((await call('dina', 'POST', '/hrms/employees', { name: 'Ops hire', department: 'Ops' })).status).toBe(403);
    expect((await call('hana', 'POST', '/hrms/employees', { name: 'Anyone' })).status).toBe(201);
  });

  it('payroll covers the whole company, so it needs a reach of everyone', async () => {
    expect((await call('lena', 'GET', '/hrms/payroll/runs')).status).toBe(403);
    expect((await call('lena', 'GET', '/hrms/payroll')).status).toBe(403);
    expect((await call('hana', 'GET', '/hrms/payroll/runs')).status).toBe(200);
  });
});

describe('HR reach elsewhere: search, record graph, Employee 360 (AUT-22)', () => {
  it('people outside the reach do not turn up', async () => {
    const hits = async (who: string) => ((await call(who, 'GET', '/search?q=xena')).body.data?.hits ?? []).filter((h: { type: string }) => h.type === 'employee');
    expect(await hits('lena')).toHaveLength(0);
    expect(await hits('hana')).toHaveLength(1);
    const picker = async (who: string) => (await call(who, 'GET', '/links/search?type=employee&q=')).body.data.records as Array<{ title: string }>;
    expect((await picker('lena')).map((r) => r.title).sort()).toEqual(TEAM);
    expect((await call('lena', 'GET', `/employee-360/${id.xenaEmp}`)).status).toBe(404);
    expect((await call('lena', 'GET', `/employee-360/${id.bobEmp}`)).status).toBe(200);
    expect((await call('olga', 'GET', '/employee-360/me')).status).toBe(200);
    expect((await call('lena', 'GET', `/links/employee/${id.xenaEmp}`)).status).toBe(404);
  });
});

describe('recruitment reach (AUT-22)', () => {
  it('leads see jobs they hire for; interviewers see only the candidates they interview', async () => {
    const salesJob = await HrmsJobOpening.create({ taskflowOrganizationId: org, title: 'Sales rep', department: 'Sales', hiringManagerId: id.xena, stages: ['Applied', 'Hired'] });
    const engJob = await HrmsJobOpening.create({ taskflowOrganizationId: org, title: 'Engineer', department: 'Eng', hiringManagerId: id.ann, stages: ['Applied', 'Hired'] });
    const at = new Date();
    await HrmsCandidate.create([
      { taskflowOrganizationId: org, jobId: salesJob._id, name: 'Interviewed by Cid', stage: 'Applied', expectedSalary: 90000, interviews: [{ at, mode: 'video', interviewerIds: [id.cid] }] },
      { taskflowOrganizationId: org, jobId: salesJob._id, name: 'Someone else', stage: 'Applied' },
      { taskflowOrganizationId: org, jobId: engJob._id, name: 'Eng candidate', stage: 'Applied' },
    ]);
    const jobs = async (who: string) => ((await call(who, 'GET', '/hrms/jobs')).body.data as Array<{ title: string }>).map((j) => j.title).sort();
    expect(await jobs('lena')).toEqual(['Engineer']);
    expect(await jobs('hana')).toEqual(['Engineer', 'Sales rep']);
    // Cid has no HR rights at all, only an interview.
    expect(await jobs('cid')).toEqual(['Sales rep']);
    const cands = (await call('cid', 'GET', `/hrms/jobs/${salesJob._id}/candidates`)).body.data;
    expect(cands.map((c: { name: string }) => c.name)).toEqual(['Interviewed by Cid']);
    expect(cands[0].expectedSalary).toBeUndefined();
    expect((await call('cid', 'GET', `/hrms/jobs/${engJob._id}/candidates`)).body.data).toEqual([]);
    expect((await call('lena', 'GET', `/hrms/jobs/${salesJob._id}/candidates`)).body.data).toEqual([]);
    expect((await call('hana', 'GET', `/hrms/jobs/${salesJob._id}/candidates`)).body.data).toHaveLength(2);
    // Acting on recruitment outside the reach.
    expect((await call('lena', 'PATCH', `/hrms/jobs/${salesJob._id}`, { title: 'x' })).status).toBe(404);
    expect((await call('lena', 'POST', '/hrms/candidates', { jobId: String(salesJob._id), name: 'Sneak' })).status).toBe(404);
    expect((await call('lena', 'POST', '/hrms/candidates', { jobId: String(engJob._id), name: 'Fine' })).status).toBe(200);
    expect((await call('lena', 'POST', '/hrms/jobs', { title: 'Other dept job', hiringManagerId: id.xena })).status).toBe(403);
  });
});

describe('timesheet approval reach (AUT-22)', () => {
  async function submit(who: string) {
    await WorkLog.create({ issue: new mongoose.Types.ObjectId(), author: id[who], minutesSpent: 60, date: new Date() });
    return call(who, 'POST', '/timesheet/approvals/submit', {});
  }

  it('approvers are only those whose reach includes the person', async () => {
    expect((await submit('cid')).status).toBe(200);
    expect((await submit('xena')).status).toBe(200);
    const cid = await TimesheetSubmission.findOne({ userId: id.cid }).lean();
    const xena = await TimesheetSubmission.findOne({ userId: id.xena }).lean();
    expect(cid!.approverIds.map(String).sort()).toEqual([id.hana, id.lena].sort());
    expect(xena!.approverIds.map(String)).toEqual([id.hana]);

    const queue = async (who: string) => ((await call(who, 'GET', '/timesheet/approvals/submissions?scope=approve')).body.data as Array<{ userId: { name: string } }>).map((s) => s.userId.name).sort();
    expect(await queue('lena')).toEqual(['cid']);
    expect(await queue('hana')).toEqual(['cid', 'xena']);
    expect((await call('lena', 'POST', `/timesheet/approvals/submissions/${xena!._id}/decision`, { decision: 'approved' })).status).toBe(403);
    expect((await call('lena', 'POST', `/timesheet/approvals/submissions/${cid!._id}/decision`, { decision: 'approved' })).status).toBe(200);
  });

  it('an approver of another workspace cannot decide here', async () => {
    const other = await TimesheetSubmission.create({ userId: id.xena, taskflowOrganizationId: new mongoose.Types.ObjectId(), weekStart: new Date('2026-11-16'), status: 'submitted' });
    expect((await call('hana', 'POST', `/timesheet/approvals/submissions/${other._id}/decision`, { decision: 'approved' })).status).toBe(403);
  });
});

describe('existing access is kept (AUT-22 migration)', () => {
  it('roles and per-person grants with HR or approval rights keep reaching everyone', async () => {
    expect(scopesToKeep(['taskflow.hr.leave.read'])).toEqual(['taskflow.hr.scope.all']);
    expect(scopesToKeep(['taskflow.timesheet.approve'])).toEqual(['taskflow.timesheet.scope.all']);
    expect(scopesToKeep(['designations:manage'])).toEqual(['taskflow.hr.scope.all']);
    expect(scopesToKeep(['taskflow.hr.leave.read', 'taskflow.hr.scope.team'])).toEqual(['taskflow.hr.scope.all']);
    expect(scopesToKeep(['taskflow.crm.lead.list'])).toEqual([]);

    const old = await Role.create({ name: 'Old HR', permissions: ['taskflow.hr.employee.list', 'taskflow.timesheet.approve'] });
    await User.updateOne({ _id: id.xena }, { 'permissionOverrides.granted': ['taskflow.hr.leave.manage'] });
    await mongoose.connection.collection('appmigrations').deleteMany({});
    const res = await migrateDataScopesIfNeeded();
    expect(res.users).toBe(1);
    expect((await Role.findById(old._id).lean())!.permissions).toEqual(expect.arrayContaining(['taskflow.hr.scope.all', 'taskflow.timesheet.scope.all']));
    // Runs once.
    await Role.updateOne({ _id: old._id }, { permissions: ['taskflow.hr.employee.list'] });
    expect(await migrateDataScopesIfNeeded()).toEqual({ roles: 0, users: 0 });
    expect((await Role.findById(old._id).lean())!.permissions).toEqual(['taskflow.hr.employee.list']);
  });
});
