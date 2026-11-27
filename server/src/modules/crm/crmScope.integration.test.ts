import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { crmRoutes } from './crm.routes';
import { errorHandler } from '../../middleware/errorHandler';
import { Role } from '../roles/role.model';
import { User } from '../auth/user.model';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { createToken } from '../apiTokens/apiToken.service';
import { HrmsEmployee } from '../hrms/models/hrmsEmployee.model';
import { ResourceTeam } from '../resources/models/resourceTeam.model';
import { CustomerOrg } from '../customer-portal/customer-org/customerOrg.model';
import { CrmLead } from './models/crmLead.model';
import { CrmDeal } from './models/crmDeal.model';
import { ensureDefaultPipeline } from './pipelines/pipelines.service';
import { globalSearch } from '../search/search.service';
import { GraphAccess } from '../links/links.service';
import { crmScopesToKeep, migrateCrmScopesIfNeeded } from '../../migrations/migrateDataScopes';
import { flushAuditLogs } from '../auditLogs/logAudit';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';

jest.mock('../../services/email.service', () => new Proxy({}, { get: (_t, name) => (name === '__esModule' ? true : name === 'tfEmailWrap' ? (s: string) => s : jest.fn().mockResolvedValue(undefined)) }));
jest.mock('../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(120_000);

const C = TASK_FLOW_PERMISSIONS.TASKFLOW.CRM;
const RECORD_PERMS = [
  C.LEAD.LIST, C.LEAD.READ, C.LEAD.CREATE, C.LEAD.UPDATE, C.LEAD.DELETE,
  C.DEAL.LIST, C.DEAL.READ, C.DEAL.CREATE, C.DEAL.UPDATE, C.DEAL.DELETE,
  C.REPORT.READ,
];

let mongo: MongoMemoryServer;
let server: Server;
let base = '';
let orgId = '';
let orgOid: mongoose.Types.ObjectId;
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};
const perms: Record<string, string[]> = {};
let pipelineId = '';
let stageIds: string[] = [];
let customerOrgId = '';

async function call(who: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api/crm${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[who]}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; data?: any; details?: any } };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await mongoose.connect(mongo.getUri());
  const app = express();
  app.use(express.json());
  app.use('/api/crm', crmRoutes);
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await flushAuditLogs();
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  await mongo?.stop();
});

/**
 * Sales team: junior and peer are juniors (no scope). lead is the junior's manager (team scope).
 * peer reports to nobody in this chart. head sees everything (all scope).
 */
beforeEach(async () => {
  await flushAuditLogs();
  await mongoose.connection.dropDatabase();
  const [juniorRole, leadRole, headRole] = await Role.create([
    { name: 'Sales junior', permissions: RECORD_PERMS },
    { name: 'Sales lead', permissions: [...RECORD_PERMS, C.SCOPE.TEAM] },
    { name: 'Sales head', permissions: [...RECORD_PERMS, C.SCOPE.ALL] },
  ]);
  const owner = new mongoose.Types.ObjectId();
  const org = await Organization.create({ name: 'Co', slug: 'co', createdBy: owner });
  orgId = String(org._id);
  orgOid = org._id as mongoose.Types.ObjectId;
  const roleOf = { junior: juniorRole, peer: juniorRole, mentee: juniorRole, lead: leadRole, head: headRole };
  for (const [name, role] of Object.entries(roleOf)) {
    const u = await User.create({ email: `${name}@example.com`, name, password: 'Passw0rd!x', mustChangePassword: false, roleId: role._id });
    await OrganizationMember.create({ organization: org._id, user: u._id, role: 'org_member', status: 'active' });
    ids[name] = String(u._id);
    perms[name] = role.permissions as string[];
    tokens[name] = (await createToken(ids[name], orgId, { name: 't' })).token;
  }
  const leadEmp = await HrmsEmployee.create({ taskflowOrganizationId: org._id, employeeCode: 'L', name: 'lead', joinedDate: new Date('2024-01-01'), userId: ids.lead });
  await HrmsEmployee.create({ taskflowOrganizationId: org._id, employeeCode: 'J', name: 'junior', joinedDate: new Date('2024-01-01'), userId: ids.junior, managerId: leadEmp._id });
  await HrmsEmployee.create({ taskflowOrganizationId: org._id, employeeCode: 'P', name: 'peer', joinedDate: new Date('2024-01-01'), userId: ids.peer });
  // mentee has no HR record but is in a team the lead leads.
  await ResourceTeam.create({ taskflowOrganizationId: org._id, name: 'Inside sales', leadId: ids.lead, memberIds: [ids.mentee] });

  const pipeline = await ensureDefaultPipeline(orgId);
  pipelineId = String((pipeline as { _id: unknown })._id);
  stageIds = ((pipeline as { stages: Array<{ _id: unknown; order: number }> }).stages ?? []).sort((a, b) => a.order - b.order).map((s) => String(s._id));
  const co = await CustomerOrg.create({ name: 'Acme', slug: 'acme', contactEmail: 'ops@acme.test', createdBy: owner, taskflowOrganizationId: org._id });
  customerOrgId = String(co._id);
});

