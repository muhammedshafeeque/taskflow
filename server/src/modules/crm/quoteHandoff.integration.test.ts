import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { crmRoutes } from './crm.routes';
import { publicQuoteRoutes, quoteResponseToken } from './quotes/customerQuotes';
import { errorHandler } from '../../middleware/errorHandler';
import { Role } from '../roles/role.model';
import { User } from '../auth/user.model';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { createToken } from '../apiTokens/apiToken.service';
import { CustomerOrg } from '../customer-portal/customer-org/customerOrg.model';
import { BillingInvoice } from '../billing/models/billingInvoice.model';
import * as billingService from '../billing/billing.service';
import * as domainNotify from '../notifications/domainNotify';
import { flushAuditLogs } from '../auditLogs/logAudit';
import { CrmDeal } from './models/crmDeal.model';
import { CrmQuote } from './models/crmQuote.model';
import { CrmContract } from './models/crmContract.model';
import { ensureDefaultPipeline } from './pipelines/pipelines.service';
import { createQuote } from './quotes/quotes.service';
import * as commissions from './commissions/commissions';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';

jest.mock('../../services/email.service', () => new Proxy({}, { get: (_t, name) => (name === '__esModule' ? true : name === 'tfEmailWrap' ? (s: string) => s : jest.fn().mockResolvedValue(undefined)) }));
jest.mock('../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(120_000);

const C = TASK_FLOW_PERMISSIONS.TASKFLOW.CRM;
const QUOTES = [C.QUOTE.LIST, C.QUOTE.READ, C.QUOTE.CREATE, C.QUOTE.UPDATE, C.DEAL.READ, C.SCOPE.ALL];

let mongo: MongoMemoryServer;
let server: Server;
let base = '';
let orgId = '';
let orgOid: mongoose.Types.ObjectId;
let customerOrgId = '';
let pipeline: { _id: unknown; stages: Array<{ _id: unknown; order: number; isWon?: boolean; isLost?: boolean }> };
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};
let notify: jest.SpyInstance;

async function call(token: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
  app.use('/api/public/quotes', publicQuoteRoutes);
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
  jest.restoreAllMocks();
  await flushAuditLogs();
  await mongoose.connection.dropDatabase();
  // The duplicate guards are unique indexes: build them on the fresh database.
  await Promise.all([CrmContract.syncIndexes(), BillingInvoice.syncIndexes()]);
  jest.spyOn(commissions, 'accrueDealCommission').mockResolvedValue(undefined as never);
  notify = jest.spyOn(domainNotify, 'notifyUsers');
  const [rep, viewer] = await Role.create([
    { name: 'Sales', permissions: QUOTES },
    { name: 'Viewer', permissions: [C.QUOTE.LIST, C.QUOTE.READ] },
  ]);
  const owner = new mongoose.Types.ObjectId();
  const org = await Organization.create({ name: 'Co', slug: 'co', createdBy: owner });
  orgId = String(org._id);
  orgOid = org._id as mongoose.Types.ObjectId;
  for (const [name, role] of Object.entries({ rep, viewer })) {
    const u = await User.create({ email: `${name}@example.com`, name, password: 'Passw0rd!x', mustChangePassword: false, roleId: role._id });
    await OrganizationMember.create({ organization: org._id, user: u._id, role: 'org_member', status: 'active' });
    ids[name] = String(u._id);
    tokens[name] = (await createToken(ids[name], orgId, { name: 't' })).token;
  }
  const co = await CustomerOrg.create({ name: 'Acme', slug: 'acme', contactEmail: 'ops@acme.test', createdBy: owner, taskflowOrganizationId: org._id });
  customerOrgId = String(co._id);
  pipeline = (await ensureDefaultPipeline(orgId)) as typeof pipeline;
});

async function sentQuote() {
  const open = pipeline.stages.filter((s) => !s.isWon && !s.isLost).sort((a, b) => a.order - b.order);
  const deal = await CrmDeal.create({ taskflowOrganizationId: orgOid, customerOrgId, pipelineId: pipeline._id, stageId: open[0]._id, title: 'Acme', value: 1000, status: 'open', ownerId: ids.rep });
  const q = await createQuote(orgId, { dealId: String(deal._id), title: 'Acme build', issueDate: '2026-11-01', lineItems: [{ description: 'Build', quantity: 10, unitPrice: 100 }] }, ids.rep);
  const quoteId = String((q as { _id: unknown })._id);
  await CrmQuote.updateOne({ _id: quoteId }, { $set: { status: 'sent', customerOrgId } });
  return { quoteId, dealId: String(deal._id) };
}
const accept = (quoteId: string) => call(tokens.rep, 'PATCH', `/crm/quotes/${quoteId}`, { status: 'accepted' });
const retry = (quoteId: string, who = 'rep') => call(tokens[who], 'POST', `/crm/quotes/${quoteId}/handoff/retry`);
const counts = async (quoteId: string) => ({
  contracts: await CrmContract.countDocuments({ quoteId }),
  invoices: await BillingInvoice.countDocuments({ sourceQuoteId: quoteId }),
});

