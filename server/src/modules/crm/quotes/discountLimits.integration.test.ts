import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { crmRoutes } from '../crm.routes';
import { approvalsRoutes } from '../../approvals/approvals.routes';
import { errorHandler } from '../../../middleware/errorHandler';
import { Role } from '../../roles/role.model';
import { User } from '../../auth/user.model';
import { Organization } from '../../organizations/organization.model';
import { OrganizationMember } from '../../organizations/organizationMember.model';
import { createToken } from '../../apiTokens/apiToken.service';
import { HrmsEmployee } from '../../hrms/models/hrmsEmployee.model';
import { CustomerOrg } from '../../customer-portal/customer-org/customerOrg.model';
import { flushAuditLogs } from '../../auditLogs/logAudit';
import { CrmQuote } from '../models/crmQuote.model';
import { CrmDeal } from '../models/crmDeal.model';
import { ensureDefaultPipeline } from '../pipelines/pipelines.service';
import { createQuote } from './quotes.service';
import { quoteDiscountPercent } from './discountLimits';
import { TASK_FLOW_PERMISSIONS } from '../../../shared/constants/permissions';

jest.mock('../../../services/email.service', () => new Proxy({}, { get: (_t, name) => (name === '__esModule' ? true : name === 'tfEmailWrap' ? (s: string) => s : jest.fn().mockResolvedValue(undefined)) }));
jest.mock('../../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(120_000);

const T = TASK_FLOW_PERMISSIONS.TASKFLOW;
const QUOTE = [T.CRM.QUOTE.LIST, T.CRM.QUOTE.READ, T.CRM.QUOTE.CREATE, T.CRM.QUOTE.UPDATE];

let mongo: MongoMemoryServer;
let server: Server;
let base = '';
let orgId = '';
let customerOrgId = '';
let dealId = '';
let leadRoleId = '';
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};

async function call(who: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[who]}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; data?: any } };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await mongoose.connect(mongo.getUri());
  const app = express();
  app.use(express.json());
  app.use('/api/crm', crmRoutes);
  app.use('/api/approvals', approvalsRoutes);
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
 * Limits: default 10%, role "Sales lead" 20%, level "Manager" 40%.
 * rep and peer: default (10%). lead: Sales lead role (20%). head: Manager level (40%). admin: CRM settings.
 */
beforeEach(async () => {
  await flushAuditLogs();
  await mongoose.connection.dropDatabase();
  const [salesRole, leadRole, adminRole] = await Role.create([
    { name: 'Sales', permissions: QUOTE },
    { name: 'Sales lead', permissions: QUOTE },
    { name: 'CRM admin', permissions: [...QUOTE, T.CRM.SETTINGS.MANAGE, T.APPROVALS.POLICY.MANAGE] },
  ]);
  leadRoleId = String(leadRole._id);
  const owner = new mongoose.Types.ObjectId();
  const org = await Organization.create({ name: 'Co', slug: 'co', createdBy: owner });
  orgId = String(org._id);
  for (const [name, role] of Object.entries({ rep: salesRole, peer: salesRole, lead: leadRole, head: salesRole, admin: adminRole })) {
    const u = await User.create({ email: `${name}@example.com`, name, password: 'Passw0rd!x', mustChangePassword: false, roleId: role._id });
    await OrganizationMember.create({ organization: org._id, user: u._id, role: 'org_member', status: 'active' });
    ids[name] = String(u._id);
    tokens[name] = (await createToken(ids[name], orgId, { name: 't' })).token;
  }
  await HrmsEmployee.create({ taskflowOrganizationId: org._id, employeeCode: 'H', name: 'head', joinedDate: new Date('2024-01-01'), userId: ids.head, level: 'Manager' });
  const co = await CustomerOrg.create({ name: 'Acme', slug: 'acme', contactEmail: 'ops@acme.test', createdBy: owner, taskflowOrganizationId: org._id });
  customerOrgId = String(co._id);
  const pipeline = (await ensureDefaultPipeline(orgId)) as { _id: unknown; stages: Array<{ _id: unknown }> };
  const deal = await CrmDeal.create({ taskflowOrganizationId: org._id, customerOrgId, pipelineId: pipeline._id, stageId: pipeline.stages[0]._id, title: 'Acme', value: 1000, status: 'open', ownerId: ids.rep });
  dealId = String(deal._id);
  const put = await call('admin', 'PUT', '/crm/discount-policy', {
    enabled: true,
    defaultMaxPercent: 10,
    roleLimits: [{ roleId: leadRoleId, maxPercent: 20 }],
    levelLimits: [{ level: 'Manager', maxPercent: 40 }],
  });
  expect(put.status).toBe(200);
});

/** A quote at `pct`% off a 1,000 list price, made by `who`. */
async function quoteAt(pct: number, who = 'rep') {
  const q = await createQuote(
    orgId,
    { dealId, title: `Acme ${pct}%`, issueDate: '2026-11-01', lineItems: [{ description: 'Build', quantity: 10, unitPrice: 100 }], discountPercent: pct },
    ids[who]
  );
  return String((q as { _id: unknown })._id);
}
const accept = (who: string, id: string) => call(who, 'PATCH', `/crm/quotes/${id}`, { status: 'accepted' });
const queue = async (who: string) => ((await call(who, 'GET', '/approvals/queue')).body.data as Array<{ _id: string; recordId: string }>);

