/**
 * What someone may do: their role (and the roles it builds on), plus the roles their team and level bring in this
 * workspace (access rules), plus personal grants, minus personal revokes. Administrators hold everything.
 */
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { Role } from '../roles/role.model';
import { AccessRule } from '../roles/accessRule.model';
import { ResourceTeam } from '../resources/models/resourceTeam.model';
import { HrmsEmployee } from '../hrms/models/hrmsEmployee.model';
import { resolveEffectiveGlobalPermissions } from './effectivePermissions';
import { mergeTaskflowPermissionFloor } from './permissionMerge';
import { assertCanAssignRole, assertCanGrant, type GrantActor } from './grantGuard';

type Id = mongoose.Types.ObjectId | string;
const MAX_DEPTH = 10;

// ── Role inheritance ─────────────────────────────────────────────────────

/** Permissions of these roles and every role they build on, however deep (loops are ignored). */
export async function roleTreePermissions(roleIds: Array<Id | null | undefined>): Promise<string[]> {
  const perms = new Set<string>();
  const seen = new Set<string>();
  let frontier = roleIds.filter(Boolean).map(String);
  for (let depth = 0; frontier.length && depth < MAX_DEPTH; depth++) {
    const ids = frontier.filter((id) => !seen.has(id) && mongoose.isValidObjectId(id));
    ids.forEach((id) => seen.add(id));
    if (!ids.length) break;
    const roles = await Role.find({ _id: { $in: ids } }).select('permissions inherits').lean();
    for (const r of roles) (r.permissions ?? []).forEach((p: string) => perms.add(p));
    frontier = roles.flatMap((r) => (r.inherits ?? []).map(String));
  }
  return [...perms];
}

/** A role may build on others, but never (however indirectly) on itself, and only on roles that exist. */
export async function assertValidInherits(roleId: Id | null, inherits: unknown): Promise<mongoose.Types.ObjectId[]> {
  if (!Array.isArray(inherits)) throw new ApiError(400, 'inherits must be a list of roles');
  const ids = [...new Set(inherits.map(String))];
  if (ids.some((id) => !mongoose.isValidObjectId(id))) throw new ApiError(400, 'Unknown role in inherits');
  if (roleId && ids.includes(String(roleId))) throw new ApiError(400, 'A role cannot build on itself');
  if ((await Role.countDocuments({ _id: { $in: ids } })) !== ids.length) throw new ApiError(400, 'Unknown role in inherits');
  if (roleId) {
    let frontier = ids;
    const seen = new Set<string>();
    for (let depth = 0; frontier.length && depth < MAX_DEPTH; depth++) {
      if (frontier.includes(String(roleId))) throw new ApiError(400, 'That would make roles build on each other in a loop');
      frontier.forEach((id) => seen.add(id));
      frontier = (await Role.find({ _id: { $in: frontier } }).select('inherits').lean()).flatMap((r) => (r.inherits ?? []).map(String)).filter((id) => !seen.has(id));
    }
  }
  return ids.map((id) => new mongoose.Types.ObjectId(id));
}

// ── Team and level rules ─────────────────────────────────────────────────

type RuleDoc = { _id: unknown; teamId?: unknown; level?: string | null; leadsOnly?: boolean; roleIds?: unknown[] };
const rulesCache = new Map<string, { at: number; rules: RuleDoc[] }>();
const CACHE_MS = 30_000;

export function forgetAccessRules(orgId?: Id): void {
  if (orgId) rulesCache.delete(String(orgId));
  else rulesCache.clear();
}

async function activeRules(orgId: Id): Promise<RuleDoc[]> {
  const key = String(orgId);
  const hit = rulesCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rules;
  const rules = await AccessRule.find({ taskflowOrganizationId: orgId, active: true }).select('teamId level leadsOnly roleIds').lean();
  rulesCache.set(key, { at: Date.now(), rules: rules as RuleDoc[] });
  return rules as RuleDoc[];
}

type Facts = { teams: Array<{ id: string; lead: boolean }>; level: string | null };

/** Whether a rule applies to someone with these teams and level. */
export function ruleMatches(rule: Pick<RuleDoc, 'teamId' | 'level' | 'leadsOnly'>, facts: Facts): boolean {
  const teams = rule.teamId ? facts.teams.filter((t) => t.id === String(rule.teamId)) : facts.teams;
  if ((rule.teamId || rule.leadsOnly) && teams.length === 0) return false;
  if (rule.leadsOnly && !teams.some((t) => t.lead)) return false;
  if (rule.level && rule.level.toLowerCase() !== (facts.level ?? '').toLowerCase()) return false;
  return Boolean(rule.teamId || rule.level || rule.leadsOnly);
}