describe('accepted quote handoff (AUT-33)', () => {
  it('records every step when all goes well', async () => {
    const { quoteId, dealId } = await sentQuote();
    const res = await accept(quoteId);
    expect(res.status).toBe(200);
    expect(res.body.data.converted).toMatchObject({ status: 'done' });
    const q = (await CrmQuote.findById(quoteId).lean())!;
    expect(q.handoff).toMatchObject({ status: 'done', attempts: 1 });
    expect(q.handoff!.steps.map((s) => `${s.key}:${s.status}`)).toEqual(['account:done', 'contract:done', 'invoice:done', 'delivery:done', 'deal:done']);
    expect(await counts(quoteId)).toEqual({ contracts: 1, invoices: 1 });
    expect((await CrmDeal.findById(dealId).lean())!.status).toBe('won');
  });

  it('a failed step is shown, logged and told, and the retry finishes without duplicates', async () => {
    const { quoteId, dealId } = await sentQuote();
    jest.spyOn(billingService, 'nextInvoiceNumber').mockRejectedValueOnce(new Error('Invoice numbering is down'));
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await accept(quoteId);
    expect(res.status).toBe(200); // the customer did accept; the quote stays accepted
    expect(res.body.data.status).toBe('accepted');
    expect(res.body.data.converted).toMatchObject({ status: 'failed', failedStep: 'invoice', error: 'Invoice numbering is down' });
    const q = (await CrmQuote.findById(quoteId).lean())!;
    expect(q.handoff).toMatchObject({ status: 'failed', failedStep: 'invoice', error: 'Invoice numbering is down' });
    expect(q.handoff!.steps.map((s) => s.status)).toEqual(['done', 'done', 'failed']);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('failed at invoice'), expect.any(Error));
    expect(notify).toHaveBeenCalledWith(expect.anything(), 'crm_quote_handoff_failed', expect.objectContaining({ link: `/crm/quotes/${quoteId}` }));
    // Later steps did not run.
    expect((await CrmDeal.findById(dealId).lean())!.status).toBe('open');
    expect(await counts(quoteId)).toEqual({ contracts: 1, invoices: 0 });

    // Viewers can't retry; the person who can, can.
    expect((await retry(quoteId, 'viewer')).status).toBe(403);
    const again = await retry(quoteId);
    expect(again.status).toBe(200);
    expect(again.body.data.handoff.status).toBe('done');
    expect(await counts(quoteId)).toEqual({ contracts: 1, invoices: 1 });
    expect((await CrmQuote.findById(quoteId).lean())!.handoff).toMatchObject({ status: 'done', attempts: 2 });
    expect((await CrmDeal.findById(dealId).lean())!.status).toBe('won');

    // Nothing left to retry.
    expect((await retry(quoteId)).status).toBe(409);
  });

  it('a contract that fails is made once on retry, never twice', async () => {
    const { quoteId } = await sentQuote();
    jest.spyOn(CrmContract, 'create').mockRejectedValueOnce(new Error('Contracts store unavailable') as never);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await accept(quoteId)).body.data.converted).toMatchObject({ status: 'failed', failedStep: 'contract' });
    expect(await counts(quoteId)).toEqual({ contracts: 0, invoices: 0 });
    expect((await retry(quoteId)).body.data.handoff.status).toBe('done');
    expect((await retry(quoteId)).status).toBe(409);
    expect(await counts(quoteId)).toEqual({ contracts: 1, invoices: 1 });
    // The invoice belongs to that contract.
    const contract = (await CrmContract.findOne({ quoteId }).lean())!;
    expect(String((await BillingInvoice.findOne({ sourceQuoteId: quoteId }).lean())!.contractId)).toBe(String(contract._id));
  });

  it('a contract already made for the quote (e.g. by a parallel attempt) is reused', async () => {
    const { quoteId } = await sentQuote();
    const existing = await CrmContract.create({ taskflowOrganizationId: orgOid, quoteId, title: 'Acme build', startDate: new Date(), status: 'draft' });
    await expect(CrmContract.create({ taskflowOrganizationId: orgOid, quoteId, title: 'dupe', startDate: new Date() })).rejects.toMatchObject({ code: 11000 });
    await accept(quoteId);
    expect(await counts(quoteId)).toEqual({ contracts: 1, invoices: 1 });
    expect((await CrmQuote.findById(quoteId).lean())!.handoff!.steps.find((s) => s.key === 'contract')!.refId).toBe(String(existing._id));
  });

  it('a customer accepting online is not shown internal failures, but staff are told', async () => {
    const { quoteId } = await sentQuote();
    jest.spyOn(billingService, 'nextInvoiceNumber').mockRejectedValueOnce(new Error('Invoice numbering is down'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await call(null, 'POST', `/public/quotes/${quoteResponseToken(quoteId)}/respond`, { decision: 'accept', name: 'Omar' });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/numbering/);
    expect(res.body.data.status).toBe('accepted');
    expect((await CrmQuote.findById(quoteId).lean())!.handoff!.status).toBe('failed');
    expect(notify).toHaveBeenCalledWith(expect.anything(), 'crm_quote_handoff_failed', expect.anything());
  });

  it('only accepted quotes with a failed handoff can be retried', async () => {
    const { quoteId } = await sentQuote();
    expect((await retry(quoteId)).status).toBe(400);
    await accept(quoteId);
    expect((await retry(quoteId)).status).toBe(409);
  });
});