const lead = (assignee: string | null, extra: Record<string, unknown> = {}) =>
  CrmLead.create({ taskflowOrganizationId: orgOid, title: `Lead of ${assignee ?? 'nobody'}`, source: 'website', status: 'new', assigneeId: assignee ? ids[assignee] : undefined, ...extra });
const deal = (owner: string | null, value = 1000) =>
  CrmDeal.create({ taskflowOrganizationId: orgOid, customerOrgId, pipelineId, stageId: stageIds[0], title: `Deal of ${owner ?? 'nobody'}`, value, probability: 50, status: 'open', ownerId: owner ? ids[owner] : undefined });
const titles = (rows: Array<{ title: string }>) => rows.map((r) => r.title).sort();

describe('CRM record-level access (AUT-29)', () => {
  it('a junior sees and edits only their own leads', async () => {
    const mine = await lead('junior');
    const peers = await lead('peer');
    await lead(null);

    const list = await call('junior', 'GET', '/leads');
    expect(titles(list.body.data.data)).toEqual(['Lead of junior']);
    expect(list.body.data.total).toBe(1);
    expect((await call('junior', 'GET', '/leads/stats')).body.data.total).toBe(1);

    expect((await call('junior', 'GET', `/leads/${mine._id}`)).status).toBe(200);
    // Someone else's lead looks like it does not exist.
    expect((await call('junior', 'GET', `/leads/${peers._id}`)).status).toBe(404);
    expect((await call('junior', 'PATCH', `/leads/${peers._id}`, { title: 'Mine now' })).status).toBe(404);
    expect((await call('junior', 'DELETE', `/leads/${peers._id}`)).status).toBe(404);
    expect((await call('junior', 'POST', `/leads/${peers._id}/convert`, {})).status).toBe(404);
    expect((await call('junior', 'GET', `/leads/${peers._id}/duplicates`)).status).toBe(404);
    expect((await CrmLead.findById(peers._id).lean())!.title).toBe('Lead of peer');

    // The ?assigneeId filter cannot widen the scope.
    expect((await call('junior', 'GET', `/leads?assigneeId=${ids.peer}`)).body.data.data).toHaveLength(0);
  });

  it('new leads go to the junior who adds them, and cannot be handed outside the team', async () => {
    const created = await call('junior', 'POST', '/leads', { title: 'Fresh' });
    expect(created.status).toBe(201);
    expect(String(created.body.data.assigneeId?._id ?? created.body.data.assigneeId)).toBe(ids.junior);

    expect((await call('junior', 'POST', '/leads', { title: 'For peer', assigneeId: ids.peer })).status).toBe(403);
    const id = created.body.data._id;
    expect((await call('junior', 'PATCH', `/leads/${id}`, { assigneeId: ids.peer })).status).toBe(403);
    expect((await call('junior', 'PATCH', `/leads/${id}`, { assigneeId: null })).status).toBe(403);
    expect((await call('junior', 'PATCH', `/leads/${id}`, { title: 'Renamed' })).status).toBe(200);

    // Without a scope limit, nothing changes: no assignee stays no assignee.
    const byHead = await call('head', 'POST', '/leads', { title: 'Pool' });
    expect(byHead.body.data.assigneeId ?? null).toBeNull();
  });

  it('a team lead sees the team: reports and members of teams they lead, not other people', async () => {
    await lead('junior');
    await lead('mentee');
    await lead('lead');
    const peers = await lead('peer');

    expect(titles((await call('lead', 'GET', '/leads')).body.data.data)).toEqual(['Lead of junior', 'Lead of lead', 'Lead of mentee']);
    expect((await call('lead', 'GET', `/leads/${peers._id}`)).status).toBe(404);

    // Can hand work around the team, but not outside it.
    const own = await lead('lead');
    expect((await call('lead', 'PATCH', `/leads/${own._id}`, { assigneeId: ids.junior })).status).toBe(200);
    expect((await call('lead', 'PATCH', `/leads/${own._id}`, { assigneeId: ids.peer })).status).toBe(403);
    expect(String((await CrmLead.findById(own._id).lean())!.assigneeId)).toBe(ids.junior);
  });

  it('"all" scope sees every lead and deal, including unassigned ones', async () => {
    await lead('junior');
    await lead('peer');
    await lead(null);
    await deal('peer');
    await deal(null);
    expect((await call('head', 'GET', '/leads')).body.data.total).toBe(3);
    expect((await call('head', 'GET', '/deals')).body.data).toHaveLength(2);
  });

  it('deals follow the same scope: list, open, edit, move, forecast', async () => {
    const mine = await deal('junior', 1000);
    const peers = await deal('peer', 5000);

    expect(titles((await call('junior', 'GET', '/deals')).body.data)).toEqual(['Deal of junior']);
    expect(titles((await call('junior', 'GET', `/deals?ownerId=${ids.peer}`)).body.data)).toEqual([]);
    expect((await call('junior', 'GET', `/deals/${mine._id}`)).status).toBe(200);
    expect((await call('junior', 'GET', `/deals/${peers._id}`)).status).toBe(404);
    expect((await call('junior', 'PATCH', `/deals/${peers._id}`, { value: 1 })).status).toBe(404);
    expect((await call('junior', 'POST', `/deals/${peers._id}/move-stage`, { stageId: stageIds[1] })).status).toBe(404);
    expect((await call('junior', 'DELETE', `/deals/${peers._id}`)).status).toBe(404);
    expect((await call('junior', 'PATCH', `/deals/${mine._id}`, { ownerId: ids.peer })).status).toBe(403);
    expect((await call('junior', 'GET', '/deals/forecast')).body.data.pipelineValue).toBe(1000);
    expect((await call('head', 'GET', '/deals/forecast')).body.data.pipelineValue).toBe(6000);

    const created = await call('junior', 'POST', '/deals', { title: 'New', customerOrgId, pipelineId, stageId: stageIds[0], value: 10 });
    expect(created.status).toBe(201);
    expect(String(created.body.data.ownerId)).toBe(ids.junior);

    expect(titles((await call('lead', 'GET', '/deals')).body.data)).toEqual(['Deal of junior', 'New']);
  });

  it('merging needs both leads in reach', async () => {
    const mine = await lead('junior', { contactEmail: 'x@acme.test' });
    const peers = await lead('peer', { contactEmail: 'x@acme.test' });
    expect((await call('junior', 'POST', `/leads/${mine._id}/merge`, { sourceId: String(peers._id) })).status).toBe(404);
    expect(await CrmLead.countDocuments()).toBe(2);
  });

  it('duplicate warnings still fire for leads outside reach, without the customer details', async () => {
    await lead('peer', { contactEmail: 'omar@northwind.test', contactName: 'Omar', companyName: 'Northwind' });

    const check = await call('junior', 'POST', '/leads/duplicates', { contactEmail: 'omar@northwind.test' });
    expect(check.body.data.leads).toHaveLength(1);
    expect(check.body.data.leads[0]).toMatchObject({ outOfScope: true, title: 'A lead assigned to peer', reasons: expect.arrayContaining(['email']) });
    expect(check.body.data.leads[0]).not.toHaveProperty('contactEmail');
    expect(check.body.data.leads[0]).not.toHaveProperty('contactName');

    const create = await call('junior', 'POST', '/leads', { title: 'Northwind again', contactEmail: 'omar@northwind.test' });
    expect(create.status).toBe(409);
    const details = create.body.details ?? create.body.data;
    expect(details.leads[0]).toMatchObject({ outOfScope: true });
    expect(details.leads[0]).not.toHaveProperty('contactName');

    // Someone who reaches it sees the full match.
    const full = await call('head', 'POST', '/leads/duplicates', { contactEmail: 'omar@northwind.test' });
    expect(full.body.data.leads[0]).toMatchObject({ contactName: 'Omar' });
    expect(full.body.data.leads[0].outOfScope).toBeUndefined();
  });

  it('global search and the record graph stay inside the scope', async () => {
    await lead('junior', { companyName: 'Zebra Corp' });
    await lead('peer', { companyName: 'Zebra Inc' });
    await deal('peer');

    const juniorHits = await globalSearch(orgId, 'Zebra', { userId: ids.junior, permissions: perms.junior });
    expect(juniorHits.hits.filter((h) => h.type === 'lead').map((h) => h.title)).toEqual(['Lead of junior']);
    const dealHits = await globalSearch(orgId, 'Deal of', { userId: ids.junior, permissions: perms.junior });
    expect(dealHits.hits.filter((h) => h.type === 'deal')).toHaveLength(0);

    const access = new GraphAccess(orgOid, { userId: ids.junior, permissions: perms.junior });
    expect(await access.rowFilter('lead')).toHaveProperty('assigneeId');
    expect(await access.rowFilter('deal')).toHaveProperty('ownerId');
    expect(await new GraphAccess(orgOid, { userId: ids.head, permissions: perms.head }).rowFilter('deal')).toEqual({});
  });

  it('existing roles keep reaching every lead and deal after the upgrade', async () => {
    expect(crmScopesToKeep([C.LEAD.LIST])).toEqual([C.SCOPE.ALL]);
    expect(crmScopesToKeep([C.DEAL.UPDATE, C.SCOPE.TEAM])).toEqual([C.SCOPE.ALL]);
    expect(crmScopesToKeep([C.LEAD.LIST, C.SCOPE.ALL])).toEqual([]);
    expect(crmScopesToKeep(['taskflow.crm.*'])).toEqual([]);
    expect(crmScopesToKeep([C.CONTACT.LIST])).toEqual([]);

    const old = await Role.create({ name: 'Old sales', permissions: [C.LEAD.LIST, C.DEAL.LIST] });
    const other = await Role.create({ name: 'Support', permissions: [C.CONTACT.LIST] });
    const res = await migrateCrmScopesIfNeeded();
    expect(res.roles).toBeGreaterThanOrEqual(1);
    expect((await Role.findById(old._id).lean())!.permissions).toContain(C.SCOPE.ALL);
    expect((await Role.findById(other._id).lean())!.permissions).not.toContain(C.SCOPE.ALL);
    expect(await migrateCrmScopesIfNeeded()).toEqual({ roles: 0, users: 0 });
  });
});
