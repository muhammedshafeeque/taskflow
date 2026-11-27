import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { apiRoutes } from '../../routes';
import { apiCatalog, type CatalogEntry } from '../mcp/apiCatalog';
import { User } from '../auth/user.model';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { Project } from '../projects/project.model';
import { ProjectMember } from '../projects/projectMember.model';
import { Issue } from '../issues/issue.model';
import { HrmsEmployee } from '../hrms/models/hrmsEmployee.model';
import { AuditLog } from '../auditLogs/auditLog.model';
import { flushAuditLogs } from '../auditLogs/logAudit';
import { createToken } from '../apiTokens/apiToken.service';
import { notifyUser } from '../notifications/notificationDispatch.service';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { DEFAULT_USER_PERMISSIONS } from '../../shared/constants/permissions';
import { EXECUTIVE_PERMISSIONS, SYSTEM_ADMIN_PERMISSIONS } from '../../shared/constants/accessRoleTemplates';
import { errorHandler } from '../../middleware/errorHandler';
import { Role } from './role.model';

jest.mock('../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../services/email.service', () => ({
  sendInviteEmail: jest.fn().mockResolvedValue(undefined),
  sendWorkspaceJoinInviteEmail: jest.fn().mockResolvedValue(undefined),
}));
jest.setTimeout(180_000);

let mongo: MongoMemoryServer;
let server: Server;
let base = '';
let app1 = '';
let issueId = '';
const id: Record<string, string> = {};
const token: Record<string, string> = {};

