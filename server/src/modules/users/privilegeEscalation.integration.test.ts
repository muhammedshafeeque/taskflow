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
import { ALL_TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import { permissionsNotHeld } from '../auth/grantGuard';
import { usersRoutes } from './users.routes';
import { rolesRoutes } from '../roles/roles.routes';
import { errorHandler } from '../../middleware/errorHandler';

jest.mock('../../services/email.service', () => ({
  sendInviteEmail: jest.fn().mockResolvedValue(undefined),
  sendWorkspaceJoinInviteEmail: jest.fn().mockResolvedValue(undefined),
}));
jest.setTimeout(120_000);

const PAYROLL = 'taskflow.hr.payroll.manage';
const LEADS = 'taskflow.crm.lead.list';
const MANAGER = ['auth.user.list', 'auth.user.read', 'auth.user.create', 'auth.user.update', 'auth.role.manage_all', LEADS];

let mongo: MongoMemoryServer;
let server: Server;
let base = '';
const id: Record<string, string> = {};
const token: Record<string, string> = {};

async function call(who: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token[who]}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as { message?: string } };
}

const stored = (who: string) => User.findById(id[who]).lean();

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const app = express();
  app.use(express.json());
  app.use('/users', usersRoutes);
  app.use('/roles', rolesRoutes);
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  const [mgrRole, salesRole, payRole] = await Role.create([
    { name: 'Manager', permissions: MANAGER },
    { name: 'Sales', permissions: [LEADS] },
    { name: 'Payroll', permissions: [PAYROLL] },
  ]);
  Object.assign(id, { mgrRole: String(mgrRole._id), salesRole: String(salesRole._id), payRole: String(payRole._id) });
  const org = await Organization.create({ name: 'Co', slug: 'co', createdBy: new mongoose.Types.ObjectId() });
  const mk = async (name: string, extra: Record<string, unknown>) => {
    const u = await User.create({ email: `${name}@example.com`, name, password: 'Passw0rd!x', mustChangePassword: false, ...extra });
    await OrganizationMember.create({ organization: org._id, user: u._id, role: 'org_member', status: 'active' });
    id[name] = String(u._id);
    token[name] = (await createToken(id[name], String(org._id), { name: 't' })).token;
  };
  await mk('admin', { role: 'admin' });
  await mk('mgr', { role: 'user', roleId: mgrRole._id });
  await mk('sam', { role: 'user', roleId: salesRole._id });
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await flushAuditLogs();
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('granting rights (AUT-7)', () => {
  it('a non-admin cannot make anyone an admin', async () => {
    expect((await call('mgr', 'PATCH', `/users/${id.sam}`, { role: 'admin' })).status).toBe(403);
    expect((await stored('sam'))?.role).toBe('user');
    expect((await call('admin', 'PATCH', `/users/${id.sam}`, { role: 'admin' })).status).toBe(200);
    expect((await stored('sam'))?.role).toBe('admin');
  });

  it('a user cannot grant a permission they do not hold', async () => {
    const res = await call('mgr', 'PATCH', `/users/${id.sam}/permissions`, { granted: [PAYROLL], revoked: [] });
    expect(res.status).toBe(403);
    expect(res.body.message).toContain(PAYROLL);
    expect((await stored('sam'))?.permissionOverrides.granted).toEqual([]);
    // A wildcard over something you partly hold is not held either.
    expect((await call('mgr', 'PATCH', `/users/${id.sam}/permissions`, { granted: ['taskflow.crm.*'], revoked: [] })).status).toBe(403);
    expect((await call('mgr', 'PATCH', `/users/${id.sam}/permissions`, { granted: ['auth.user.list'], revoked: [] })).status).toBe(200);
    expect((await call('admin', 'PATCH', `/users/${id.sam}/permissions`, { granted: [PAYROLL], revoked: [] })).status).toBe(200);
  });

  it('keeps grants made by someone else, and un-revoking counts as granting', async () => {
    await call('admin', 'PATCH', `/users/${id.sam}/permissions`, { granted: [PAYROLL], revoked: [] });
    expect((await call('mgr', 'PATCH', `/users/${id.sam}/permissions`, { granted: [PAYROLL, 'auth.user.list'], revoked: [] })).status).toBe(200);
    await call('admin', 'PATCH', `/users/${id.sam}`, { roleId: id.payRole });
    await call('admin', 'PATCH', `/users/${id.sam}/permissions`, { granted: [], revoked: [PAYROLL] });
    expect((await call('mgr', 'PATCH', `/users/${id.sam}/permissions`, { granted: [], revoked: [] })).status).toBe(403);
  });

  it('nobody can change their own permissions, not even an admin', async () => {
    for (const who of ['mgr', 'admin']) {
      expect((await call(who, 'PATCH', `/users/${id[who]}/permissions`, { granted: [LEADS], revoked: [] })).status).toBe(403);
      await call(who, 'PATCH', `/users/${id[who]}`, { role: 'admin', roleId: id.payRole });
    }
    expect((await stored('mgr'))?.role).toBe('user');
    expect(String((await stored('mgr'))?.roleId)).toBe(id.mgrRole);
  });

  it('a user cannot assign a role with more rights than they hold', async () => {
    expect((await call('mgr', 'PATCH', `/users/${id.sam}`, { roleId: id.payRole })).status).toBe(403);
    expect(String((await stored('sam'))?.roleId)).toBe(id.salesRole);
    expect((await call('mgr', 'PATCH', `/users/${id.sam}`, { roleId: id.mgrRole })).status).toBe(200);
  });

  it('re-saving a user with the same role keeps their overrides', async () => {
    await call('admin', 'PATCH', `/users/${id.sam}/permissions`, { granted: ['auth.user.list'], revoked: [LEADS] });
    expect((await call('mgr', 'PATCH', `/users/${id.sam}`, { name: 'Samuel', roleId: id.salesRole, enabled: true })).status).toBe(200);
    const sam = await stored('sam');
    expect(sam?.name).toBe('Samuel');
    expect(sam?.permissionOverrides).toMatchObject({ granted: ['auth.user.list'], revoked: [LEADS] });
  });

  it('a user cannot invite someone into a role with more rights than they hold', async () => {
    const invite = (who: string, roleId: string, email: string) => call(who, 'POST', '/users/invite', { name: 'New', email, roleId });
    expect((await invite('mgr', id.payRole, 'a@example.com')).status).toBe(403);
    expect(await User.countDocuments({ email: 'a@example.com' })).toBe(0);
    expect((await invite('mgr', id.salesRole, 'b@example.com')).status).toBe(201);
    expect((await invite('admin', id.payRole, 'c@example.com')).status).toBe(201);
  });

  it('a role manager cannot add rights they do not hold to a role', async () => {
    expect((await call('mgr', 'PATCH', `/roles/${id.mgrRole}`, { permissions: [...MANAGER, PAYROLL] })).status).toBe(403);
    expect((await Role.findById(id.mgrRole).lean())?.permissions).not.toContain(PAYROLL);
    expect((await call('mgr', 'POST', '/roles', { name: 'Sneaky', permissions: [PAYROLL] })).status).toBe(403);
    // Editing around rights already in the role is fine.
    expect((await call('mgr', 'PATCH', `/roles/${id.payRole}`, { name: 'Pay', permissions: [PAYROLL, LEADS] })).status).toBe(200);
    expect((await call('admin', 'POST', '/roles', { name: 'Fine', permissions: [PAYROLL] })).status).toBe(201);
  });

  it('a non-admin cannot disable, edit or reset 2FA of an admin', async () => {
    expect((await call('mgr', 'PATCH', `/users/${id.admin}`, { enabled: false })).status).toBe(403);
    expect((await call('mgr', 'PATCH', `/users/${id.admin}/permissions`, { granted: [], revoked: [LEADS] })).status).toBe(403);
    expect((await call('mgr', 'POST', `/users/${id.admin}/reset-two-factor`)).status).toBe(403);
    expect((await stored('admin'))?.enabled).toBe(true);
  });

  it('audits every access change and every refusal', async () => {
    await call('admin', 'PATCH', `/users/${id.sam}/permissions`, { granted: [PAYROLL], revoked: [] });
    await call('admin', 'PATCH', `/users/${id.sam}`, { roleId: id.payRole, enabled: false });
    await call('admin', 'PATCH', `/roles/${id.salesRole}`, { permissions: [LEADS, PAYROLL] });
    await call('mgr', 'PATCH', `/users/${id.sam}`, { role: 'admin' });
    await flushAuditLogs();
    const logs = await AuditLog.find().lean();
    const find = (action: string) => logs.find((l) => l.action === action);
    expect(find('user.permissions.update')).toMatchObject({ resourceId: id.sam, meta: { granted: [PAYROLL] } });
    expect(find('user.access.update')).toMatchObject({ meta: { roleId: { from: id.salesRole, to: id.payRole }, enabled: { from: true, to: false } } });
    expect(find('role.update')).toMatchObject({ meta: { added: [PAYROLL], removed: [] } });
    expect(String(find('access.grant.denied')?.user)).toBe(id.mgr);
  });
});

describe('permissionsNotHeld', () => {
  it('covers every staff permission for someone holding them all, legacy codes included', () => {
    expect(permissionsNotHeld(ALL_TASK_FLOW_PERMISSIONS, ALL_TASK_FLOW_PERMISSIONS)).toEqual([]);
    expect(permissionsNotHeld(['users:list'], ['auth.user.list'])).toEqual([]);
  });

  it('treats project-level rights as separate from staff rights', () => {
    expect(permissionsNotHeld(ALL_TASK_FLOW_PERMISSIONS, ['project.scope.delete'])).toEqual(['project.scope.delete']);
  });
});
