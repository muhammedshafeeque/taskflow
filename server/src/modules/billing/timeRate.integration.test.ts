import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createInvoiceFromTime, getUnbilledTimeSummary, getBillingDashboard, getBillingSettings, updateBillingSettings } from './billing.service';
import { resolveProjectHourlyRate } from '../crm/commercialHandoff.service';
import { BillingInvoice } from './models/billingInvoice.model';
import { BillingSettings } from './models/billingSettings.model';
import { Project } from '../projects/project.model';
import { Issue } from '../issues/issue.model';
import { WorkLog } from '../workLogs/workLog.model';
import { CrmAccount } from '../crm/models/crmAccount.model';
import { CrmContract } from '../crm/models/crmContract.model';
import { CrmQuote } from '../crm/models/crmQuote.model';

jest.mock('../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(120_000);

const orgOid = new mongoose.Types.ObjectId();
const org = String(orgOid);
const user = new mongoose.Types.ObjectId();
let mongo: MongoMemoryServer;
let accountId = '';

/** A project with `hours` of unbilled, billable time logged yesterday. */
async function projectWithTime(key: string, hours = 10) {
  const p = await Project.create({ name: `Project ${key}`, key, lead: user, taskflowOrganizationId: orgOid, crmAccountId: accountId });
  const issue = await Issue.create({ title: 'Work', reporter: user, project: p._id });
  await WorkLog.create({ issue: issue._id, author: user, minutesSpent: hours * 60, date: new Date(Date.now() - 86_400_000) });
  return String(p._id);
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  accountId = String((await CrmAccount.create({ taskflowOrganizationId: orgOid, name: 'Northwind' }))._id);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('hourly rate for time to invoice (AUT-42)', () => {
  it('has no built-in rate: a project without contract, quote or default rate has none', async () => {
    const p = await projectWithTime('NONE');
    expect(await resolveProjectHourlyRate(org, p)).toEqual({ rate: null, source: null });
  });

  it('uses the contract rate, then the accepted quote, then the workspace default', async () => {
    const p = await projectWithTime('SRC');
    await updateBillingSettings(org, { defaultHourlyRate: 80 });
    expect(await resolveProjectHourlyRate(org, p)).toEqual({ rate: 80, source: 'default' });
    await CrmQuote.create({
      taskflowOrganizationId: orgOid, projectId: p, title: 'Q', status: 'accepted', version: 1, subtotal: 0, total: 0, currency: 'USD', createdBy: user,
      lineItems: [{ description: 'Dev', quantity: 10, unitPrice: 120, billingType: 'hourly' }],
    });
    expect(await resolveProjectHourlyRate(org, p)).toEqual({ rate: 120, source: 'quote' });
    await CrmContract.create({ taskflowOrganizationId: orgOid, projectId: p, title: 'C', startDate: new Date(), status: 'active', hourlyRate: 150 });
    expect(await resolveProjectHourlyRate(org, p)).toEqual({ rate: 150, source: 'contract' });
  });

  it('shows projects without a rate as missing one, and leaves their hours out of the estimate', async () => {
    const none = await projectWithTime('NONE', 4);
    const priced = await projectWithTime('PRICED', 10);
    await CrmContract.create({ taskflowOrganizationId: orgOid, projectId: priced, title: 'C', startDate: new Date(), status: 'active', hourlyRate: 50 });
    const s = await getUnbilledTimeSummary(org);
    expect(s).toMatchObject({ totalHours: 14, estimatedValue: 500, defaultRate: null, projectsWithoutRate: 1, hoursWithoutRate: 4 });
    expect(s.projects.find((p) => p.projectId === none)).toMatchObject({ rate: null, rateMissing: true, estimatedValue: null, rateSource: null });
    expect(s.projects.find((p) => p.projectId === priced)).toMatchObject({ rate: 50, rateMissing: false, estimatedValue: 500, rateSource: 'contract' });
    const dash = await getBillingDashboard(org);
    expect(dash).toMatchObject({ unbilledValue: 500, unbilledHoursWithoutRate: 4 });
    expect(dash.counts.unbilledProjectsWithoutRate).toBe(1);
  });

  it('refuses to invoice time without a rate, instead of billing 100 an hour', async () => {
    const p = await projectWithTime('NONE');
    await expect(createInvoiceFromTime(org, { accountId, projectId: p, hours: 10 })).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/no hourly rate/i) });
    for (const rate of [0, -5, 'abc']) {
      await expect(createInvoiceFromTime(org, { accountId, projectId: p, hours: 10, rate: rate as number })).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(await BillingInvoice.countDocuments()).toBe(0);
  });

  it('invoices at a rate entered for the invoice, or at the default once one is set', async () => {
    const p = await projectWithTime('NONE');
    const typed = await createInvoiceFromTime(org, { accountId, projectId: p, hours: 2, rate: 90 });
    expect(typed!.lines[0]).toMatchObject({ quantity: 2, unitPrice: 90 });
    await updateBillingSettings(org, { defaultHourlyRate: 75 });
    const byDefault = await createInvoiceFromTime(org, { accountId, projectId: p, hours: 3 });
    expect(byDefault!.lines[0]).toMatchObject({ quantity: 3, unitPrice: 75 });
  });

  it('the default rate is optional and must be positive', async () => {
    expect(await getBillingSettings(org)).toEqual({ defaultHourlyRate: null });
    expect(await updateBillingSettings(org, { defaultHourlyRate: '99.999' })).toEqual({ defaultHourlyRate: 100 });
    for (const bad of [0, -1, 'x']) await expect(updateBillingSettings(org, { defaultHourlyRate: bad })).rejects.toMatchObject({ statusCode: 400 });
    expect(await updateBillingSettings(org, { defaultHourlyRate: '' })).toEqual({ defaultHourlyRate: null });
    expect(await BillingSettings.countDocuments()).toBe(1);
  });
});
