/**
 * Quotation discount limits (AUT-31).
 *
 * A quote's discount is how far its total before tax sits below list price (quantity × unit price),
 * counting both line discounts and the quote-wide discount. Each person may quote up to their limit:
 * the highest limit among the rules matching their roles (including inherited roles and roles from
 * team/level access rules) and their employee level, else the workspace default. Admins are not
 * limited. A quote above the sender's limit cannot be sent or accepted until approved by someone
 * whose own limit covers it (or by the quote approval chain, when that is on).
 */
import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crmWorkspace';
import { CrmDiscountPolicy, type ICrmDiscountPolicy } from '../models/crmDiscountPolicy.model';
import { Role } from '../../roles/role.model';
import { User } from '../../auth/user.model';
import { OrganizationMember } from '../../organizations/organizationMember.model';
import { HrmsEmployee } from '../../hrms/models/hrmsEmployee.model';
import { ruleRolesByUser } from '../../auth/accessProfile';
import { logAudit } from '../../auditLogs/logAudit';

type Oid = mongoose.Types.ObjectId;
const round2 = (n: number) => Math.round(n * 100) / 100;
const oid = (v: unknown) => new mongoose.Types.ObjectId(String(v));

export type DiscountPolicyView = {
  enabled: boolean;
  defaultMaxPercent: number;
  roleLimits: Array<{ roleId: string; maxPercent: number }>;
  levelLimits: Array<{ level: string; maxPercent: number }>;
  updatedAt: Date | null;
};

function view(p: Partial<ICrmDiscountPolicy> | null): DiscountPolicyView {
  return {
    enabled: Boolean(p?.enabled),
    defaultMaxPercent: p?.defaultMaxPercent ?? 10,
    roleLimits: (p?.roleLimits ?? []).map((r) => ({ roleId: String(r.roleId), maxPercent: r.maxPercent })),
    levelLimits: (p?.levelLimits ?? []).map((l) => ({ level: l.level, maxPercent: l.maxPercent })),
    updatedAt: p?.updatedAt ?? null,
  };
}

export async function getDiscountPolicy(orgId: string): Promise<DiscountPolicyView> {
  return view(await CrmDiscountPolicy.findOne({ taskflowOrganizationId: toOrgOid(orgId) }).lean());
}

function parsePercent(raw: unknown, where: string): number {
  const n = Number(raw);
  if (raw === '' || raw === null || raw === undefined || !Number.isFinite(n) || n < 0 || n > 100) {
    throw new ApiError(400, `${where}: enter a percentage from 0 to 100`);
  }
  return round2(n);
}

export async function saveDiscountPolicy(workspaceId: string | null | undefined, input: Record<string, unknown>, actorUserId: string) {
  const orgId = requireWorkspaceId(workspaceId);
  const $set: Record<string, unknown> = { updatedBy: oid(actorUserId) };
  if (input.enabled !== undefined) $set.enabled = Boolean(input.enabled);
  if (input.defaultMaxPercent !== undefined) $set.defaultMaxPercent = parsePercent(input.defaultMaxPercent, 'Default limit');
  if (input.roleLimits !== undefined) {
    if (!Array.isArray(input.roleLimits)) throw new ApiError(400, 'roleLimits must be a list');
    const seen = new Set<string>();
    const rows = input.roleLimits.map((r, i) => {
      const row = (r ?? {}) as Record<string, unknown>;
      const roleId = String(row.roleId ?? '');
      if (!mongoose.isValidObjectId(roleId)) throw new ApiError(400, `Role limit ${i + 1}: choose a role`);
      if (seen.has(roleId)) throw new ApiError(400, `Role limit ${i + 1}: that role already has a limit`);
      seen.add(roleId);
      return { roleId: oid(roleId), maxPercent: parsePercent(row.maxPercent, `Role limit ${i + 1}`) };
    });
    const found = await Role.countDocuments({ _id: { $in: rows.map((r) => r.roleId) } });
    if (found !== rows.length) throw new ApiError(400, 'One of the roles no longer exists');
    $set.roleLimits = rows;
  }
  if (input.levelLimits !== undefined) {
    if (!Array.isArray(input.levelLimits)) throw new ApiError(400, 'levelLimits must be a list');
    const seen = new Set<string>();
    $set.levelLimits = input.levelLimits.map((r, i) => {
      const row = (r ?? {}) as Record<string, unknown>;
      const level = String(row.level ?? '').trim();
      if (!level) throw new ApiError(400, `Level limit ${i + 1}: choose a level`);
      if (seen.has(level.toLowerCase())) throw new ApiError(400, `Level limit ${i + 1}: that level already has a limit`);
      seen.add(level.toLowerCase());
      return { level: level.slice(0, 60), maxPercent: parsePercent(row.maxPercent, `Level limit ${i + 1}`) };
    });
  }
  await CrmDiscountPolicy.updateOne(
    { taskflowOrganizationId: toOrgOid(orgId) },
    { $set, $setOnInsert: { taskflowOrganizationId: toOrgOid(orgId) } },
    { upsert: true }
  );
  logAudit({ userId: actorUserId, action: 'crm.discount_policy.update', resourceType: 'crm_discount_policy', resourceId: orgId, meta: { enabled: $set.enabled } });
  return getDiscountPolicy(orgId);
}

