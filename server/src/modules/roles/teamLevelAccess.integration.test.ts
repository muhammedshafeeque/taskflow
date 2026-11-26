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
import { usersWithPermission } from '../auth/usersWithPermission';
import { forgetAccessRules } from '../auth/accessProfile';
import { ResourceTeam } from '../resources/models/resourceTeam.model';
import { HrmsEmployee } from '../hrms/models/hrmsEmployee.model';
import { AccessRule } from './accessRule.model';
import { Role } from './role.model';

jest.mock('../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(180_000);

const LEADS = 'taskflow.crm.lead.list';
const DEALS = 'taskflow.crm.deal.list';
const COMMISSION = 'taskflow.crm.commission.manage';
let mongo: MongoMemoryServer;
let server: Server;
let base = '';
let org: mongoose.Types.ObjectId;
const id: Record<string, string> = {};
const token: Record<string, string> = {};
const role: Record<string, string> = {};

async function call(who: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as { message?: string; data?: any } };
}
const can = async (who: string, path: string) => (await call(who, 'GET', path)).status === 200;
const perms = async (who: string) => (await call(who, 'GET', '/auth/me')).body.data.user.permissions as string[];

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
  const [base_, junior, senior, lead, hr, teams, roles] = await Role.create([
    { name: 'Staff', permissions: ['taskflow.self.profile.read'] },
    { name: 'Sales Junior', permissions: [LEADS] },
    { name: 'Sales Senior', permissions: [DEALS] },
    { name: 'Sales Lead', permissions: [COMMISSION] },
    { name: 'HR', permissions: ['taskflow.hr.employee.update', 'taskflow.hr.employee.list', 'taskflow.hr.scope.all'] },
    { name: 'Team admin', permissions: ['taskflow.resources.team.manage', 'taskflow.resources.dashboard.read'] },
    { name: 'Role admin', permissions: ['auth.role.manage_all', LEADS] },
  ]);
  Object.assign(role, { base: String(base_._id), junior: String(junior._id), senior: String(senior._id), lead: String(lead._id) });
  for (const [name, r] of Object.entries({ owner: null, sara: base_, sam: base_, hana: hr, tom: teams, rita: roles })) {
    const u = await User.create({ email: `${name}@example.com`, name, password: 'Passw0rd!x', mustChangePassword: false, role: name === 'owner' ? 'admin' : 'user', roleId: r?._id });
    id[name] = String(u._id);
    await OrganizationMember.create({ organization: org, user: u._id, role: 'org_member', status: 'active' });
    token[name] = (await createToken(id[name], String(org), { name: 't' })).token;
    id[`${name}Emp`] = String((await HrmsEmployee.create({ taskflowOrganizationId: org, userId: u._id, employeeCode: name, name, joinedDate: new Date() }))._id);
  }
  id.team = String((await ResourceTeam.create({ taskflowOrganizationId: org, name: 'Sales', memberIds: [id.sara, id.sam], leadId: id.sara }))._id);
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await flushAuditLogs();
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('roles build on roles (AUT-21)', () => {
  it('a role carries what the roles it builds on carry, however deep', async () => {
    expect((await call('owner', 'PATCH', `/roles/${role.senior}`, { inherits: [role.junior] })).status).toBe(200);
    expect((await call('owner', 'PATCH', `/roles/${role.lead}`, { inherits: [role.senior] })).status).toBe(200);
    await User.updateOne({ _id: id.sam }, { roleId: role.lead });
    expect(await perms('sam')).toEqual(expect.arrayContaining([LEADS, DEALS, COMMISSION]));
    expect(await can('sam', '/crm/leads')).toBe(true);
  });

  it('refuses loops and unknown roles, and deleting a role others build on', async () => {
    await call('owner', 'PATCH', `/roles/${role.senior}`, { inherits: [role.junior] });
    expect((await call('owner', 'PATCH', `/roles/${role.junior}`, { inherits: [role.senior] })).status).toBe(400);
    expect((await call('owner', 'PATCH', `/roles/${role.junior}`, { inherits: [role.junior] })).status).toBe(400);
    expect((await call('owner', 'PATCH', `/roles/${role.junior}`, { inherits: [String(new mongoose.Types.ObjectId())] })).status).toBe(400);
    expect((await call('owner', 'DELETE', `/roles/${role.junior}`)).status).toBe(400);
  });

  it('a role manager cannot pass on, through inheritance, rights they do not hold', async () => {
    expect((await call('rita', 'POST', '/roles', { name: 'Sneaky', permissions: [], inherits: [role.lead] })).status).toBe(403);
    expect((await call('rita', 'PATCH', `/roles/${role.junior}`, { inherits: [role.lead] })).status).toBe(403);
    expect((await call('rita', 'POST', '/roles', { name: 'Fine', permissions: [], inherits: [role.junior] })).status).toBe(201);
  });
});

