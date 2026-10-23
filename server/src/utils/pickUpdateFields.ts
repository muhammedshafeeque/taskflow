/**
 * Strip tenant / ownership fields that clients must never mass-assign.
 */
const FORBIDDEN_UPDATE_KEYS = new Set([
  '_id',
  'id',
  'taskflowOrganizationId',
  'organizationId',
  'authorId',
  'createdBy',
  'createdAt',
  'updatedAt',
  '__v',
]);

export function pickUpdateFields(
  input: Record<string, unknown>,
  allowed: readonly string[]
): Record<string, unknown> {
  const allow = new Set(allowed);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (FORBIDDEN_UPDATE_KEYS.has(key)) continue;
    if (!allow.has(key)) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}
