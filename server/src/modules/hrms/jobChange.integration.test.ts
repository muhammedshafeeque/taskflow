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
import { Role } from '../roles/role.model';
import { ResourceProfile } from '../resources/models/resourceProfile.model';
import { ProjectDesignation } from '../projects/projectDesignation.model';
import { ProjectMember } from '../projects/projectMember.model';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsJobChange } from './models/hrmsJobChange.model';
import { applyDueJobChanges, kindOf } from './jobChange.service';

jest.mock('../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(180_000);

const EMP = ['taskflow.hr.employee.list', 'taskflow.hr.employee.read', 'taskflow.hr.employee.update', 'taskflow.hr.scope.all'];
let mongo: MongoMemoryServer;
let server: Server;
let base = '';
let org: mongoose.Types.ObjectId;
let project = '';
const id: Record<string, string> = {};
const token: Record<string, string> = {};
const role: Record<string, string> = {};

async function call(who: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as { message?: string; data?: any } };
}
const ask = (who: string, body: Record<string, unknown>) => call(who, 'POST', '/hrms/job-changes', { employeeId: id.ivyEmp, ...body });
const decide = (who: string, changeId: string, decision = 'approve') => call(who, 'POST', `/hrms/job-changes/${changeId}/decision`, { decision });
const emp = async () => (await HrmsEmployee.findById(id.ivyEmp).lean())!;
const designationOf = async (who: string) => {
  const m = await ProjectMember.findOne({ project, user: id[who] }).lean();
  return (await ProjectDesignation.findById(m!.designationId).lean())!.name;
};
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

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