describe('team and level give roles (AUT-21)', () => {
  const rule = (body: Record<string, unknown>, who = 'owner') => call(who, 'POST', '/roles/access-rules', { name: 'R', ...body });

  it('people in a team at a level get the rule roles; others do not; changing level takes them away', async () => {
    expect((await rule({ teamId: id.team, level: 'Senior', roleIds: [role.senior] })).status).toBe(201);
    expect(await can('sara', '/crm/deals')).toBe(false); // in the team, no level yet
    expect((await call('owner', 'PATCH', `/hrms/employees/${id.saraEmp}`, { level: 'senior' })).status).toBe(200);
    expect(await can('sara', '/crm/deals')).toBe(true);
    expect(await perms('sara')).toContain(DEALS);
    expect(await can('sam', '/crm/deals')).toBe(false);
    await call('owner', 'PATCH', `/hrms/employees/${id.saraEmp}`, { level: 'Junior' });
    expect(await can('sara', '/crm/deals')).toBe(false);
  });

  it('team leads can carry extra rights', async () => {
    await rule({ teamId: id.team, roleIds: [role.junior] });
    await rule({ teamId: id.team, leadsOnly: true, roleIds: [role.lead] });
    expect([await can('sara', '/crm/leads'), await can('sam', '/crm/leads')]).toEqual([true, true]);
    expect(await perms('sara')).toContain(COMMISSION);
    expect(await perms('sam')).not.toContain(COMMISSION);
    expect(await usersWithPermission(COMMISSION, String(org))).toEqual(expect.arrayContaining([id.sara]));
    expect(await usersWithPermission(COMMISSION, String(org))).not.toContain(id.sam);
  });

  it('works through inherited roles too, and a rule needs a team, level or leads', async () => {
    await call('owner', 'PATCH', `/roles/${role.senior}`, { inherits: [role.junior] });
    await rule({ level: 'Senior', roleIds: [role.senior] });
    await call('owner', 'PATCH', `/hrms/employees/${id.samEmp}`, { level: 'Senior' });
    expect(await can('sam', '/crm/leads')).toBe(true);
    expect((await rule({ roleIds: [role.junior] })).status).toBe(400);
    expect((await rule({ level: 'Wizard', roleIds: [role.junior] })).status).toBe(400);
  });

  it('cannot be used to give anyone, or yourself, more than you may', async () => {
    await rule({ teamId: id.team, roleIds: [role.lead] });
    await rule({ level: 'Senior', roleIds: [role.lead] });
    // HR may set levels but not hand out the Sales Lead role through one.
    expect((await call('hana', 'PATCH', `/hrms/employees/${id.tomEmp}`, { level: 'Senior' })).status).toBe(403);
    expect((await HrmsEmployee.findById(id.tomEmp).lean())?.level).toBeNull();
    expect(await can('tom', '/crm/commissions/plans')).toBe(false);
    // A team manager may not add themselves (or others) into a team that brings rights they lack.
    expect((await call('tom', 'PATCH', `/resources/teams/${id.team}`, { memberIds: [id.sara, id.sam, id.tom] })).status).toBe(403);
    expect((await ResourceTeam.findById(id.team).lean())!.memberIds.map(String)).not.toContain(id.tom);
    expect((await call('tom', 'POST', '/resources/teams', { name: 'Shadow', memberIds: [id.tom], leadId: id.tom })).status).toBe(201); // no rule matches it
    // A role manager may not write a rule that reaches themselves with rights they lack.
    await HrmsEmployee.updateOne({ _id: id.ritaEmp }, { level: 'Lead' });
    expect((await rule({ level: 'Lead', roleIds: [role.lead] }, 'rita')).status).toBe(403);
    expect(await AccessRule.countDocuments({ level: 'Lead' })).toBe(0);
    // Changes that give nothing new are fine.
    expect((await call('hana', 'PATCH', `/hrms/employees/${id.samEmp}`, { level: 'Junior' })).status).toBe(200);
  });
});

describe('mentor (AUT-21)', () => {
  it('can be recorded, changed and cleared, never yourself or a leaver', async () => {
    expect((await call('owner', 'PATCH', `/hrms/employees/${id.samEmp}`, { mentorId: id.saraEmp })).body.data.mentorId).toBe(id.saraEmp);
    expect((await call('owner', 'PATCH', `/hrms/employees/${id.samEmp}`, { mentorId: id.samEmp })).status).toBe(400);
    await HrmsEmployee.updateOne({ _id: id.tomEmp }, { status: 'terminated' });
    expect((await call('owner', 'PATCH', `/hrms/employees/${id.samEmp}`, { mentorId: id.tomEmp })).status).toBe(400);
    expect((await call('owner', 'PATCH', `/hrms/employees/${id.samEmp}`, { mentorId: '' })).body.data.mentorId).toBeNull();
  });
});
