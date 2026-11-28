import type mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsSettings } from './models/hrmsPolicy.model';

const isDuplicate = (err: unknown) => (err as { code?: number }).code === 11000;

export const DEFAULT_CODE_PREFIX = 'EMP-';
export const DEFAULT_CODE_DIGITS = 4;
/** Letters, digits and - _ / . only, so a code stays readable and safe in file names and URLs. */
export const CODE_PREFIX_PATTERN = /^[A-Za-z0-9\-_/.]{0,20}$/;
const MAX_NUMBER = 999_999_999;

type CodeFormat = { prefix: string; digits: number };

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

export function formatEmployeeCode(n: number, f: CodeFormat): string {
  return `${f.prefix}${String(n).padStart(f.digits, '0')}`;
}

function formatOf(s: { employeeCodePrefix?: string | null; employeeCodeDigits?: number | null } | null): CodeFormat {
  return {
    prefix: typeof s?.employeeCodePrefix === 'string' ? s.employeeCodePrefix : DEFAULT_CODE_PREFIX,
    digits: s?.employeeCodeDigits && s.employeeCodeDigits >= 1 && s.employeeCodeDigits <= 9 ? s.employeeCodeDigits : DEFAULT_CODE_DIGITS,
  };
}

/** Highest number already used by a code in this format, e.g. 12 for EMP-0012 (0 when none). */
async function highestUsed(orgOid: mongoose.Types.ObjectId, prefix: string): Promise<number> {
  const re = new RegExp(`^${escapeRegex(prefix)}(\\d{1,9})$`);
  const rows = await HrmsEmployee.find({ taskflowOrganizationId: orgOid, employeeCode: re }).select('employeeCode').lean();
  return rows.reduce((max, r) => Math.max(max, Number(re.exec(r.employeeCode)?.[1] ?? 0)), 0);
}

/**
 * Make sure the workspace has a code counter. A workspace that had none starts after the highest code
 * already in use, so codes made before the counter existed are never handed out again.
 */
async function ensureCounter(orgOid: mongoose.Types.ObjectId) {
  let settings = await HrmsSettings.findOne({ taskflowOrganizationId: orgOid }).lean();
  if (settings?.employeeCodeLastNumber != null) return settings;
  const highest = await highestUsed(orgOid, formatOf(settings).prefix);
  try {
    await HrmsSettings.updateOne({ taskflowOrganizationId: orgOid }, { $setOnInsert: { taskflowOrganizationId: orgOid } }, { upsert: true });
  } catch (err) {
    if (!isDuplicate(err)) throw err; // someone else created the settings at the same moment
  }
  // Only the first to get here seeds it; anyone racing sees it already set.
  await HrmsSettings.updateOne({ taskflowOrganizationId: orgOid, employeeCodeLastNumber: null }, { $set: { employeeCodeLastNumber: highest } });
  settings = await HrmsSettings.findOne({ taskflowOrganizationId: orgOid }).lean();
  return settings!;
}

/** Take the next number from the workspace counter. A number is never given out twice, even after a deletion. */
export async function nextEmployeeCode(orgOid: mongoose.Types.ObjectId): Promise<string> {
  await ensureCounter(orgOid);
  const s = await HrmsSettings.findOneAndUpdate({ taskflowOrganizationId: orgOid }, { $inc: { employeeCodeLastNumber: 1 } }, { new: true }).lean();
  return formatEmployeeCode(s!.employeeCodeLastNumber!, formatOf(s));
}

/** What the next automatic code will be, and the number it uses, for HR settings. */
export async function employeeCodeSettings(orgOid: mongoose.Types.ObjectId) {
  const s = await ensureCounter(orgOid);
  const nextNumber = (s.employeeCodeLastNumber ?? 0) + 1;
  return { employeeCodeNextNumber: nextNumber, employeeCodePreview: formatEmployeeCode(nextNumber, formatOf(s)) };
}

/** Move the counter forward so the next code uses `next`. It cannot go back, because those numbers may have been used. */
export async function setNextEmployeeNumber(orgOid: mongoose.Types.ObjectId, next: unknown) {
  const n = Number(next);
  if (!Number.isInteger(n) || n < 1 || n > MAX_NUMBER) throw new ApiError(400, 'Next employee number must be a whole number from 1');
  const s = await ensureCounter(orgOid);
  const current = (s.employeeCodeLastNumber ?? 0) + 1;
  if (n === current) return;
  if (n < current) throw new ApiError(400, `Next employee number cannot go below ${current}, because lower numbers may already have been used`);
  // $max keeps this safe if a code was taken while the form was open.
  await HrmsSettings.updateOne({ taskflowOrganizationId: orgOid }, { $max: { employeeCodeLastNumber: n - 1 } });
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
      // Someone typed a code the counter had not reached yet: jump past every code already in use.
      const s = await HrmsSettings.findOne({ taskflowOrganizationId: orgOid }).lean();
      const highest = await highestUsed(orgOid, formatOf(s).prefix);
      await HrmsSettings.updateOne({ taskflowOrganizationId: orgOid }, { $max: { employeeCodeLastNumber: highest } });
    }
  }
}
