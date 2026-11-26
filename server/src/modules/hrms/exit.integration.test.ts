import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { User } from '../auth/user.model';
import * as authService from '../auth/auth.service';
import { Role } from '../roles/role.model';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { Project } from '../projects/project.model';
import { ProjectMember } from '../projects/projectMember.model';
import { Issue } from '../issues/issue.model';
import { IssueHistory } from '../issues/issueHistory.model';
import { CrmLead } from '../crm/models/crmLead.model';
import { CrmDeal } from '../crm/models/crmDeal.model';
import { CrmActivity } from '../crm/models/crmActivity.model';
import { ServiceTicket } from '../service-desk/models/serviceTicket.model';
import { TimesheetSubmission } from '../workLogs/timesheetApproval';
import { AuditLog } from '../auditLogs/auditLog.model';
import { flushAuditLogs } from '../auditLogs/logAudit';
import { createToken } from '../apiTokens/apiToken.service';
import { errorHandler } from '../../middleware/errorHandler';
import { authMiddleware } from '../../middleware/auth.middleware';
import { hrmsRoutes } from './hrms.routes';
import { closeDueExits } from './exit.service';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsSettings } from './models/hrmsPolicy.model';
import { HrmsChecklist, HrmsReview } from './models/hrmsPeople.model';