async function call(who: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as { message?: string; data?: any } };
}
const status = async (...a: Parameters<typeof call>) => (await call(...a)).status;

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
  jest.clearAllMocks();
  await flushAuditLogs();
  await mongoose.connection.dropDatabase();
  const [sys, exec, cfo, staff] = await Role.create([
    { name: 'System Admin', permissions: SYSTEM_ADMIN_PERMISSIONS },
    { name: 'Executive', permissions: EXECUTIVE_PERMISSIONS },
    { name: 'CFO', permissions: ['taskflow.hr.payroll.manage'] },
    { name: 'Staff', permissions: [] },
  ]);
  Object.assign(id, { cfoRole: String(cfo._id), sysRole: String(sys._id) });
  const org = await Organization.create({ name: 'Co', slug: 'co', createdBy: new mongoose.Types.ObjectId() });
  for (const [name, extra] of Object.entries({ owner: { role: 'admin' }, owner2: { role: 'admin' }, sys: { roleId: sys._id }, exec: { roleId: exec._id }, sam: { roleId: staff._id } })) {
    const u = await User.create({ email: `${name}@example.com`, name, password: 'Passw0rd!x', mustChangePassword: false, ...extra });
    await OrganizationMember.create({ organization: org._id, user: u._id, role: 'org_member', status: 'active' });
    id[name] = String(u._id);
    token[name] = (await createToken(id[name], String(org._id), { name: 't' })).token;
  }
  const p = await Project.create({ name: 'App', key: 'APP', lead: id.owner, taskflowOrganizationId: org._id });
  app1 = String(p._id);
  issueId = String((await Issue.create({ title: 'One', key: 'APP-1', project: app1, reporter: id.owner, status: 'Todo' }))._id);
  const other = await Organization.create({ name: 'Other', slug: 'other', createdBy: new mongoose.Types.ObjectId() });
  id.foreign = String((await Project.create({ name: 'F', key: 'FOR', lead: id.owner, taskflowOrganizationId: other._id }))._id);
  await HrmsEmployee.create({ taskflowOrganizationId: org._id, employeeCode: 'E', name: 'E', joinedDate: new Date(), annualCtc: 100 });
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await flushAuditLogs();
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('system admin (AUT-11)', () => {
  it('runs the platform', async () => {
    for (const path of ['/users', '/roles', '/audit-logs', '/core/company', '/core/modules']) expect([path, await status('sys', 'GET', path)]).toEqual([path, 200]);
    expect(await status('sys', 'PATCH', '/core/preferences', { requireTwoFactor: false })).toBe(200);
    expect(await status('sys', 'PATCH', `/users/${id.sam}`, { enabled: false })).toBe(200);
  });

  it('sees no payroll, finance, HR or customers', async () => {
    for (const path of ['/hrms/employees', '/hrms/payroll/runs', '/hrms/dashboard', '/accounts/dashboard', '/accounts/expenses', '/billing/invoices', '/billing/dashboard', '/crm/leads', '/crm/deals', `/issues/${issueId}`]) {
      expect([path, await status('sys', 'GET', path)]).toEqual([path, 403]);
    }
  });

  it('can assign any existing role, and every administrator is told', async () => {
    expect(await status('sys', 'PATCH', `/users/${id.sam}`, { roleId: id.cfoRole })).toBe(200);
    expect(await status('sys', 'POST', '/users/invite', { name: 'New', email: 'n@example.com', roleId: id.cfoRole })).toBe(201);
    await flushAuditLogs();
    expect(await AuditLog.countDocuments({ action: 'access.role.assigned_beyond_own', user: id.sys })).toBe(2);
    await new Promise((r) => setTimeout(r, 200));
    const told = (notifyUser as jest.Mock).mock.calls.map(([c]) => c).filter((c) => /was given out/.test(c.title)).map((c) => c.userId);
    expect(told.sort()).toEqual([id.owner, id.owner2, id.owner, id.owner2].sort());
  });

  it('cannot give itself more, change what roles contain, touch administrators, or grant single permissions it lacks', async () => {
    const PAY = 'taskflow.hr.payroll.manage';
    await call('sys', 'PATCH', `/users/${id.sys}`, { roleId: id.cfoRole, role: 'admin' });
    expect(await User.findById(id.sys).lean()).toMatchObject({ role: 'user', roleId: new mongoose.Types.ObjectId(id.sysRole) });
    expect(await status('sys', 'PATCH', `/users/${id.sys}/permissions`, { granted: [PAY], revoked: [] })).toBe(403);
    expect(await status('sys', 'PATCH', `/roles/${id.sysRole}`, { permissions: [...SYSTEM_ADMIN_PERMISSIONS, PAY] })).toBe(403);
    expect(await status('sys', 'POST', '/roles', { name: 'X', permissions: [PAY] })).toBe(403);
    expect(await status('sys', 'PATCH', `/users/${id.sam}/permissions`, { granted: [PAY], revoked: [] })).toBe(403);
    expect(await status('sys', 'PATCH', `/users/${id.sam}`, { role: 'admin' })).toBe(403);
    expect(await status('sys', 'PATCH', `/users/${id.owner}`, { enabled: false })).toBe(403);
  });

  it('without "assign any role", user managers stay within their own rights, default role included', async () => {
    const without = SYSTEM_ADMIN_PERMISSIONS.filter((p) => p !== 'auth.role.assign_any');
    await Role.updateOne({ _id: id.sysRole }, { permissions: without });
    expect(await status('sys', 'PATCH', `/users/${id.sam}`, { roleId: id.cfoRole })).toBe(403);
    expect(await status('sys', 'PATCH', '/core/preferences', { defaultRoleId: id.cfoRole })).toBe(403);
    expect(await status('owner', 'PATCH', '/core/preferences', { defaultRoleId: id.cfoRole })).toBe(200);
  });

  it('offers both templates to role managers only', async () => {
    const res = await call('sys', 'GET', '/roles/templates');
    expect(res.body.data.map((t: { code: string }) => t.code)).toEqual(['system_admin', 'executive']);
    expect(await status('exec', 'GET', '/roles/templates')).toBe(403);
  });
});