beforeEach(async () => {
  forgetAccessRules();
  await flushAuditLogs();
  await mongoose.connection.dropDatabase();
  org = (await Organization.create({ name: 'Co', slug: 'co', createdBy: new mongoose.Types.ObjectId() }))._id as mongoose.Types.ObjectId;
  const [dev, senior, hr, head, own] = await Role.create([
    { name: 'Developer', permissions: ['taskflow.self.profile.read'] },
    { name: 'Senior developer', permissions: ['taskflow.self.profile.read', 'taskflow.timesheet.approve'] },
    { name: 'HR', permissions: [...EMP, 'taskflow.hr.job_change.request'] },
    {
      name: 'HR head',
      permissions: [...EMP, 'taskflow.hr.job_change.request', 'taskflow.hr.job_change.approve', 'taskflow.hr.salary.read', 'taskflow.hr.salary.manage', 'auth.user.update', 'auth.role.assign_any'],
    },
    { name: 'HR own', permissions: ['taskflow.hr.employee.list', 'taskflow.hr.job_change.request'] },
  ]);
  Object.assign(role, { dev: String(dev._id), senior: String(senior._id) });
  const people: Array<[string, unknown, Record<string, unknown> | null]> = [
    ['owner', null, null],
    ['hana', hr._id, { designation: 'HR Executive' }],
    ['henry', head._id, { designation: 'Head of HR' }],
    ['olga', own._id, null],
    ['ivy', dev._id, { designation: 'Software Engineer', level: 'Intern', employmentType: 'intern', annualCtc: 12000, department: 'Eng' }],
  ];
  for (const [name, roleId, hrRecord] of people) {
    const u = await User.create({ email: `${name}@example.com`, name, password: 'Passw0rd!x', mustChangePassword: false, role: name === 'owner' ? 'admin' : 'user', roleId });
    id[name] = String(u._id);
    await OrganizationMember.create({ organization: org, user: u._id, role: 'org_member', status: 'active' });
    token[name] = (await createToken(id[name], String(org), { name: 't' })).token;
    if (hrRecord) id[`${name}Emp`] = String((await HrmsEmployee.create({ taskflowOrganizationId: org, userId: u._id, employeeCode: name, name, joinedDate: new Date('2026-01-05'), ...hrRecord }))._id);
  }
  // A project with the company designations; Ivy works on it as an Intern.
  project = (await call('owner', 'POST', '/projects', { name: 'App', key: 'APP', lead: id.owner })).body.data._id;
  const intern = await ProjectDesignation.findOne({ projectId: project, code: 'intern' }).lean();
  await ProjectMember.create({ project, user: id.ivy, designationId: intern!._id, permissions: intern!.permissions });
  await ResourceProfile.create({ taskflowOrganizationId: org, userId: id.ivy, seniority: 'Intern', capacityHoursPerWeek: 40 });
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await flushAuditLogs();
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('one flow changes all four places (AUT-24)', () => {
  it('an intern conversion is proposed, approved by someone else, and applied to employee, resource profile and projects', async () => {
    // HR may not touch pay without the salary right.
    expect((await ask('hana', { employmentType: 'full_time', level: 'Junior', annualCtc: 50000 })).status).toBe(403);
    const asked = await ask('hana', { employmentType: 'full_time', level: 'Junior', designation: 'Software Engineer', reason: 'Finished internship' });
    expect(asked.status).toBe(201);
    expect(asked.body.data).toMatchObject({ status: 'pending', kind: 'conversion', to: { employmentType: 'full_time', level: 'Junior' } });
    expect(asked.body.data.to.designation).toBeUndefined(); // unchanged fields are dropped
    expect((await emp()).level).toBe('Intern');
    expect((await decide('hana', asked.body.data._id)).status).toBe(403);

    const approved = await decide('henry', asked.body.data._id);
    expect(approved.status).toBe(200);
    expect(approved.body.data).toMatchObject({ status: 'applied', from: { employmentType: 'intern', level: 'Intern', seniority: 'Intern' } });
    expect(approved.body.data.projectChanges).toEqual([expect.objectContaining({ projectName: 'App', from: 'Intern', to: 'Developer' })]);
    expect(await emp()).toMatchObject({ employmentType: 'full_time', level: 'Junior' });
    expect((await ResourceProfile.findOne({ userId: id.ivy }).lean())!.seniority).toBe('Junior');
    expect(await designationOf('ivy')).toBe('Developer');
    // The project lead's own designation is never moved.
    expect(await designationOf('owner')).toBe('Project Lead');
  });

  it('a promotion with pay and role waits for its date, then applies as the approver', async () => {
    const asked = await call('henry', 'POST', '/hrms/job-changes', { employeeId: id.ivyEmp, level: 'Senior', annualCtc: 70000, roleId: role.senior, effectiveDate: day(3) });
    expect(asked.status).toBe(201);
    expect(asked.body.data.kind).toBe('promotion');
    const approved = await decide('owner', asked.body.data._id);
    expect(approved.body.data.status).toBe('scheduled');
    expect((await emp()).level).toBe('Intern');

    expect(await applyDueJobChanges(new Date())).toBe(0);
    expect(await applyDueJobChanges(new Date(Date.now() + 3 * 86_400_000))).toBe(1);
    expect(await emp()).toMatchObject({ level: 'Senior', annualCtc: 70000 });
    expect(String((await User.findById(id.ivy).lean())!.roleId)).toBe(role.senior);
    expect(await designationOf('ivy')).toBe('Senior Developer');
    const change = (await HrmsJobChange.findById(asked.body.data._id).lean())!;
    expect(change.from).toMatchObject({ level: 'Intern', annualCtc: 12000, roleId: role.dev });

    // History: what it was and became, and pay only for those who may see pay.
    const forHead = (await call('henry', 'GET', `/hrms/employees/${id.ivyEmp}/history`)).body.data.changes;
    expect(forHead[0]).toMatchObject({ status: 'applied', from: { annualCtc: 12000 }, to: { annualCtc: 70000 } });
    const forHr = (await call('hana', 'GET', `/hrms/employees/${id.ivyEmp}/history`)).body.data.changes;
    expect(forHr[0].to.annualCtc).toBeUndefined();
    expect(forHr[0].from.annualCtc).toBeUndefined();
    expect(forHr[0].to.level).toBe('Senior');
  });

  it('when a part fails, nothing is left half done', async () => {
    const asked = await call('henry', 'POST', '/hrms/job-changes', { employeeId: id.ivyEmp, level: 'Junior', roleId: role.senior, effectiveDate: day(1) });
    await decide('owner', asked.body.data._id);
    // Before the day comes, Ivy becomes an administrator, whose role an HR head may not change.
    await User.updateOne({ _id: id.ivy }, { role: 'admin' });
    await HrmsJobChange.updateOne({ _id: asked.body.data._id }, { decidedBy: id.henry });
    expect(await applyDueJobChanges(new Date(Date.now() + 86_400_000))).toBe(0);
    const change = (await HrmsJobChange.findById(asked.body.data._id).lean())!;
    expect(change.status).toBe('failed');
    expect(change.error).toBeTruthy();
    expect((await emp()).level).toBe('Intern');
    expect(await designationOf('ivy')).toBe('Intern');
  });
});

describe('approval rules (AUT-24)', () => {
  it('refuses own job, a second open change, empty and bad changes, and approving your own proposal', async () => {
    expect((await call('hana', 'POST', '/hrms/job-changes', { employeeId: id.hanaEmp, level: 'Senior' })).status).toBe(403);
    expect((await ask('hana', { designation: 'Software Engineer' })).status).toBe(400);
    expect((await ask('hana', { level: 'Wizard' })).status).toBe(400);
    expect((await ask('hana', { roleId: role.senior })).status).toBe(403); // needs the right to edit users
    const first = await call('henry', 'POST', '/hrms/job-changes', { employeeId: id.ivyEmp, department: 'Platform' });
    expect(first.body.data.kind).toBe('transfer');
    expect((await ask('hana', { level: 'Junior' })).status).toBe(409);
    expect((await decide('henry', first.body.data._id)).status).toBe(403);
    expect((await decide('owner', first.body.data._id, 'reject')).body.data.status).toBe('rejected');
    expect((await emp()).department).toBe('Eng');
    expect((await decide('owner', first.body.data._id)).status).toBe(409);
  });

  it('can be cancelled while waiting, by who proposed it or an approver', async () => {
    const asked = await ask('hana', { level: 'Junior', effectiveDate: day(5) });
    expect((await call('olga', 'POST', `/hrms/job-changes/${asked.body.data._id}/cancel`)).status).toBe(404); // outside her reach
    expect((await call('hana', 'POST', `/hrms/job-changes/${asked.body.data._id}/cancel`)).body.data.status).toBe('cancelled');
    expect((await decide('henry', asked.body.data._id)).status).toBe(409);
  });

  it('without the second-approval setting, an approver’s own change goes straight through', async () => {
    expect((await call('owner', 'PUT', '/hrms/settings', { jobChangeNeedsApproval: false })).status).toBe(200);
    const done = await call('henry', 'POST', '/hrms/job-changes', { employeeId: id.ivyEmp, designation: 'Associate Engineer' });
    expect(done.body.data.status).toBe('applied');
    expect((await emp()).designation).toBe('Associate Engineer');
    // HR without the approve right still waits for someone.
    expect((await ask('hana', { level: 'Junior' })).body.data.status).toBe('pending');
  });

  it('follows the HR reach for asking and listing', async () => {
    expect((await ask('olga', { level: 'Junior' })).status).toBe(404);
    await ask('hana', { level: 'Junior' });
    expect((await call('olga', 'GET', '/hrms/job-changes')).body.data).toEqual([]);
    expect((await call('henry', 'GET', '/hrms/job-changes?status=pending')).body.data).toHaveLength(1);
  });

  it('names the kind of change', () => {
    expect(kindOf({ employmentType: 'intern' }, { employmentType: 'full_time', level: 'Junior' })).toBe('conversion');
    expect(kindOf({ employmentType: 'full_time' }, { level: 'Senior' })).toBe('promotion');
    expect(kindOf({ employmentType: 'full_time' }, { managerId: 'x' })).toBe('transfer');
    expect(kindOf({ employmentType: 'full_time' }, { annualCtc: 1 })).toBe('salary');
  });
});
