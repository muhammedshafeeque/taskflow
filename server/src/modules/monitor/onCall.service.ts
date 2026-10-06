import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { MonitorProject } from './monitor.models';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { User } from '../auth/user.model';
import { notifyUser } from '../notifications/notificationDispatch.service';
import { claimReminder } from '../reminders/reminderLog.model';

type OnCall = { enabled: boolean; userIds: mongoose.Types.ObjectId[]; rotationDays: number; startsAt: Date };

/** Index into the rotation for a given moment (pure, for tests). */
export function onCallIndex(startsAt: Date, rotationDays: number, people: number, now = new Date()): number {
  if (people <= 0) return -1;
  const slot = Math.floor((now.getTime() - new Date(startsAt).getTime()) / (Math.max(1, rotationDays) * 86_400_000));
  return ((slot % people) + people) % people;
}

export function currentOnCall(onCall: OnCall | undefined, now = new Date()): { userId: string | null; until: Date | null } {
  if (!onCall?.enabled || !onCall.userIds?.length) return { userId: null, until: null };
  const idx = onCallIndex(onCall.startsAt, onCall.rotationDays, onCall.userIds.length, now);
  const period = Math.max(1, onCall.rotationDays) * 86_400_000;
  const elapsed = now.getTime() - new Date(onCall.startsAt).getTime();
  const until = new Date(new Date(onCall.startsAt).getTime() + (Math.floor(elapsed / period) + 1) * period);
  return { userId: String(onCall.userIds[idx]), until };
}

export async function getOnCall(workspaceId: string | null | undefined, projectId: string) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const project = await MonitorProject.findOne({ _id: projectId, taskflowOrganizationId: orgOid }).select('onCall').lean();
  if (!project) throw new ApiError(404, 'Monitor project not found');
  const onCall = project.onCall as OnCall | undefined;
  const now = currentOnCall(onCall);
  const users = await User.find({ _id: { $in: onCall?.userIds ?? [] } }).select('name email').lean();
  return {
    enabled: Boolean(onCall?.enabled),
    rotationDays: onCall?.rotationDays ?? 7,
    startsAt: onCall?.startsAt ?? null,
    people: (onCall?.userIds ?? []).map((id) => {
      const u = users.find((x) => String(x._id) === String(id));
      return { _id: String(id), name: u?.name ?? 'Unknown', email: u?.email };
    }),
    current: now.userId ? { userId: now.userId, until: now.until } : null,
  };
}

export async function setOnCall(
  workspaceId: string | null | undefined,
  projectId: string,
  input: { enabled?: boolean; userIds?: string[]; rotationDays?: number; startsAt?: string }
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const $set: Record<string, unknown> = {};
  if (input.enabled !== undefined) $set['onCall.enabled'] = Boolean(input.enabled);
  if (input.userIds !== undefined) {
    const ids = [...new Set(input.userIds.filter((id) => mongoose.Types.ObjectId.isValid(id)))].slice(0, 20);
    const members = await OrganizationMember.find({ organization: orgOid, user: { $in: ids }, status: 'active' }).distinct('user');
    const allowed = new Set(members.map(String));
    $set['onCall.userIds'] = ids.filter((id) => allowed.has(id)).map((id) => new mongoose.Types.ObjectId(id));
  }
  if (input.rotationDays !== undefined) {
    const d = Number(input.rotationDays);
    if (!Number.isInteger(d) || d < 1 || d > 90) throw new ApiError(400, 'rotationDays must be 1–90');
    $set['onCall.rotationDays'] = d;
  }
  if (input.startsAt !== undefined) {
    const d = new Date(input.startsAt);
    if (Number.isNaN(d.getTime())) throw new ApiError(400, 'Invalid startsAt');
    $set['onCall.startsAt'] = d;
  }
  const updated = await MonitorProject.findOneAndUpdate({ _id: projectId, taskflowOrganizationId: orgOid }, { $set }, { new: true });
  if (!updated) throw new ApiError(404, 'Monitor project not found');
  return getOnCall(orgId, projectId);
}

/**
 * Page the current on-call person. `dedupeKey` + hourly bucket keeps a noisy
 * error or a flapping check from paging more than once an hour.
 */
export async function pageOnCall(params: {
  projectId: string;
  title: string;
  body: string;
  link: string;
  dedupeKey: string;
}): Promise<void> {
  const project = await MonitorProject.findById(params.projectId).select('onCall name').lean();
  const { userId } = currentOnCall(project?.onCall as OnCall | undefined);
  if (!userId) return;
  const hour = new Date().toISOString().slice(0, 13);
  if (!(await claimReminder('oncall_page', `${params.projectId}:${params.dedupeKey}:${hour}`))) return;
  await notifyUser({
    userId,
    eventKey: 'system_alert',
    title: `🚨 ${project?.name ?? 'Monitor'}: ${params.title}`,
    body: params.body,
    link: params.link,
    metadata: { monitorProjectId: params.projectId, onCall: true },
  }).catch((err) => console.error('[on-call] page failed', err));
}