describe('read-only executive (AUT-11)', () => {
  it('opens every business module, without individual pay', async () => {
    const paths = ['/hrms/dashboard', '/crm/leads', '/crm/deals', '/crm/dashboard', '/billing/invoices', '/accounts/dashboard', '/contracts/dashboard', '/procurement/pos', '/assets/assets', '/service/tickets', '/resources/dashboard', '/dashboard/executive', '/audit-logs'];
    for (const path of paths) expect([path, await status('exec', 'GET', path)]).toEqual([path, 200]);
    const emp = await call('exec', 'GET', '/hrms/employees');
    expect(emp.body.data).toHaveLength(1);
    expect(emp.body.data[0]).not.toHaveProperty('annualCtc');
    expect(await status('exec', 'GET', '/hrms/payroll/runs')).toBe(403);
  });

  it('no route anywhere lets it write because of its role, beyond its own records', () => {
    const passes = (held: string[]) => (e: CatalogEntry) =>
      e.permissions.every((t) => (t.all ?? []).every((p) => userHasPermission(held, p)) && (!t.any?.length || t.any.some((p) => userHasPermission(held, p))));
    const writes = apiCatalog().filter((e) => e.method !== 'GET' && e.permissions.length > 0 && passes(EXECUTIVE_PERMISSIONS)(e) && !passes(DEFAULT_USER_PERMISSIONS)(e)).map((e) => `${e.method} ${e.path}`);
    const own = writes.filter((w) => / \/me\//.test(w) || / \/resources\/engagement\/entries/.test(w) || / \/timesheet\//.test(w));
    // Lookups sent as POST that change nothing: running a saved report, and checking unsaved lead details for duplicates.
    expect(writes.filter((w) => !own.includes(w)).sort()).toEqual(['POST /crm/leads/duplicates', 'POST /reports/:id/execute']);
  });

  it('reads every project of the workspace, changes none, and no other workspace', async () => {
    const list = await call('exec', 'GET', '/projects');
    expect(list.body.data.data.map((p: { key: string; canEdit: boolean }) => [p.key, p.canEdit])).toEqual([['APP', false]]);
    expect((await call('exec', 'GET', `/projects/${app1}/my-permissions`)).body.data.permissions.filter((p: string) => !/\.(read|list|view)$/.test(p))).toEqual([]);
    expect(await status('exec', 'GET', `/issues/${issueId}`)).toBe(200);
    expect((await call('exec', 'GET', `/issues?project=${app1}`)).body.data.total).toBe(1);
    for (const [m, path, body] of [
      ['PATCH', `/issues/${issueId}`, { title: 'X' }],
      ['DELETE', `/issues/${issueId}`],
      ['POST', '/issues', { project: app1, title: 'New' }],
      ['POST', `/issues/${issueId}/comments`, { body: 'x' }],
      ['POST', `/issues/${issueId}/work-logs`, { minutesSpent: 5, date: '2026-01-01' }],
      ['PATCH', `/projects/${app1}`, { name: 'X' }],
      ['DELETE', `/projects/${app1}`],
      ['POST', `/projects/${app1}/invite`, { email: 'sam@example.com' }],
    ] as Array<[string, string, unknown?]>) {
      expect([m, path, await status('exec', m, path, body)]).toEqual([m, path, 403]);
    }
    expect(await status('exec', 'PATCH', '/issues/bulk', { issueIds: ['APP-1'], updates: { priority: 'High' } })).toBe(400);
    expect((await Issue.findById(issueId).lean())?.title).toBe('One');
    expect((await call('exec', 'GET', `/projects/${id.foreign}/my-permissions`)).body.data?.permissions ?? []).toEqual([]);
    // Someone without "see all projects" still sees only their own.
    expect(await status('sam', 'GET', `/issues/${issueId}`)).toBe(403);
    expect((await call('sam', 'GET', '/projects')).body.data.total).toBe(0);
  });

  it('keeps edit rights in projects it is a member of', async () => {
    await ProjectMember.create({ project: app1, user: id.exec, permissions: ['issue.issue.update'] });
    expect(await status('exec', 'PATCH', `/issues/${issueId}`, { title: 'Two' })).toBe(200);
  });

  it('employee list access no longer files leave for other people', async () => {
    const emp = await HrmsEmployee.findOne().lean();
    expect(await status('exec', 'POST', '/hrms/leave', { employeeId: String(emp!._id), type: 'annual', startDate: '2026-12-01', endDate: '2026-12-01' })).toBe(403);
  });
});

describe('owners (AUT-11)', () => {
  const admins = () => User.countDocuments({ role: 'admin', enabled: { $ne: false } });

  it('an owner can become standard, but the last one cannot', async () => {
    expect(await status('owner', 'PATCH', `/users/${id.owner2}`, { role: 'user' })).toBe(200);
    for (const body of [{ role: 'user' }, { enabled: false }]) await call('owner', 'PATCH', `/users/${id.owner}`, body);
    expect(await admins()).toBe(1);
  });

  it('two owners removing each other at once still leaves one', async () => {
    for (let i = 0; i < 5; i++) {
      await User.updateMany({ _id: { $in: [id.owner, id.owner2] } }, { $set: { role: 'admin', enabled: true } });
      await Promise.all([call('owner', 'PATCH', `/users/${id.owner2}`, { role: 'user' }), call('owner2', 'PATCH', `/users/${id.owner}`, { enabled: false })]);
      expect(await admins()).toBeGreaterThanOrEqual(1);
    }
  });
});
