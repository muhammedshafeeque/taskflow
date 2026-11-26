import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createEmployee, updateEmployee } from './hrms.service';
import { HrmsEmployee } from './models/hrmsEmployee.model';

jest.mock('../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(120_000);

const org = String(new mongoose.Types.ObjectId());
const HR = ['taskflow.hr.employee.create', 'taskflow.hr.employee.update', 'taskflow.hr.salary.manage', 'taskflow.hr.cost_rate.manage'];
const actor = { id: String(new mongoose.Types.ObjectId()), role: 'user', permissions: HR };
let mongo: MongoMemoryServer;
const add = (extra: Record<string, unknown>) => createEmployee(org, { name: 'Dev', ...extra }, HR);
const stored = async (id: unknown) => (await HrmsEmployee.findById(id).lean())!;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
beforeEach(() => HrmsEmployee.deleteMany({}));
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('hourly cost on Add employee (AUT-16)', () => {
  it('is saved', async () => {
    const e = await add({ hourlyCostRate: 42.5, annualCtc: 1200 });
    expect(e.hourlyCostRate).toBe(42.5);
    expect(await stored(e._id)).toMatchObject({ hourlyCostRate: 42.5, annualCtc: 1200 });
  });

  it('is left empty when blank, so it is worked out from CTC', async () => {
    for (const hourlyCostRate of [null, '']) expect((await stored((await add({ hourlyCostRate }))._id)).hourlyCostRate).toBeUndefined();
  });

  it('can be set, changed and cleared afterwards', async () => {
    const e = await add({});
    expect((await updateEmployee(String(e._id), org, { hourlyCostRate: '30' }, actor)).hourlyCostRate).toBe(30);
    expect((await stored(e._id)).hourlyCostRate).toBe(30);
    await updateEmployee(String(e._id), org, { hourlyCostRate: null }, actor);
    expect((await stored(e._id)).hourlyCostRate).toBeUndefined();
  });

  it('refuses amounts that are not numbers or below zero, instead of saving 0 or failing', async () => {
    const e = await add({ hourlyCostRate: 10 });
    for (const bad of [{ hourlyCostRate: 'ten' }, { hourlyCostRate: -1 }, { annualCtc: 'lots' }, { annualCtc: -5 }, { leaveBalanceDays: 'x' }]) {
      await expect(add(bad)).rejects.toMatchObject({ statusCode: 400 });
      await expect(updateEmployee(String(e._id), org, bad, actor)).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(await stored(e._id)).toMatchObject({ hourlyCostRate: 10, annualCtc: 0, leaveBalanceDays: 20 });
    expect(await HrmsEmployee.countDocuments()).toBe(1);
  });
});
