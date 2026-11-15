/** The quotation issue date is the date the user picks — never the day the quote record was created. */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createQuote, updateQuote, sendQuote } from './quotes.service';
import { CrmQuote } from '../models/crmQuote.model';
import { CrmLead } from '../models/crmLead.model';

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const ws = new mongoose.Types.ObjectId().toString();
const user = new mongoose.Types.ObjectId().toString();
const lines = [{ description: 'Design', quantity: 1, unitPrice: 100, billingType: 'fixed' }];
let leadId = '';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  leadId = String((await CrmLead.create({ taskflowOrganizationId: ws, title: 'Website' }))._id);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

const day = (d: unknown) => new Date(d as string).toISOString().slice(0, 10);

describe('quote issue date', () => {
  it('requires the user to choose it', async () => {
    await expect(createQuote(ws, { title: 'Q', leadId, lineItems: lines }, user)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/issue date/i),
    });
    await expect(createQuote(ws, { title: 'Q', leadId, lineItems: lines, issueDate: '' }, user)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('keeps the chosen day, not the creation day', async () => {
    const q = (await createQuote(ws, { title: 'Q', leadId, lineItems: lines, issueDate: '2026-01-05', validUntil: '2026-02-04' }, user)) as { _id: unknown; issueDate: Date };
    expect(day(q.issueDate)).toBe('2026-01-05');

    const updated = (await updateQuote(String(q._id), ws, { issueDate: '2026-01-10' }, user)) as { issueDate: Date };
    expect(day(updated.issueDate)).toBe('2026-01-10');

    // Clearing it is refused rather than falling back to the creation date.
    await expect(updateQuote(String(q._id), ws, { issueDate: '' }, user)).rejects.toMatchObject({ statusCode: 400 });
    expect(day((await CrmQuote.findById(q._id).lean())!.issueDate)).toBe('2026-01-10');
  });

  it('refuses a validity date before the issue date', async () => {
    await expect(
      createQuote(ws, { title: 'Q', leadId, lineItems: lines, issueDate: '2026-03-10', validUntil: '2026-03-01' }, user)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('will not email a quote without an issue date', async () => {
    const legacy = await CrmQuote.create({
      taskflowOrganizationId: new mongoose.Types.ObjectId(ws),
      title: 'Old quote',
      status: 'draft',
      version: 1,
      lineItems: [],
      subtotal: 0,
      total: 0,
      currency: 'USD',
      createdBy: new mongoose.Types.ObjectId(user),
    });
    await expect(sendQuote(String(legacy._id), ws, 'client@example.com')).rejects.toMatchObject({ statusCode: 400 });
  });
});
