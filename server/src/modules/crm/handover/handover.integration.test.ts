import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { crmRoutes } from '../crm.routes';
import { errorHandler } from '../../../middleware/errorHandler';
import { Role } from '../../roles/role.model';
import { User } from '../../auth/user.model';
import { Organization } from '../../organizations/organization.model';
import { OrganizationMember } from '../../organizations/organizationMember.model';
import { createToken } from '../../apiTokens/apiToken.service';
import { flushAuditLogs } from '../../auditLogs/logAudit';
import { CrmDeal } from '../models/crmDeal.model';
import { CrmHandover } from '../models/crmHandover.model';
import { ensureDefaultPipeline } from '../pipelines/pipelines.service';
import { TASK_FLOW_PERMISSIONS } from '../../../shared/constants/permissions';

jest.mock('../../../services/email.service', () => new Proxy({}, { get: (_t, name) => (name === '__esModule' ? true : name === 'tfEmailWrap' ? (s: string) => s : jest.fn().mockResolvedValue(undefined)) }));
jest.mock('../../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(120_000);

const C = TASK_FLOW_PERMISSIONS.TASKFLOW.CRM;
const SALES = [C.DEAL.LIST, C.DEAL.READ, C.DEAL.UPDATE, C.DEAL.CREATE, C.SCOPE.ALL];

let mongo: MongoMemoryServer;
let server: Server;
let base = '';
let orgId = '';
let orgOid: mongoose.Types.ObjectId;
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};

async function call(who: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api/crm${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[who]}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; data?: any } };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await mongoose.connect(mongo.getUri());
  await CrmHandover.init();
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

/** sales: works deals. pm: delivery manager with no CRM rights. other: another member. */
beforeEach(async () => {
  await flushAuditLogs();
  await mongoose.connection.dropDatabase();
  await CrmHandover.init();
  const [salesRole, plainRole] = await Role.create([{ name: 'Sales', permissions: SALES }, { name: 'Member', permissions: [] }]);
  const owner = await User.create({ email: 'owner@example.com', name: 'owner', password: 'Passw0rd!x', mustChangePassword: false });
  const org = await Organization.create({ name: 'Co', slug: 'co', createdBy: owner._id });
  orgId = String(org._id);
  orgOid = org._id as mongoose.Types.ObjectId;
  for (const [name, role] of Object.entries({ sales: salesRole, pm: plainRole, other: plainRole })) {
    const u = await User.create({ email: `${name}@example.com`, name, password: 'Passw0rd!x', mustChangePassword: false, roleId: role._id });
    ids[name] = String(u._id);
    await OrganizationMember.create({ organization: org._id, user: u._id, role: 'org_member', status: 'active' });
    tokens[name] = (await createToken(ids[name], orgId, { name: 't' })).token;
  }
  await ensureDefaultPipeline(orgId);
});

async function wonDeal() {
  const pipeline = await ensureDefaultPipeline(orgId);
  const open = (pipeline.stages as Array<{ _id: unknown; isWon?: boolean; isLost?: boolean }>).find((s) => !s.isWon && !s.isLost)!;
  const deal = await CrmDeal.create({ taskflowOrganizationId: orgOid, pipelineId: pipeline._id, stageId: open._id, title: 'Portal rebuild', value: 5000, ownerId: ids.sales });
  const won = await call('sales', 'PATCH', `/deals/${deal._id}`, { status: 'won', winReason: 'Best fit' });
  expect(won.status).toBe(200);
  return String(deal._id);
}

const tickRequired = async (dealId: string) => {
  const h = (await call('sales', 'GET', `/deals/${dealId}/handover`)).body.data;
  return call('sales', 'PATCH', `/deals/${dealId}/handover`, { items: h.items.filter((i: any) => i.required).map((i: any) => ({ id: i._id, done: true })) });
};