/** Discount of a quote in percent of list price, before tax. */
export function quoteDiscountPercent(quote: {
  lineItems?: Array<{ quantity?: number; unitPrice?: number }>;
  subtotal?: number;
  discountAmount?: number;
}): number {
  const gross = (quote.lineItems ?? []).reduce((s, l) => s + (Number(l.quantity ?? 1) || 0) * (Number(l.unitPrice ?? 0) || 0), 0);
  if (gross <= 0) return 0;
  const net = (Number(quote.subtotal) || 0) - (Number(quote.discountAmount) || 0);
  return Math.max(0, round2(((gross - net) / gross) * 100));
}

/** Role ids a person holds: their role, the roles it builds on, and roles from team/level rules. */
async function roleTreeIds(direct: Array<string | null | undefined>): Promise<Set<string>> {
  const seen = new Set<string>();
  let frontier = direct.filter((x): x is string => Boolean(x) && mongoose.isValidObjectId(x));
  for (let depth = 0; frontier.length && depth < 10; depth++) {
    const ids = frontier.filter((id) => !seen.has(id));
    ids.forEach((id) => seen.add(id));
    if (!ids.length) break;
    const roles = await Role.find({ _id: { $in: ids } }).select('inherits').lean();
    frontier = roles.flatMap((r) => ((r as { inherits?: unknown[] }).inherits ?? []).map(String));
  }
  return seen;
}

/**
 * Discount limits for these people. `null` = not limited (limits off, or a platform admin).
 */
export async function discountLimitsFor(orgId: string, userIds: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const ids = [...new Set(userIds.filter((u) => mongoose.isValidObjectId(u)))];
  if (!ids.length) return out;
  const policy = await getDiscountPolicy(orgId);
  if (!policy.enabled) {
    ids.forEach((u) => out.set(u, null));
    return out;
  }
  const orgOid: Oid = toOrgOid(orgId);
  const [users, ruleRoles, employees] = await Promise.all([
    User.find({ _id: { $in: ids.map(oid) } }).select('role roleId').lean(),
    ruleRolesByUser(orgOid, ids),
    HrmsEmployee.find({ taskflowOrganizationId: orgOid, userId: { $in: ids.map(oid) }, status: { $ne: 'terminated' } }).select('userId level').lean(),
  ]);
  const levelOf = new Map(employees.map((e) => [String(e.userId), (e.level ?? '').toLowerCase()]));
  const roleLimit = new Map(policy.roleLimits.map((r) => [r.roleId, r.maxPercent]));
  const levelLimit = new Map(policy.levelLimits.map((l) => [l.level.toLowerCase(), l.maxPercent]));
  for (const u of users) {
    const id = String(u._id);
    if (u.role === 'admin') {
      out.set(id, null);
      continue;
    }
    const roles = await roleTreeIds([u.roleId ? String(u.roleId) : null, ...(ruleRoles.get(id) ?? [])]);
    const matches = [...roles].map((r) => roleLimit.get(r)).filter((n): n is number => n != null);
    const lvl = levelOf.get(id);
    if (lvl && levelLimit.has(lvl)) matches.push(levelLimit.get(lvl)!);
    out.set(id, matches.length ? Math.max(...matches) : policy.defaultMaxPercent);
  }
  return out;
}

export async function discountLimitFor(orgId: string, userId: string): Promise<number | null> {
  const limits = await discountLimitsFor(orgId, [userId]);
  // null means "not limited"; only an unknown person falls back to the default.
  return limits.has(userId) ? limits.get(userId)! : (await getDiscountPolicy(orgId)).defaultMaxPercent;
}

/** Active workspace members whose limit covers this discount (approvers for a discount step). */
export async function usersWhoseLimitCovers(orgId: string, discountPercent: number): Promise<string[]> {
  const members = (await OrganizationMember.find({ organization: toOrgOid(orgId), status: 'active' }).distinct('user')).map(String);
  const limits = await discountLimitsFor(orgId, members);
  return members.filter((u) => {
    const limit = limits.get(u);
    return limit === null || (limit !== undefined && limit >= discountPercent);
  });
}

/** Above the person's limit? Returns the numbers when it is, else null. */
export async function overDiscountLimit(
  orgId: string,
  userId: string,
  quote: Parameters<typeof quoteDiscountPercent>[0]
): Promise<{ discountPercent: number; limit: number } | null> {
  const discountPercent = quoteDiscountPercent(quote);
  if (discountPercent <= 0) return null;
  const limit = await discountLimitFor(orgId, userId);
  if (limit === null || discountPercent <= limit) return null;
  return { discountPercent, limit };
}
