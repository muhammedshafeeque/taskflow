/** Who may see and set what people are paid. */
import { ApiError } from '../../utils/ApiError';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { payAccessOf, type PayAccess } from '../../shared/constants/payAccess';

export { payAccessOf, type PayAccess };

/** Pay-sensitive employee fields, and what it takes to see / set each. Notes often hold pay and conduct remarks. */
const FIELDS: Record<string, { see: keyof PayAccess; set: keyof PayAccess }> = {
  annualCtc: { see: 'see', set: 'set' },
  notes: { see: 'see', set: 'set' },
  hourlyCostRate: { see: 'seeRate', set: 'setRate' },
};

export function payAccessFor(permissions: string[]): PayAccess {
  return payAccessOf((p) => userHasPermission(permissions, p));
}

/** A copy of an employee record without the fields the viewer may not see. */
export function withoutPay<T extends object>(employee: T, access: PayAccess): T {
  const out = { ...employee } as Record<string, unknown>;
  for (const [field, rule] of Object.entries(FIELDS)) if (!access[rule.see]) delete out[field];
  return out as T;
}

/**
 * Refuses any attempt to set a field the person may not set. Presence alone decides: comparing with the stored
 * value would let someone find a hidden salary by guessing.
 */
export function assertCanSetPay(input: Record<string, unknown>, access: PayAccess): void {
  const blocked = Object.keys(FIELDS).filter((f) => input[f] !== undefined && !access[FIELDS[f].set]);
  if (blocked.length > 0) throw new ApiError(403, `You do not have permission to set: ${blocked.join(', ')}`);
}
