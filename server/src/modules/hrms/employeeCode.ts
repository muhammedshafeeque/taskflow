import type mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { HrmsEmployee } from './models/hrmsEmployee.model';

const isDuplicate = (err: unknown) => (err as { code?: number }).code === 11000;

/** One above the highest EMP-#### in the workspace, so a gap left by a deletion never makes the next code clash. */
export async function nextEmployeeCode(orgOid: mongoose.Types.ObjectId): Promise<string> {
  const rows = await HrmsEmployee.find({ taskflowOrganizationId: orgOid, employeeCode: /^EMP-\d{1,9}$/ }).select('employeeCode').lean();
  const highest = rows.reduce((max, r) => Math.max(max, Number(r.employeeCode.slice(4))), 0);
  return `EMP-${String(highest + 1).padStart(4, '0')}`;
}

/** Create with the given code, or the next free one; two people adding employees at once both succeed. */
export async function createWithCode<T>(orgOid: mongoose.Types.ObjectId, givenCode: unknown, create: (code: string) => Promise<T>): Promise<T> {
  const given = String(givenCode ?? '').trim();
  for (let attempt = 1; ; attempt++) {
    try {
      return await create(given || (await nextEmployeeCode(orgOid)));
    } catch (err) {
      if (!isDuplicate(err)) throw err;
      if (given || attempt >= 10) throw new ApiError(409, 'Employee code already exists');
    }
  }
}