describe('sales-to-delivery handover (AUT-41)', () => {
  it('starts when a deal is won, from the workspace checklist, and once only', async () => {
    const dealId = await wonDeal();
    const h = await call('sales', 'GET', `/deals/${dealId}/handover`);
    expect(h.status).toBe(200);
    expect(h.body.data).toMatchObject({ status: 'open' });
    expect(h.body.data.items.length).toBeGreaterThan(0);
    await call('sales', 'PATCH', `/deals/${dealId}`, { title: 'Portal rebuild v2' });
    expect(await CrmHandover.countDocuments({ dealId })).toBe(1);
  });

  it('uses the template set in CRM settings', async () => {
    await CrmHandover.deleteMany({});
    const { saveHandoverTemplate } = await import('./handover.service');
    await saveHandoverTemplate(orgId, { items: [{ title: 'Kick-off booked', required: true }, 'Nice to have'] });
    const dealId = await wonDeal();
    const h = (await call('sales', 'GET', `/deals/${dealId}/handover`)).body.data;
    expect(h.items.map((i: any) => [i.title, i.required])).toEqual([['Kick-off booked', true], ['Nice to have', true]]);
  });

  it('cannot be sent until required items are done and a PM is chosen', async () => {
    const dealId = await wonDeal();
    expect((await call('sales', 'POST', `/deals/${dealId}/handover/submit`)).status).toBe(400);
    await call('sales', 'PATCH', `/deals/${dealId}/handover`, { pmUserId: ids.pm });
    const early = await call('sales', 'POST', `/deals/${dealId}/handover/submit`);
    expect(early.status).toBe(400);
    expect(early.body.message).toMatch(/required items/i);
    await tickRequired(dealId);
    const sent = await call('sales', 'POST', `/deals/${dealId}/handover/submit`);
    expect(sent.status).toBe(200);
    expect(sent.body.data.status).toBe('submitted');
    // Locked while the PM has it.
    expect((await call('sales', 'PATCH', `/deals/${dealId}/handover`, { notes: 'late' })).status).toBe(409);
    expect((await call('sales', 'PATCH', `/deals/${dealId}/handover`, { pmUserId: String(new mongoose.Types.ObjectId()) })).status).toBe(409);
  });

  it('refuses a PM who is not in the workspace, and required items cannot be removed', async () => {
    const dealId = await wonDeal();
    expect((await call('sales', 'PATCH', `/deals/${dealId}/handover`, { pmUserId: String(new mongoose.Types.ObjectId()) })).status).toBe(400);
    const h = (await call('sales', 'GET', `/deals/${dealId}/handover`)).body.data;
    const req = h.items.find((i: any) => i.required);
    expect((await call('sales', 'PATCH', `/deals/${dealId}/handover`, { removeItemIds: [req._id] })).status).toBe(400);
    const added = await call('sales', 'PATCH', `/deals/${dealId}/handover`, { addItems: ['Hosting access'] });
    const extra = added.body.data.items.find((i: any) => i.title === 'Hosting access');
    expect(extra.required).toBe(false);
    const removed = await call('sales', 'PATCH', `/deals/${dealId}/handover`, { removeItemIds: [extra._id] });
    expect(removed.body.data.items.some((i: any) => i.title === 'Hosting access')).toBe(false);
  });

  it('only the chosen PM accepts or returns it; returning needs a note and lets sales fix and resend', async () => {
    const dealId = await wonDeal();
    await call('sales', 'PATCH', `/deals/${dealId}/handover`, { pmUserId: ids.pm });
    await tickRequired(dealId);
    const id = (await call('sales', 'POST', `/deals/${dealId}/handover/submit`)).body.data._id;

    // The PM sees it without any CRM permission; another member does not.
    expect((await call('pm', 'GET', '/handovers?mine=1')).body.data).toHaveLength(1);
    expect((await call('pm', 'GET', `/handovers/${id}`)).status).toBe(200);
    expect((await call('other', 'GET', `/handovers/${id}`)).status).toBe(404);
    expect((await call('other', 'GET', '/handovers')).body.data).toHaveLength(0);
    expect((await call('other', 'POST', `/handovers/${id}/accept`)).status).toBe(403);
    expect((await call('sales', 'POST', `/handovers/${id}/accept`)).status).toBe(403);
    // A PM without CRM rights cannot touch the deal side.
    expect((await call('pm', 'PATCH', `/deals/${dealId}/handover`, { notes: 'x' })).status).toBe(403);

    expect((await call('pm', 'POST', `/handovers/${id}/return`, { note: ' ' })).status).toBe(400);
    const returned = await call('pm', 'POST', `/handovers/${id}/return`, { note: 'Contract missing' });
    expect(returned.body.data).toMatchObject({ status: 'returned', returnNote: 'Contract missing' });
    expect((await call('pm', 'POST', `/handovers/${id}/accept`)).status).toBe(409);

    await call('sales', 'PATCH', `/deals/${dealId}/handover`, { notes: 'Contract attached' });
    expect((await call('sales', 'POST', `/deals/${dealId}/handover/submit`)).status).toBe(200);
    const accepted = await call('pm', 'POST', `/handovers/${id}/accept`, {});
    expect(accepted.body.data.status).toBe('accepted');
    expect(String(accepted.body.data.acceptedBy._id)).toBe(ids.pm);
    expect((await call('pm', 'POST', `/handovers/${id}/accept`)).status).toBe(409);
    expect((await call('sales', 'PATCH', `/deals/${dealId}/handover`, { notes: 'after' })).status).toBe(409);
  });

  it('is decided once, even when accept and return are pressed together', async () => {
    const dealId = await wonDeal();
    await call('sales', 'PATCH', `/deals/${dealId}/handover`, { pmUserId: ids.pm });
    await tickRequired(dealId);
    const id = (await call('sales', 'POST', `/deals/${dealId}/handover/submit`)).body.data._id;
    const results = await Promise.all([call('pm', 'POST', `/handovers/${id}/accept`), call('pm', 'POST', `/handovers/${id}/return`, { note: 'no' })]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it('is cancelled when the deal is reopened, and opens again when it is won again', async () => {
    const dealId = await wonDeal();
    await call('sales', 'PATCH', `/deals/${dealId}`, { status: 'open' });
    expect((await CrmHandover.findOne({ dealId }).lean())!.status).toBe('cancelled');
    await call('sales', 'PATCH', `/deals/${dealId}`, { status: 'won' });
    expect((await CrmHandover.findOne({ dealId }).lean())!.status).toBe('open');
    expect(await CrmHandover.countDocuments({ dealId })).toBe(1);
  });

  it('is started for a deal that was won before handovers existed', async () => {
    const dealId = await wonDeal();
    await CrmHandover.deleteMany({});
    const h = await call('sales', 'GET', `/deals/${dealId}/handover`);
    expect(h.body.data.status).toBe('open');
  });
});