jest.mock('../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(120_000);

const oid = () => new mongoose.Types.ObjectId();
const DAY = 86_400_000;
let mongo: MongoMemoryServer;
let server: Server;
let base = '';
let org: mongoose.Types.ObjectId;
const u: Record<string, mongoose.Types.ObjectId> = {};
const emp: Record<string, string> = {};
const token: Record<string, string> = {};

async function call(who: string, method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as { message?: string; data?: any } };
}
const patch = (who: string, target: string, body: unknown) => call(who, 'PATCH', `/hrms/employees/${emp[target]}`, body);
const enabled = async (who: string) => (await User.findById(u[who]).lean())?.enabled;
const whoami = async (bearer: string) => (await fetch(`${base}/me`, { headers: { Authorization: `Bearer ${bearer}` } })).status;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const app = express();
  app.use(express.json());
  app.get('/me', authMiddleware, (_req, res) => res.json({ ok: true }));
  app.use('/hrms', hrmsRoutes);
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await flushAuditLogs();
  await mongoose.connection.dropDatabase();
  const hr = await Role.create({ name: 'HR', permissions: ['taskflow.hr.employee.update', 'taskflow.hr.employee.list', 'taskflow.hr.scope.all'] });
  const staff = await Role.create({ name: 'Staff', permissions: ['taskflow.hr.employee.list'] });
  org = (await Organization.create({ name: 'Co', slug: 'co', createdBy: oid() }))._id as mongoose.Types.ObjectId;
  const mk = async (name: string, extra: Record<string, unknown>) => {
    const user = await User.create({ email: `${name}@example.com`, name, password: 'Passw0rd!x', mustChangePassword: false, ...extra });
    u[name] = user._id as mongoose.Types.ObjectId;
    await OrganizationMember.create({ organization: org, user: user._id, role: 'org_member', status: 'active' });
    token[name] = (await createToken(String(user._id), String(org), { name: 't' })).token;
    emp[name] = String((await HrmsEmployee.create({ taskflowOrganizationId: org, userId: user._id, employeeCode: name, name, email: user.email, joinedDate: new Date() }))._id);
  };
  await mk('hana', { roleId: hr._id });
  await mk('sam', { roleId: staff._id });
  await mk('lena', { roleId: staff._id });
  await mk('root', { role: 'admin' });
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await flushAuditLogs();
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('closing access (AUT-9)', () => {
  it('terminating someone ends sign-in, sessions and API tokens', async () => {
    const login = (await authService.login({ email: 'sam@example.com', password: 'Passw0rd!x' } as never)) as unknown as { tokens: { accessToken: string; refreshToken: string } };
    expect(await whoami(login.tokens.accessToken)).toBe(200);
    const res = await patch('hana', 'sam', { status: 'terminated' });
    expect(res.status).toBe(200);
    expect(res.body.data.exitDate).toBeTruthy();
    expect(res.body.data.accessClosedAt).toBeTruthy();
    expect(await whoami(login.tokens.accessToken)).toBe(401);
    expect(await whoami(token.sam)).toBe(401);
    await expect(authService.login({ email: 'sam@example.com', password: 'Passw0rd!x' } as never)).rejects.toMatchObject({ statusCode: 401 });
    await expect(authService.refresh(login.tokens.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
    await flushAuditLogs();
    expect(await AuditLog.findOne({ action: 'hr.employee.access_closed' }).lean()).toMatchObject({ resourceId: emp.sam, meta: { result: 'closed' } });
  });

  it('also finds an account that is only matched by email', async () => {
    await HrmsEmployee.updateOne({ _id: emp.sam }, { $unset: { userId: 1 } });
    await patch('hana', 'sam', { status: 'terminated' });
    expect(await enabled('sam')).toBe(false);
  });

  it('waits for a future exit date, then the job closes it', async () => {
    const last = new Date(Date.now() + 3 * DAY);
    await patch('hana', 'sam', { status: 'terminated', exitDate: last.toISOString().slice(0, 10) });
    expect(await enabled('sam')).toBe(true);
    expect(await closeDueExits()).toBe(0);
    expect(await closeDueExits(last)).toBe(1);
    expect(await enabled('sam')).toBe(false);
    expect(await closeDueExits(last)).toBe(0);
  });

  it('the job closes people whose last day passed without being marked, and keeps their status for final pay', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await patch('hana', 'sam', { exitDate: today });
    expect(await closeDueExits()).toBe(0);
    expect(await closeDueExits(new Date(Date.now() + DAY))).toBe(1);
    expect((await HrmsEmployee.findById(emp.sam).lean())?.status).toBe('active');
  });

  it('the job ignores a stale exit date on someone still working', async () => {
    await HrmsEmployee.updateOne({ _id: emp.sam }, { $set: { exitDate: new Date(Date.now() - 90 * DAY) } });
    expect(await closeDueExits()).toBe(0);
    expect(await enabled('sam')).toBe(true);
  });

  it('a rehire clears the exit but does not switch the account back on', async () => {
    await patch('hana', 'sam', { status: 'terminated' });
    const res = await patch('hana', 'sam', { status: 'active' });
    expect(res.body.data.exitDate).toBeUndefined();
    expect(res.body.data.accessClosedAt).toBeNull();
    expect(await enabled('sam')).toBe(false);
    expect(await closeDueExits()).toBe(0);
  });

  it('someone in another workspace loses only this one', async () => {
    const other = await Organization.create({ name: 'Other', slug: 'other', createdBy: oid() });
    await OrganizationMember.create({ organization: other._id, user: u.sam, role: 'org_member', status: 'active' });
    const p = await Project.create({ name: 'P', key: 'P', lead: u.lena, taskflowOrganizationId: org });
    await ProjectMember.create({ project: p._id, user: u.sam, permissions: [] });
    await patch('hana', 'sam', { status: 'terminated' });
    expect(await enabled('sam')).toBe(true);
    expect(await OrganizationMember.exists({ organization: org, user: u.sam })).toBeNull();
    expect(await OrganizationMember.exists({ organization: other._id, user: u.sam })).toBeTruthy();
    expect(await ProjectMember.exists({ user: u.sam })).toBeNull();
    expect(await whoami(token.sam)).toBe(401);
  });

  it('cannot be used against an administrator, yourself, or by relinking a record', async () => {
    expect((await patch('hana', 'root', { status: 'terminated' })).status).toBe(403);
    expect((await patch('hana', 'hana', { status: 'terminated' })).status).toBe(403);
    expect((await patch('hana', 'sam', { status: 'terminated', userId: String(u.root) })).status).toBe(403);
    expect((await patch('hana', 'root', { exitDate: '2020-01-01' })).status).toBe(403);
    expect((await HrmsEmployee.findById(emp.root).lean())?.status).toBe('active');
    expect(await enabled('root')).toBe(true);
    expect((await patch('root', 'sam', { status: 'terminated' })).status).toBe(200);
  });

  it('the job never closes an administrator, or someone with another live record', async () => {
    await HrmsEmployee.updateOne({ _id: emp.root }, { $set: { status: 'terminated' } });
    await HrmsEmployee.create({ taskflowOrganizationId: org, employeeCode: 'X', name: 'old', email: 'sam@example.com', status: 'terminated', joinedDate: new Date() });
    expect(await closeDueExits()).toBe(0);
    expect([await enabled('root'), await enabled('sam')]).toEqual([true, true]);
  });
});

describe('handing over work (AUT-9)', () => {
  let app1: mongoose.Types.ObjectId;
  let hidden: mongoose.Types.ObjectId;

  beforeEach(async () => {
    const statuses = [{ id: 't', name: 'Todo', order: 0, isClosed: false }, { id: 'd', name: 'Done', order: 1, isClosed: true }];
    const [a, b] = await Project.create([
      { name: 'App', key: 'APP', lead: u.sam, taskflowOrganizationId: org, statuses },
      { name: 'Hidden', key: 'HID', lead: u.root, taskflowOrganizationId: org, statuses },
    ]);
    app1 = a._id as mongoose.Types.ObjectId;
    hidden = b._id as mongoose.Types.ObjectId;
    await ProjectMember.create({ project: app1, user: u.lena, permissions: [] });
    const issue = (key: string, project: unknown, status: string) => ({ title: key, key, project, status, reporter: u.root, assignee: u.sam });
    await Issue.create([issue('APP-1', app1, 'Todo'), issue('APP-2', app1, 'Done'), issue('HID-1', hidden, 'Todo')]);
    const o = { taskflowOrganizationId: org };
    await CrmLead.create([{ ...o, title: 'open', status: 'new', assigneeId: u.sam }, { ...o, title: 'old', status: 'converted', assigneeId: u.sam }]);
    await CrmDeal.create([{ ...o, title: 'd', pipelineId: oid(), stageId: oid(), ownerId: u.sam }, { ...o, title: 'won', status: 'won', pipelineId: oid(), stageId: oid(), ownerId: u.sam }]);
    await CrmActivity.create({ ...o, type: 'follow_up', subject: 'call', assigneeId: u.sam, createdBy: u.sam, relatedType: 'lead', relatedId: oid() });
    await ServiceTicket.create([{ ...o, subject: 't', assigneeId: u.sam }, { ...o, subject: 'x', status: 'closed', assigneeId: u.sam }]);
    await TimesheetSubmission.create([
      { ...o, userId: u.hana, weekStart: new Date(), approverIds: [u.sam] },
      { ...o, userId: u.lena, weekStart: new Date(), approverIds: [u.sam] },
    ]);
    await HrmsReview.create({ ...o, cycleId: oid(), employeeId: oid(), employeeUserId: u.hana, reviewerId: u.sam });
    await HrmsChecklist.create({ ...o, employeeId: oid(), kind: 'onboarding', name: 'c', startDate: new Date(), tasks: [{ title: 'a', assigneeId: u.sam }, { title: 'b', assigneeId: u.sam, done: true }] });
    await HrmsSettings.create({ ...o, leaveApproverUserIds: [u.sam, u.root] });
    await HrmsEmployee.updateOne({ _id: emp.sam }, { $set: { managerId: emp.root } });
    await HrmsEmployee.updateMany({ _id: { $in: [emp.lena, emp.hana] } }, { $set: { managerId: emp.sam } });
  });

  it('moves every open thing in one step, and nothing closed', async () => {
    await patch('hana', 'sam', { status: 'terminated' });
    const open = await call('hana', 'GET', `/hrms/employees/${emp.sam}/open-work`);
    expect(open.body.data).toEqual({ leads: 1, deals: 1, followUps: 1, tasks: 2, tickets: 1, timesheets: 2, reviews: 1, checklists: 1, reports: 2, leaveApprover: 1, projectsLed: 1 });

    const res = await call('hana', 'POST', `/hrms/employees/${emp.sam}/reassign`, { toUserId: String(u.lena) });
    expect(res.status).toBe(200);
    expect(res.body.data.moved).toEqual({ leads: 1, deals: 1, followUps: 1, tasks: 1, tickets: 1, timesheets: 1, reviews: 1, checklists: 1, reports: 2, leaveApprover: 1 });
    // HID-1 (Lena is not on that project), Lena's own timesheet, and the project lead stay for someone else.
    expect(res.body.data.remaining).toMatchObject({ leads: 0, deals: 0, tasks: 1, timesheets: 1, reports: 0, projectsLed: 1 });

    const assignee = async (key: string) => String((await Issue.findOne({ key }).lean())?.assignee);
    expect([await assignee('APP-1'), await assignee('APP-2'), await assignee('HID-1')]).toEqual([String(u.lena), String(u.sam), String(u.sam)]);
    expect(await IssueHistory.countDocuments({ field: 'assignee' })).toBe(1);
    expect(await CrmDeal.countDocuments({ status: 'won', ownerId: u.sam })).toBe(1);
    const tasks = (await HrmsChecklist.findOne().lean())!.tasks;
    expect(tasks.map((t) => String(t.assigneeId))).toEqual([String(u.lena), String(u.sam)]);
    expect((await HrmsSettings.findOne().lean())!.leaveApproverUserIds.map(String).sort()).toEqual([String(u.lena), String(u.root)].sort());
    const manager = async (who: string) => String((await HrmsEmployee.findById(emp[who]).lean())?.managerId);
    expect([await manager('hana'), await manager('lena')]).toEqual([emp.lena, emp.root]);
  });

  it('moves only the chosen kinds', async () => {
    const res = await call('hana', 'POST', `/hrms/employees/${emp.sam}/reassign`, { toUserId: String(u.lena), kinds: ['leads'] });
    expect(res.body.data.moved).toEqual({ leads: 1 });
    expect(res.body.data.remaining.deals).toBe(1);
  });

  it('refuses bad recipients, kinds, and people without employee update', async () => {
    const go = (who: string, body: unknown) => call(who, 'POST', `/hrms/employees/${emp.sam}/reassign`, body).then((r) => r.status);
    expect(await go('hana', {})).toBe(400);
    expect(await go('hana', { toUserId: String(u.sam) })).toBe(400);
    expect(await go('hana', { toUserId: String(oid()) })).toBe(400);
    expect(await go('hana', { toUserId: String(u.lena), kinds: ['payroll'] })).toBe(400);
    await User.updateOne({ _id: u.lena }, { enabled: false });
    expect(await go('hana', { toUserId: String(u.lena) })).toBe(400);
    expect(await go('sam', { toUserId: String(u.root) })).toBe(403);
    expect((await call('sam', 'GET', `/hrms/employees/${emp.sam}/open-work`)).status).toBe(403);
    expect(await CrmLead.countDocuments({ assigneeId: u.sam })).toBe(2);
  });
});