describe('quotation discount limits (AUT-31)', () => {
  it('measures discount against list price, counting line and quote discounts', () => {
    expect(quoteDiscountPercent({ lineItems: [{ quantity: 10, unitPrice: 100 }], subtotal: 1000, discountAmount: 150 })).toBe(15);
    // Line at 10% off (900), then 10% off the quote (810): 19% below list.
    expect(quoteDiscountPercent({ lineItems: [{ quantity: 10, unitPrice: 100 }], subtotal: 900, discountAmount: 90 })).toBe(19);
    expect(quoteDiscountPercent({ lineItems: [], subtotal: 0, discountAmount: 0 })).toBe(0);
  });

  it('shows each person their own limit: highest matching rule, else the default', async () => {
    expect((await call('rep', 'GET', '/crm/discount-policy')).body.data.myLimit).toBe(10);
    expect((await call('lead', 'GET', '/crm/discount-policy')).body.data.myLimit).toBe(20);
    expect((await call('head', 'GET', '/crm/discount-policy')).body.data.myLimit).toBe(40);
    // Only CRM settings managers change limits, and values are checked.
    expect((await call('rep', 'PUT', '/crm/discount-policy', { defaultMaxPercent: 100 })).status).toBe(403);
    expect((await call('admin', 'PUT', '/crm/discount-policy', { defaultMaxPercent: 120 })).status).toBe(400);
    expect((await call('admin', 'PUT', '/crm/discount-policy', { roleLimits: [{ roleId: leadRoleId, maxPercent: 5 }, { roleId: leadRoleId, maxPercent: 6 }] })).status).toBe(400);
  });

  it('a discount within the limit goes straight through', async () => {
    const id = await quoteAt(5);
    expect((await accept('rep', id)).status).toBe(200);
    expect((await CrmQuote.findById(id).lean())!.status).toBe('accepted');
  });

  it('a quote above the limit cannot be sent until someone whose limit covers it approves', async () => {
    const id = await quoteAt(15);
    const first = await accept('rep', id);
    expect(first.status).toBe(409);
    expect(first.body.message).toMatch(/15% off is above your discount limit of 10%/);
    expect((await CrmQuote.findById(id).lean())!.status).toBe('draft');
    expect((await accept('rep', id)).body.message).toMatch(/Waiting for discount approval/);
    // Emailing it is held the same way.
    expect((await call('rep', 'POST', `/crm/quotes/${id}/send`, { toEmail: 'ops@acme.test' })).status).toBe(409);

    // lead (20%) and head (40%) can approve; peer (10%) and the rep cannot.
    expect((await queue('peer')).map((q) => q.recordId)).not.toContain(id);
    expect((await queue('rep')).map((q) => q.recordId)).not.toContain(id);
    const req = (await queue('lead')).find((q) => q.recordId === id)!;
    expect(req).toBeTruthy();
    expect((await queue('head')).map((q) => q.recordId)).toContain(id);

    expect((await call('lead', 'POST', `/approvals/requests/${req._id}/decision`, { decision: 'approve' })).status).toBe(200);
    expect((await accept('rep', id)).status).toBe(200);
  });

  it('a bigger discount needs someone with a bigger limit; beyond everyone it is refused', async () => {
    const id = await quoteAt(30);
    expect((await accept('rep', id)).status).toBe(409);
    expect((await queue('lead')).map((q) => q.recordId)).not.toContain(id);
    expect((await queue('head')).map((q) => q.recordId)).toContain(id);

    const tooMuch = await quoteAt(60);
    const res = await accept('rep', tooMuch);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Nobody else's discount limit covers 60% off/);
  });

  it('people quote up to their own limit without approval', async () => {
    const id = await quoteAt(18, 'lead');
    expect((await accept('lead', id)).status).toBe(200);
  });

  it('changing the discount after approval needs approval again, even on a sent quote', async () => {
    const id = await quoteAt(15);
    await accept('rep', id);
    const req = (await queue('lead')).find((q) => q.recordId === id)!;
    await call('lead', 'POST', `/approvals/requests/${req._id}/decision`, { decision: 'approve' });
    expect((await call('rep', 'POST', `/crm/quotes/${id}/send`, { toEmail: 'ops@acme.test' })).status).toBe(200);
    expect((await CrmQuote.findById(id).lean())!.status).toBe('sent');

    // Sent quotes can still be edited: a deeper discount is held again before it is accepted.
    expect((await call('rep', 'PATCH', `/crm/quotes/${id}`, { discountPercent: 18 })).status).toBe(200);
    expect((await accept('rep', id)).status).toBe(409);
    expect((await CrmQuote.findById(id).lean())!.status).toBe('sent');
  });

  it('with limits off, any discount goes through as before', async () => {
    await call('admin', 'PUT', '/crm/discount-policy', { enabled: false });
    expect((await call('rep', 'GET', '/crm/discount-policy')).body.data.myLimit).toBeNull();
    const id = await quoteAt(60);
    expect((await accept('rep', id)).status).toBe(200);
  });

  it('with the quote chain on, over-limit quotes go through the chain, and chains can require a covering limit', async () => {
    const chain = await call('admin', 'PUT', '/approvals/policies/quote', {
      enabled: true,
      steps: [{ name: 'Discount check', kind: 'discount_limit' }],
    });
    expect(chain.status).toBe(200);
    const id = await quoteAt(30);
    expect((await accept('rep', id)).status).toBe(409);
    expect((await queue('lead')).map((q) => q.recordId)).not.toContain(id);
    const req = (await queue('head')).find((q) => q.recordId === id)!;
    expect(req).toBeTruthy();
    await call('head', 'POST', `/approvals/requests/${req._id}/decision`, { decision: 'approve' });
    expect((await accept('rep', id)).status).toBe(200);
  });
});
