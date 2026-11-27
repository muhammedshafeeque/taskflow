import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { crmRoutes } from './crm.routes';
import { customerQuoteRoutes, publicQuoteRoutes, quoteResponseToken } from './quotes/customerQuotes';
import { errorHandler } from '../../middleware/errorHandler';
import { env } from '../../config/env';
import { Role } from '../roles/role.model';
import { User } from '../auth/user.model';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { createToken } from '../apiTokens/apiToken.service';
import { CustomerOrg } from '../customer-portal/customer-org/customerOrg.model';
import { CustomerRole } from '../customer-portal/customer-role/customerRole.model';
import { CustomerUser } from '../customer-portal/customer-user/customerUser.model';
import { flushAuditLogs } from '../auditLogs/logAudit';
import { CrmLead } from './models/crmLead.model';
import { CrmDeal } from './models/crmDeal.model';
import { CrmQuote } from './models/crmQuote.model';
import { ensureDefaultPipeline } from './pipelines/pipelines.service';
import { createQuote } from './quotes/quotes.service';
import * as commissions from './commissions/commissions';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';

jest.mock('../../services/email.service', () => new Proxy({}, { get: (_t, name) => (name === '__esModule' ? true : name === 'tfEmailWrap' ? (s: string) => s : jest.fn().mockResolvedValue(undefined)) }));
jest.mock('../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(120_000);

const C = TASK_FLOW_PERMISSIONS.TASKFLOW.CRM;
const SALES = [
  C.LEAD.LIST, C.LEAD.READ, C.LEAD.CREATE, C.LEAD.UPDATE,
  C.DEAL.LIST, C.DEAL.READ, C.DEAL.CREATE, C.DEAL.UPDATE,
  C.QUOTE.LIST, C.QUOTE.READ, C.QUOTE.CREATE, C.QUOTE.UPDATE,
  C.SCOPE.ALL, TASK_FLOW_PERMISSIONS.PROJECT.PROJECT.CREATE,
];

let mongo: MongoMemoryServer;
let server: Server;
let base = '';
let orgId = '';
let orgOid: mongoose.Types.ObjectId;
let customerOrgId = '';
let otherOrgId = '';
let stages: Array<{ _id: string; name: string; isWon?: boolean; isLost?: boolean }> = [];
let pipelineId = '';
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};
let accrue: jest.SpyInstance;

async function call(token: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; data?: any } };
}
const as = (who: string) => tokens[who];

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await mongoose.connect(mongo.getUri());
  const app = express();
  app.use(express.json());
  app.use('/api/crm', crmRoutes);
  app.use('/api/public/quotes', publicQuoteRoutes);
  app.use('/api/customer/quotes', customerQuoteRoutes);
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

beforeEach(async () => {
  await flushAuditLogs();
  await mongoose.connection.dropDatabase();
  accrue = jest.spyOn(commissions, 'accrueDealCommission').mockResolvedValue(undefined as never);
  const [sales, admin] = await Role.create([
    { name: 'Sales', permissions: SALES },
    { name: 'CRM admin', permissions: [...SALES, C.SETTINGS.MANAGE] },
  ]);
  const owner = new mongoose.Types.ObjectId();
  const org = await Organization.create({ name: 'Northwind Studio', slug: 'nw', createdBy: owner });
  orgId = String(org._id);
  orgOid = org._id as mongoose.Types.ObjectId;
  for (const [name, role] of Object.entries({ rep: sales, admin })) {
    const u = await User.create({ email: `${name}@example.com`, name, password: 'Passw0rd!x', mustChangePassword: false, roleId: role._id });
    await OrganizationMember.create({ organization: org._id, user: u._id, role: 'org_member', status: 'active' });
    ids[name] = String(u._id);
    tokens[name] = (await createToken(ids[name], orgId, { name: 't' })).token;
  }
  const [co, other] = await CustomerOrg.create([
    { name: 'Acme', slug: 'acme', contactEmail: 'ops@acme.test', createdBy: owner, taskflowOrganizationId: org._id },
    { name: 'Globex', slug: 'globex', contactEmail: 'ops@globex.test', createdBy: owner, taskflowOrganizationId: org._id },
  ]);
  customerOrgId = String(co._id);
  otherOrgId = String(other._id);
  const pipeline = (await ensureDefaultPipeline(orgId)) as { _id: unknown; stages: Array<{ _id: unknown; name: string; order: number; isWon?: boolean; isLost?: boolean }> };
  pipelineId = String(pipeline._id);
  stages = pipeline.stages.slice().sort((a, b) => a.order - b.order).map((s) => ({ _id: String(s._id), name: s.name, isWon: s.isWon, isLost: s.isLost }));

  // Customer portal users: a buyer at Acme (respond allowed), a viewer at Acme, and someone at Globex.
  const [buyerRole, viewerRole] = await CustomerRole.create([
    { customerOrgId: co._id, name: 'Buyer', permissions: ['customer.quote.quote.list', 'customer.quote.quote.respond'] },
    { customerOrgId: co._id, name: 'Viewer', permissions: ['customer.quote.quote.list'] },
  ]);
  const globexRole = await CustomerRole.create({ customerOrgId: other._id, name: 'Buyer', permissions: ['customer.quote.quote.list', 'customer.quote.quote.respond'] });
  for (const [name, orgRef, role] of [['buyer', co._id, buyerRole._id], ['viewer', co._id, viewerRole._id], ['globex', other._id, globexRole._id]] as const) {
    const cu = await CustomerUser.create({ customerOrgId: orgRef, name, email: `${name}@cust.test`, password: 'Passw0rd!x', roleId: role, status: 'active' });
    tokens[name] = jwt.sign({ sub: String(cu._id), userType: 'customer', type: 'access' }, env.jwtSecret, { expiresIn: '1h' });
  }
});