/** For everyone in the workspace, or just these people: the roles their team and level bring. */
export async function ruleRolesByUser(orgId: Id, userIds?: string[], rules?: RuleDoc[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const list = rules ?? (await activeRules(orgId));
  if (!list.length) return out;
  const only = userIds?.map((u) => new mongoose.Types.ObjectId(u));
  const [teams, employees] = await Promise.all([
    ResourceTeam.find({ taskflowOrganizationId: orgId, ...(only ? { memberIds: { $in: only } } : {}) }).select('memberIds leadId').lean(),
    HrmsEmployee.find({ taskflowOrganizationId: orgId, userId: only ? { $in: only } : { $ne: null }, status: { $ne: 'terminated' } }).select('userId level').lean(),
  ]);
  const facts = new Map<string, Facts>();
  const get = (u: string) => facts.get(u) ?? facts.set(u, { teams: [], level: null }).get(u)!;
  for (const t of teams) for (const m of t.memberIds ?? []) get(String(m)).teams.push({ id: String(t._id), lead: String(t.leadId ?? '') === String(m) });
  for (const e of employees) if (e.userId && e.level) get(String(e.userId)).level = e.level;
  for (const [user, f] of facts) {
    if (only && !userIds!.includes(user)) continue;
    const roles = new Set(list.filter((r) => ruleMatches(r, f)).flatMap((r) => (r.roleIds ?? []).map(String)));
    if (roles.size) out.set(user, roles);
  }
  return out;
}

// ── Everything together ──────────────────────────────────────────────────

export type PermissionSubject = {
  _id: Id;
  role?: string;
  roleId?: unknown;
  mustChangePassword?: boolean;
  permissionOverrides?: { granted?: string[]; revoked?: string[] } | null;
};

const idOf = (v: unknown) => (v && typeof v === 'object' && '_id' in (v as object) ? (v as { _id: unknown })._id : v) as Id | null;

export async function permissionsFor(user: PermissionSubject, orgId?: Id | null): Promise<string[]> {
  const fromRules = orgId ? [...((await ruleRolesByUser(orgId, [String(user._id)])).get(String(user._id)) ?? [])] : [];
  return mergeTaskflowPermissionFloor(
    resolveEffectiveGlobalPermissions({
      rolePermissions: await roleTreePermissions([idOf(user.roleId), ...fromRules]),
      role: user.role === 'admin' ? 'admin' : 'user',
      mustChangePassword: user.mustChangePassword ?? false,
      permissionOverrides: user.permissionOverrides,
    })
  );
}

/**
 * Run a change that can move people into or out of rules (team members, lead, level, linking an account, the
 * rules themselves). Anyone who gains roles must be someone the actor may give them to — never the actor
 * themselves beyond their own rights. If not, the change is undone and refused.
 */
export async function withRuleGainCheck<T>(orgId: Id, actor: GrantActor, apply: () => Promise<T>, undo: () => Promise<unknown>): Promise<T> {
  const before = await ruleRolesByUser(orgId, undefined, await AccessRule.find({ taskflowOrganizationId: orgId, active: true }).lean() as RuleDoc[]);
  const result = await apply();
  forgetAccessRules(orgId);
  try {
    const after = await ruleRolesByUser(orgId, undefined, await AccessRule.find({ taskflowOrganizationId: orgId, active: true }).lean() as RuleDoc[]);
    for (const [user, roles] of after) {
      const gained = [...roles].filter((r) => !before.get(user)?.has(r));
      if (!gained.length) continue;
      const docs = await Role.find({ _id: { $in: gained } }).select('name permissions inherits').lean();
      for (const role of docs) {
        const permissions = await roleTreePermissions([role._id]);
        if (user === actor.id) assertCanGrant(actor, permissions, { selfThroughRule: true, role: role.name });
        else assertCanAssignRole(actor, { name: role.name, permissions }, { targetUserId: user, throughRule: true });
      }
    }
  } catch (err) {
    await undo();
    forgetAccessRules(orgId);
    throw err;
  }
  return result;
}
