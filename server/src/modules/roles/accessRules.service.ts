import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { logAudit } from '../auditLogs/logAudit';
import { ResourceTeam } from '../resources/models/resourceTeam.model';
import { getHrSettings } from '../hrms/policy.service';
import { forgetAccessRules, ruleRolesByUser, withRuleGainCheck } from '../auth/accessProfile';
import type { GrantActor } from '../auth/grantGuard';
import { AccessRule } from './accessRule.model';
import { Role } from './role.model';

export async function listRules(ws: string | null | undefined) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const [rules, reach] = await Promise.all([
    AccessRule.find({ taskflowOrganizationId: orgOid }).populate('teamId', 'name').populate('roleIds', 'name').sort({ name: 1 }).lean(),
    ruleRolesByUser(orgOid, undefined, (await AccessRule.find({ taskflowOrganizationId: orgOid, active: true }).lean()) as never),
  ]);
  // How many people each rule's roles reach right now.
  // Plain ids for the edit form, names for the list.
  return rules.map((r) => {
    const team = r.teamId as { _id?: unknown; name?: string } | null;
    const roles = (r.roleIds ?? []) as Array<{ _id: unknown; name?: string }>;
    return {
      ...r,
      teamId: team?._id ? String(team._id) : null,
      teamName: team?.name ?? null,
      roleIds: roles.map((x) => String(x._id)),
      roleNames: roles.map((x) => x.name ?? ''),
      people: [...reach.values()].filter((set) => roles.some((x) => set.has(String(x._id)))).length,
    };
  });
}

async function clean(orgOid: mongoose.Types.ObjectId, input: Record<string, unknown>, existing?: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  if (input.name !== undefined || !existing) {
    const name = String(input.name ?? '').trim().slice(0, 80);
    if (!name) throw new ApiError(400, 'Name is required');
    out.name = name;
  }
  if (input.teamId !== undefined) {
    if (!input.teamId) out.teamId = null;
    else if (!mongoose.isValidObjectId(input.teamId) || !(await ResourceTeam.exists({ _id: input.teamId, taskflowOrganizationId: orgOid }))) throw new ApiError(400, 'Team not found');
    else out.teamId = new mongoose.Types.ObjectId(String(input.teamId));
  }
  if (input.level !== undefined) {
    const level = String(input.level ?? '').trim();
    if (level) {
      const levels = ((await getHrSettings(String(orgOid))) as { levels?: string[] }).levels ?? [];
      if (!levels.some((l) => l.toLowerCase() === level.toLowerCase())) throw new ApiError(400, `Level must be one of: ${levels.join(', ')}`);
    }
    out.level = level || null;
  }
  if (input.leadsOnly !== undefined) out.leadsOnly = Boolean(input.leadsOnly);
  if (input.active !== undefined) out.active = Boolean(input.active);
  if (input.roleIds !== undefined || !existing) {
    const ids = Array.isArray(input.roleIds) ? [...new Set(input.roleIds.map(String))] : [];
    if (!ids.length) throw new ApiError(400, 'Choose at least one role');
    if (ids.some((id) => !mongoose.isValidObjectId(id)) || (await Role.countDocuments({ _id: { $in: ids } })) !== ids.length) throw new ApiError(400, 'Unknown role');
    out.roleIds = ids.map((id) => new mongoose.Types.ObjectId(id));
  }
  const merged = { ...existing, ...out };
  if (!merged.teamId && !merged.level && !merged.leadsOnly) throw new ApiError(400, 'Choose a team, a level, or team leads — a rule for everyone belongs in their role');
  return out;
}

export async function saveRule(ws: string | null | undefined, input: Record<string, unknown>, actor: GrantActor, id?: string) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const existing = id ? await AccessRule.findOne({ _id: mongoose.isValidObjectId(id) ? id : null, taskflowOrganizationId: orgOid }).lean() : null;
  if (id && !existing) throw new ApiError(404, 'Access rule not found');
  const data = await clean(orgOid, input, existing ?? undefined);
  let createdId: unknown;
  const doc = await withRuleGainCheck(
    orgOid,
    actor,
    async () => {
      if (existing) return AccessRule.findByIdAndUpdate(existing._id, { $set: data }, { new: true }).lean();
      const made = await AccessRule.create({ ...data, taskflowOrganizationId: orgOid });
      createdId = made._id;
      return made.toObject();
    },
    async () => (existing ? AccessRule.replaceOne({ _id: existing._id }, existing) : createdId && AccessRule.deleteOne({ _id: createdId }))
  );
  logAudit({ userId: actor.id, action: existing ? 'access_rule.update' : 'access_rule.create', resourceType: 'access_rule', resourceId: String(doc?._id), meta: { ...data } });
  return doc;
}

export async function deleteRule(ws: string | null | undefined, id: string, actor: GrantActor) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const res = await AccessRule.findOneAndDelete({ _id: mongoose.isValidObjectId(id) ? id : null, taskflowOrganizationId: orgOid }).lean();
  if (!res) throw new ApiError(404, 'Access rule not found');
  forgetAccessRules(orgOid);
  logAudit({ userId: actor.id, action: 'access_rule.delete', resourceType: 'access_rule', resourceId: id, meta: { name: res.name } });
  return { deleted: true };
}