const openStages = () => stages.filter((s) => !s.isWon && !s.isLost);
const wonStage = () => stages.find((s) => s.isWon)!;
const lostStage = () => stages.find((s) => s.isLost)!;

async function newDeal() {
  const d = await CrmDeal.create({ taskflowOrganizationId: orgOid, customerOrgId, pipelineId, stageId: openStages()[0]._id, title: 'Acme portal', value: 1000, probability: 10, status: 'open', ownerId: ids.rep });
  return String(d._id);
}
async function sentQuote(dealId: string, extra: Record<string, unknown> = {}) {
  const q = await createQuote(orgId, { dealId, title: 'Acme portal build', issueDate: '2026-11-01', lineItems: [{ description: 'Build', quantity: 10, unitPrice: 100 }], ...extra }, ids.rep);
  const id = String((q as { _id: unknown })._id);
  await CrmQuote.updateOne({ _id: id }, { $set: { status: 'sent', customerOrgId } });
  return id;
}
const dealOf = (id: string) => CrmDeal.findById(id).lean();

describe('quote acceptance and deal stage rules (AUT-32)', () => {
  it('accepting a quote moves its deal to Won through the usual steps', async () => {
    const dealId = await newDeal();
    const quoteId = await sentQuote(dealId);
    const res = await call(as('rep'), 'PATCH', `/crm/quotes/${quoteId}`, { status: 'accepted' });
    expect(res.status).toBe(200);
    const deal = (await dealOf(dealId))!;
    expect(deal.status).toBe('won');
    expect(String(deal.stageId)).toBe(wonStage()._id);
    expect(deal.probability).toBe(100);
    expect(accrue).toHaveBeenCalledWith(dealId);
    expect((await CrmQuote.findById(quoteId).lean())!.response).toMatchObject({ decision: 'accepted', via: 'staff' });
  });

  it('creating a project from an open deal wins it the same way, commission included (AUT-51)', async () => {
    const dealId = await newDeal();
    const res = await call(as('rep'), 'POST', `/crm/deals/${dealId}/create-project`, { name: 'Acme', key: 'ACME', leadId: ids.rep });
    expect(res.status).toBe(201);
    const deal = (await dealOf(dealId))!;
    expect(deal.status).toBe('won');
    expect(String(deal.stageId)).toBe(wonStage()._id);
    expect(accrue).toHaveBeenCalledWith(dealId);
  });

  it('a lost deal must say why, whichever way it is lost', async () => {
    const a = await newDeal();
    expect((await call(as('rep'), 'POST', `/crm/deals/${a}/move-stage`, { stageId: lostStage()._id })).status).toBe(400);
    expect((await call(as('rep'), 'PATCH', `/crm/deals/${a}`, { status: 'lost' })).status).toBe(400);
    expect((await dealOf(a))!.status).toBe('open');
    const ok = await call(as('rep'), 'POST', `/crm/deals/${a}/move-stage`, { stageId: lostStage()._id, lossReason: 'Price' });
    expect(ok.status).toBe(200);
    expect((await dealOf(a))!).toMatchObject({ status: 'lost', lossReason: 'Price', probability: 0 });
    // The reason can't be cleared while the deal stays lost.
    expect((await call(as('rep'), 'PATCH', `/crm/deals/${a}`, { lossReason: '' })).status).toBe(400);

    const b = await newDeal();
    const viaStatus = await call(as('rep'), 'PATCH', `/crm/deals/${b}`, { status: 'lost', lossReason: 'Timing' });
    expect(viaStatus.status).toBe(200);
    expect(String((await dealOf(b))!.stageId)).toBe(lostStage()._id);
  });

  it('an unqualified lead must say why; automated capture records a reason itself', async () => {
    const lead = await CrmLead.create({ taskflowOrganizationId: orgOid, title: 'Spam?', source: 'website', status: 'new', assigneeId: ids.rep });
    expect((await call(as('rep'), 'PATCH', `/crm/leads/${lead._id}`, { status: 'unqualified' })).status).toBe(400);
    expect((await call(as('rep'), 'PATCH', `/crm/leads/${lead._id}`, { status: 'unqualified', disqualifyReason: 'No budget' })).status).toBe(200);
    expect((await CrmLead.findById(lead._id).lean())!.disqualifyReason).toBe('No budget');
    expect((await call(as('rep'), 'POST', '/crm/leads', { title: 'Bad fit', status: 'unqualified' })).status).toBe(400);
    // Older unqualified leads without a reason can still be edited.
    const legacy = await CrmLead.create({ taskflowOrganizationId: orgOid, title: 'Old', source: 'website', status: 'unqualified', assigneeId: ids.rep });
    expect((await call(as('rep'), 'PATCH', `/crm/leads/${legacy._id}`, { title: 'Old lead' })).status).toBe(200);
  });

  it('stage rules are configurable: no skipping, no moving back', async () => {
    expect((await call(as('rep'), 'PUT', '/crm/stage-rules', { leads: { allowSkip: false } })).status).toBe(403);
    const saved = await call(as('admin'), 'PUT', '/crm/stage-rules', { leads: { allowSkip: false, allowBack: false }, deals: { allowSkip: false, allowBack: false } });
    expect(saved.status).toBe(200);
    expect((await call(as('rep'), 'GET', '/crm/stage-rules')).body.data).toMatchObject({ leads: { allowSkip: false, allowBack: false }, deals: { allowSkip: false, allowBack: false } });

    const lead = await CrmLead.create({ taskflowOrganizationId: orgOid, title: 'Lead', source: 'website', status: 'new', assigneeId: ids.rep });
    const skip = await call(as('rep'), 'PATCH', `/crm/leads/${lead._id}`, { status: 'qualified' });
    expect(skip.status).toBe(400);
    expect(skip.body.message).toMatch(/one stage at a time/);
    expect((await call(as('rep'), 'PATCH', `/crm/leads/${lead._id}`, { status: 'contacted' })).status).toBe(200);
    expect((await call(as('rep'), 'PATCH', `/crm/leads/${lead._id}`, { status: 'new' })).status).toBe(400);
    // Parking in nurturing, and closing as unqualified, are always allowed.
    expect((await call(as('rep'), 'PATCH', `/crm/leads/${lead._id}`, { status: 'nurturing' })).status).toBe(200);
    expect((await call(as('rep'), 'PATCH', `/crm/leads/${lead._id}`, { status: 'unqualified', disqualifyReason: 'Went quiet' })).status).toBe(200);
    expect((await call(as('rep'), 'PATCH', `/crm/leads/${lead._id}`, { status: 'new' })).status).toBe(200);

    const dealId = await newDeal();
    const open = openStages();
    expect((await call(as('rep'), 'POST', `/crm/deals/${dealId}/move-stage`, { stageId: open[2]._id })).status).toBe(400);
    expect((await call(as('rep'), 'POST', `/crm/deals/${dealId}/move-stage`, { stageId: open[1]._id })).status).toBe(200);
    expect((await call(as('rep'), 'POST', `/crm/deals/${dealId}/move-stage`, { stageId: open[0]._id })).status).toBe(400);
    // Closing is allowed from any open stage; reopening counts as moving back.
    expect((await call(as('rep'), 'POST', `/crm/deals/${dealId}/move-stage`, { stageId: wonStage()._id })).status).toBe(200);
    expect((await call(as('rep'), 'PATCH', `/crm/deals/${dealId}`, { status: 'open' })).status).toBe(400);
  });

  it('the customer can accept from the emailed link, which wins the deal', async () => {
    const dealId = await newDeal();
    const quoteId = await sentQuote(dealId);
    const token = quoteResponseToken(quoteId);

    const view = await call(null, 'GET', `/public/quotes/${token}`);
    expect(view.status).toBe(200);
    expect(view.body.data).toMatchObject({ title: 'Acme portal build', company: 'Northwind Studio', customer: 'Acme', total: 1000, canRespond: true });
    expect(view.body.data).not.toHaveProperty('history');

    expect((await call(null, 'POST', `/public/quotes/${token}/respond`, { decision: 'accept' })).status).toBe(400); // name needed
    const res = await call(null, 'POST', `/public/quotes/${token}/respond`, { decision: 'accept', name: 'Omar', email: 'omar@acme.test' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'accepted', canRespond: false, response: { decision: 'accepted', via: 'link', name: 'Omar' } });
    expect((await dealOf(dealId))!.status).toBe('won');
    expect((await call(null, 'POST', `/public/quotes/${token}/respond`, { decision: 'reject', name: 'Omar', note: 'Changed mind' })).status).toBe(400);

    // Tampered or unrelated tokens are refused, and the token can't sign anyone in.
    expect((await call(null, 'GET', `/public/quotes/${token}x`)).status).toBe(404);
    expect((await call(token, 'GET', '/customer/quotes')).status).toBe(401);
  });

  it('rejecting online needs a reason and leaves the deal open; expired quotes cannot be answered', async () => {
    const dealId = await newDeal();
    const quoteId = await sentQuote(dealId);
    const token = quoteResponseToken(quoteId);
    expect((await call(null, 'POST', `/public/quotes/${token}/respond`, { decision: 'reject', name: 'Omar' })).status).toBe(400);
    const res = await call(null, 'POST', `/public/quotes/${token}/respond`, { decision: 'reject', name: 'Omar', note: 'Too expensive' });
    expect(res.status).toBe(200);
    expect((await CrmQuote.findById(quoteId).lean())!).toMatchObject({ status: 'rejected', response: { note: 'Too expensive', via: 'link' } });
    expect((await dealOf(dealId))!.status).toBe('open');

    const old = await sentQuote(dealId, { validUntil: '2026-11-02' });
    await CrmQuote.updateOne({ _id: old }, { $set: { validUntil: new Date('2020-01-01') } });
    const oldToken = quoteResponseToken(old);
    expect((await call(null, 'GET', `/public/quotes/${oldToken}`)).body.data.status).toBe('expired');
    expect((await call(null, 'POST', `/public/quotes/${oldToken}/respond`, { decision: 'accept', name: 'Omar' })).status).toBe(400);

    // Drafts are never shown to the customer.
    const draft = await createQuote(orgId, { dealId, title: 'Draft', issueDate: '2026-11-01', lineItems: [{ description: 'x', quantity: 1, unitPrice: 1 }] }, ids.rep);
    expect((await call(null, 'GET', `/public/quotes/${quoteResponseToken(String((draft as { _id: unknown })._id))}`)).status).toBe(404);
  });

  it('the customer can accept in the portal, within their own organisation and permissions', async () => {
    const dealId = await newDeal();
    const quoteId = await sentQuote(dealId);

    const list = await call(as('buyer'), 'GET', '/customer/quotes');
    expect(list.status).toBe(200);
    expect(list.body.data.map((q: { _id: string }) => q._id)).toEqual([quoteId]);
    expect((await call(as('globex'), 'GET', '/customer/quotes')).body.data).toHaveLength(0);
    expect((await call(as('globex'), 'POST', `/customer/quotes/${quoteId}/respond`, { decision: 'accept' })).status).toBe(404);
    expect((await call(as('viewer'), 'POST', `/customer/quotes/${quoteId}/respond`, { decision: 'accept' })).status).toBe(403);

    const res = await call(as('buyer'), 'POST', `/customer/quotes/${quoteId}/respond`, { decision: 'accept' });
    expect(res.status).toBe(200);
    expect((await CrmQuote.findById(quoteId).lean())!.response).toMatchObject({ decision: 'accepted', via: 'portal', name: 'buyer' });
    expect((await dealOf(dealId))!.status).toBe('won');
    void otherOrgId;
  });

  it('staff can fetch the customer link for a sent quote', async () => {
    const dealId = await newDeal();
    const quoteId = await sentQuote(dealId);
    const res = await call(as('rep'), 'GET', `/crm/quotes/${quoteId}/response-link`);
    expect(res.status).toBe(200);
    expect(res.body.data.url).toMatch(/\/quote\/[\w-]+\.[\w-]+\.[\w-]+$/);
  });
});
