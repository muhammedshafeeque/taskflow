import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { User } from '../auth/user.model';
import { Project } from '../projects/project.model';
import { WorkLog } from '../workLogs/workLog.model';
import { Issue } from '../issues/issue.model';
import { ResourceAllocation } from './models/resourceAllocation.model';
import { ResourceDemand } from './models/resourceDemand.model';
import { ResourceProfile } from './models/resourceProfile.model';
import { requireWorkspaceId, toOrgOid } from './resourcesWorkspace';

async function workspaceProjectIds(orgId: string): Promise<mongoose.Types.ObjectId[]> {
  return Project.find({ taskflowOrganizationId: orgId }).distinct('_id') as Promise<mongoose.Types.ObjectId[]>;
}

function overlaps(aStart: Date, aEnd: Date | null | undefined, bStart: Date, bEnd: Date | null | undefined): boolean {
  const aE = aEnd ?? new Date('2099-12-31');
  const bE = bEnd ?? new Date('2099-12-31');
  return aStart <= bE && bStart <= aE;
}

function daysBetween(start: Date, end: Date): number {
  const ms = Math.max(0, end.getTime() - start.getTime());
  return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)) + 1);
}

async function orgUserIds(orgOid: mongoose.Types.ObjectId): Promise<mongoose.Types.ObjectId[]> {
  const ids = await OrganizationMember.find({ organization: orgOid, status: 'active' }).distinct('user');
  return ids as mongoose.Types.ObjectId[];
}

async function populateAllocation(doc: unknown) {
  return ResourceAllocation.findById((doc as { _id: unknown })._id)
    .populate('userId', 'name email')
    .populate('projectId', 'name key')
    .lean();
}

export async function getDashboard(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const now = new Date();
  const memberIds = await orgUserIds(orgOid);
  const activeFilter = {
    taskflowOrganizationId: orgOid,
    startDate: { $lte: now },
    $or: [{ endDate: null }, { endDate: { $gte: now } }],
  };

  const [activeAllocations, softBookings, openDemands, profiles, allocations, demands, users] =
    await Promise.all([
      ResourceAllocation.countDocuments(activeFilter),
      ResourceAllocation.countDocuments({ ...activeFilter, softBooked: true }),
      ResourceDemand.countDocuments({
        taskflowOrganizationId: orgOid,
        status: { $in: ['open', 'partially_filled'] },
      }),
      ResourceProfile.countDocuments({ taskflowOrganizationId: orgOid }),
      ResourceAllocation.find(activeFilter).populate('projectId', 'name key').lean(),
      ResourceDemand.find({
        taskflowOrganizationId: orgOid,
        status: { $in: ['open', 'partially_filled'] },
      })
        .select('hoursNeeded title priority')
        .lean(),
      User.find({ _id: { $in: memberIds } }).select('name').lean(),
    ]);

  const nameByUser = new Map(users.map((u) => [String(u._id), u.name ?? 'Unknown']));

  const loadByUser = new Map<string, number>();
  for (const a of allocations) {
    if (a.softBooked) continue;
    const key = String(a.userId);
    loadByUser.set(key, (loadByUser.get(key) ?? 0) + a.percent);
  }

  let overAllocated = 0;
  let onBench = 0;
  let fullyBooked = 0;
  let partiallyBooked = 0;
  for (const uid of memberIds) {
    const load = loadByUser.get(String(uid)) ?? 0;
    if (load > 100) overAllocated += 1;
    else if (load >= 80) fullyBooked += 1;
    else if (load >= 20) partiallyBooked += 1;
    if (load < 20) onBench += 1;
  }

  const avgUtilization =
    memberIds.length === 0
      ? 0
      : Math.round(
          (memberIds.reduce((s, uid) => s + Math.min(loadByUser.get(String(uid)) ?? 0, 100), 0) /
            memberIds.length) *
            10
        ) / 10;

  const buckets = [
    { name: '0–20%', min: 0, max: 20 },
    { name: '21–50%', min: 21, max: 50 },
    { name: '51–80%', min: 51, max: 80 },
    { name: '81–100%', min: 81, max: 100 },
    { name: '>100%', min: 101, max: 9999 },
  ];
  const loadDistribution = buckets.map((b) => {
    let count = 0;
    for (const uid of memberIds) {
      const load = loadByUser.get(String(uid)) ?? 0;
      if (load >= b.min && load <= b.max) count += 1;
    }
    return { name: b.name, count };
  });

  const topLoaded = [...memberIds]
    .map((uid) => {
      const id = String(uid);
      return {
        userId: id,
        name: nameByUser.get(id) ?? 'Unknown',
        plannedPercent: Math.round((loadByUser.get(id) ?? 0) * 10) / 10,
      };
    })
    .sort((a, b) => b.plannedPercent - a.plannedPercent)
    .slice(0, 8);

  const projectHours = new Map<string, { name: string; percent: number; people: number }>();
  for (const a of allocations) {
    if (a.softBooked) continue;
    const proj = a.projectId as { _id?: unknown; name?: string; key?: string } | null;
    const key = String(proj?._id ?? a.projectId);
    const label = proj?.key ? `${proj.key}` : proj?.name ?? 'Project';
    const cur = projectHours.get(key) ?? { name: label, percent: 0, people: 0 };
    cur.percent += a.percent;
    cur.people += 1;
    projectHours.set(key, cur);
  }
  const allocationsByProject = [...projectHours.values()]
    .map((p) => ({ name: p.name, percent: Math.round(p.percent), people: p.people }))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 8);

  const demandHrs = demands.reduce((s, d) => s + (d.hoursNeeded ?? 0), 0);
  const capacityHrsWeek = memberIds.length * 40;
  const committedPctAvg = avgUtilization;
  const availableHrsWeek = Math.round(capacityHrsWeek * (1 - Math.min(committedPctAvg, 100) / 100));

  const demandByPriority = ['critical', 'high', 'medium', 'low'].map((priority) => ({
    name: priority,
    count: demands.filter((d) => (d.priority ?? 'medium') === priority).length,
    hours: demands
      .filter((d) => (d.priority ?? 'medium') === priority)
      .reduce((s, d) => s + (d.hoursNeeded ?? 0), 0),
  }));

  return {
    counts: {
      teamSize: memberIds.length,
      activeAllocations,
      softBookings,
      openDemands,
      profiles,
      overAllocated,
      onBench,
      fullyBooked,
      partiallyBooked,
    },
    avgUtilization,
    charts: {
      loadDistribution,
      topLoaded,
      allocationsByProject,
      allocationMix: [
        { name: 'Committed', value: Math.max(0, activeAllocations - softBookings) },
        { name: 'Soft booked', value: softBookings },
      ],
      staffingMix: [
        { name: 'On bench', value: onBench },
        { name: 'Partial', value: partiallyBooked },
        { name: 'Fully booked', value: fullyBooked },
        { name: 'Over-allocated', value: overAllocated },
      ],
      capacity: {
        capacityHoursWeek: capacityHrsWeek,
        availableHoursWeek: availableHrsWeek,
        demandHoursOpen: Math.round(demandHrs),
        gapHours: Math.round(demandHrs - availableHrsWeek * 13),
      },
      demandByPriority,
    },
  };
}

export async function listAllocations(
  workspaceId: string | null | undefined,
  query: {
    userId?: string;
    projectId?: string;
    activeOnly?: boolean;
    includeSoft?: boolean;
  } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: orgOid };
  if (query.userId) filter.userId = query.userId;
  if (query.projectId) filter.projectId = query.projectId;
  if (query.activeOnly) {
    const now = new Date();
    filter.startDate = { $lte: now };
    filter.$or = [{ endDate: null }, { endDate: { $gte: now } }];
  }
  if (query.includeSoft === false) filter.softBooked = false;

  return ResourceAllocation.find(filter)
    .populate('userId', 'name email')
    .populate('projectId', 'name key')
    .sort({ startDate: -1 })
    .lean();
}

export async function createAllocation(
  workspaceId: string | null | undefined,
  actorId: string,
  input: {
    userId: string;
    projectId: string;
    percent: number;
    startDate: string;
    endDate?: string | null;
    billable?: boolean;
    softBooked?: boolean;
    roleLabel?: string;
    notes?: string;
  }
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  if (!input.userId || !input.projectId || !input.startDate) {
    throw new ApiError(400, 'userId, projectId, and startDate are required');
  }
  const percent = Number(input.percent);
  if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
    throw new ApiError(400, 'percent must be between 1 and 100');
  }

  const memberOk = await OrganizationMember.exists({
    organization: orgOid,
    user: input.userId,
    status: 'active',
  });
  if (!memberOk) throw new ApiError(400, 'User is not an active workspace member');

  const projectIds = await workspaceProjectIds(orgId);
  if (!projectIds.some((id) => String(id) === input.projectId)) {
    throw new ApiError(400, 'Project is not in this workspace');
  }

  const startDate = new Date(input.startDate);
  const endDate = input.endDate ? new Date(input.endDate) : null;
  if (endDate && endDate < startDate) throw new ApiError(400, 'endDate must be on or after startDate');

  const doc = await ResourceAllocation.create({
    taskflowOrganizationId: orgOid,
    userId: input.userId,
    projectId: input.projectId,
    percent,
    startDate,
    endDate,
    billable: input.billable !== false,
    softBooked: Boolean(input.softBooked),
    roleLabel: input.roleLabel?.trim() || undefined,
    notes: input.notes,
    createdBy: actorId,
  });

  const conflicts = await findConflictsForUser(orgId, input.userId, startDate, endDate, String(doc._id));
  const populated = await populateAllocation(doc);
  return { allocation: populated, conflicts };
}

export async function updateAllocation(
  workspaceId: string | null | undefined,
  id: string,
  input: Partial<{
    percent: number;
    startDate: string;
    endDate: string | null;
    billable: boolean;
    softBooked: boolean;
    roleLabel: string;
    notes: string;
    projectId: string;
  }>
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const existing = await ResourceAllocation.findOne({ _id: id, taskflowOrganizationId: orgOid });
  if (!existing) throw new ApiError(404, 'Allocation not found');

  if (input.percent != null) {
    const percent = Number(input.percent);
    if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
      throw new ApiError(400, 'percent must be between 1 and 100');
    }
    existing.percent = percent;
  }
  if (input.startDate) existing.startDate = new Date(input.startDate);
  if (input.endDate !== undefined) existing.endDate = input.endDate ? new Date(input.endDate) : null;
  if (input.billable !== undefined) existing.billable = input.billable;
  if (input.softBooked !== undefined) existing.softBooked = input.softBooked;
  if (input.roleLabel !== undefined) existing.roleLabel = input.roleLabel.trim() || undefined;
  if (input.notes !== undefined) existing.notes = input.notes;
  if (input.projectId) {
    const projectIds = await workspaceProjectIds(orgId);
    if (!projectIds.some((pid) => String(pid) === input.projectId)) {
      throw new ApiError(400, 'Project is not in this workspace');
    }
    existing.projectId = new mongoose.Types.ObjectId(input.projectId);
  }
  if (existing.endDate && existing.endDate < existing.startDate) {
    throw new ApiError(400, 'endDate must be on or after startDate');
  }

  await existing.save();
  const conflicts = await findConflictsForUser(
    orgId,
    String(existing.userId),
    existing.startDate,
    existing.endDate ?? null,
    String(existing._id)
  );
  return { allocation: await populateAllocation(existing), conflicts };
}

export async function deleteAllocation(workspaceId: string | null | undefined, id: string) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const result = await ResourceAllocation.findOneAndDelete({ _id: id, taskflowOrganizationId: orgOid });
  if (!result) throw new ApiError(404, 'Allocation not found');
  return { deleted: true };
}

async function findConflictsForUser(
  orgId: string,
  userId: string,
  startDate: Date,
  endDate: Date | null,
  excludeId?: string
) {
  const orgOid = toOrgOid(orgId);
  const rows = await ResourceAllocation.find({
    taskflowOrganizationId: orgOid,
    userId,
    softBooked: false,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }).lean();

  const overlapping = rows.filter((r) => overlaps(startDate, endDate, r.startDate, r.endDate));
  const totalPercent = overlapping.reduce((s, r) => s + r.percent, 0);
  return {
    overlappingCount: overlapping.length,
    committedPercent: totalPercent,
    overAllocated: totalPercent > 100,
  };
}

export async function getConflicts(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const now = new Date();
  const allocations = await ResourceAllocation.find({
    taskflowOrganizationId: orgOid,
    softBooked: false,
    startDate: { $lte: now },
    $or: [{ endDate: null }, { endDate: { $gte: now } }],
  })
    .populate('userId', 'name email')
    .populate('projectId', 'name key')
    .lean();

  const byUser = new Map<string, typeof allocations>();
  for (const a of allocations) {
    const key = String(a.userId?._id ?? a.userId);
    const list = byUser.get(key) ?? [];
    list.push(a);
    byUser.set(key, list);
  }

  const conflicts = [];
  for (const [, list] of byUser) {
    const total = list.reduce((s, a) => s + a.percent, 0);
    if (total > 100) {
      const user = list[0].userId as { _id?: unknown; name?: string; email?: string };
      conflicts.push({
        userId: String(user?._id ?? list[0].userId),
        userName: user?.name ?? 'Unknown',
        userEmail: user?.email,
        totalPercent: total,
        allocations: list,
      });
    }
  }
  return { conflicts, count: conflicts.length };
}

export async function getUtilization(
  workspaceId: string | null | undefined,
  query: { from?: string; to?: string } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  const memberIds = await orgUserIds(orgOid);
  const users = await User.find({ _id: { $in: memberIds } }).select('name email').lean();
  const profiles = await ResourceProfile.find({ taskflowOrganizationId: orgOid }).lean();
  const profileByUser = new Map(profiles.map((p) => [String(p.userId), p]));

  const allocations = await ResourceAllocation.find({
    taskflowOrganizationId: orgOid,
    startDate: { $lte: to },
    $or: [{ endDate: null }, { endDate: { $gte: from } }],
  }).lean();

  const projectIds = await workspaceProjectIds(orgId);
  const issues = await Issue.find({ project: { $in: projectIds } }).select('_id').lean();
  const issueIds = issues.map((i) => i._id);
  const workLogs =
    issueIds.length === 0
      ? []
      : await WorkLog.find({
          issue: { $in: issueIds },
          author: { $in: memberIds },
          date: { $gte: from, $lte: to },
        })
          .select('author minutesSpent')
          .lean();

  const loggedByUser = new Map<string, number>();
  for (const w of workLogs) {
    const key = String(w.author);
    loggedByUser.set(key, (loggedByUser.get(key) ?? 0) + (w.minutesSpent ?? 0));
  }

  const periodDays = daysBetween(from, to);
  const periodWeeks = periodDays / 7;

  const people = users.map((u) => {
    const uid = String(u._id);
    const profile = profileByUser.get(uid);
    const capacityHrs = (profile?.capacityHoursPerWeek ?? 40) * periodWeeks;
    const userAllocs = allocations.filter((a) => String(a.userId) === uid);
    let plannedPercent = 0;
    let billablePercent = 0;
    for (const a of userAllocs) {
      if (a.softBooked) continue;
      if (!overlaps(from, to, a.startDate, a.endDate)) continue;
      plannedPercent += a.percent;
      if (a.billable) billablePercent += a.percent;
    }
    const loggedMinutes = loggedByUser.get(uid) ?? 0;
    const loggedHours = Math.round((loggedMinutes / 60) * 10) / 10;
    const plannedHours = Math.round(((plannedPercent / 100) * capacityHrs) * 10) / 10;
    const utilizationPct =
      capacityHrs > 0 ? Math.round((loggedHours / capacityHrs) * 1000) / 10 : 0;
    const plannedUtilizationPct = Math.min(999, Math.round(plannedPercent * 10) / 10);

    return {
      userId: uid,
      name: u.name,
      email: u.email,
      capacityHours: Math.round(capacityHrs * 10) / 10,
      plannedPercent: plannedUtilizationPct,
      billablePercent: Math.round(billablePercent * 10) / 10,
      plannedHours,
      loggedHours,
      utilizationPct,
      overAllocated: plannedPercent > 100,
      skills: profile?.skills ?? [],
      department: profile?.department,
    };
  });

  people.sort((a, b) => b.plannedPercent - a.plannedPercent);

  const avgLogged =
    people.length === 0
      ? 0
      : Math.round((people.reduce((s, p) => s + p.utilizationPct, 0) / people.length) * 10) / 10;

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    summary: {
      teamSize: people.length,
      avgLoggedUtilization: avgLogged,
      overAllocated: people.filter((p) => p.overAllocated).length,
      underUtilized: people.filter((p) => p.plannedPercent < 50).length,
    },
    people,
  };
}

export async function getBench(
  workspaceId: string | null | undefined,
  query: { threshold?: number } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const threshold = query.threshold ?? 20;
  const now = new Date();
  const memberIds = await orgUserIds(orgOid);
  const users = await User.find({ _id: { $in: memberIds } }).select('name email').lean();
  const profiles = await ResourceProfile.find({ taskflowOrganizationId: orgOid }).lean();
  const profileByUser = new Map(profiles.map((p) => [String(p.userId), p]));

  const allocations = await ResourceAllocation.find({
    taskflowOrganizationId: orgOid,
    softBooked: false,
    startDate: { $lte: now },
    $or: [{ endDate: null }, { endDate: { $gte: now } }],
  })
    .populate('projectId', 'name key')
    .lean();

  const endingSoon = await ResourceAllocation.find({
    taskflowOrganizationId: orgOid,
    softBooked: false,
    endDate: {
      $gte: now,
      $lte: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    },
  })
    .populate('userId', 'name email')
    .populate('projectId', 'name key')
    .lean();

  const loadByUser = new Map<string, { percent: number; projects: Array<{ name?: string; key?: string; percent: number }> }>();
  for (const a of allocations) {
    const key = String(a.userId);
    const entry = loadByUser.get(key) ?? { percent: 0, projects: [] };
    entry.percent += a.percent;
    const proj = a.projectId as { name?: string; key?: string } | null;
    entry.projects.push({ name: proj?.name, key: proj?.key, percent: a.percent });
    loadByUser.set(key, entry);
  }

  const available = users
    .map((u) => {
      const uid = String(u._id);
      const load = loadByUser.get(uid)?.percent ?? 0;
      const profile = profileByUser.get(uid);
      return {
        userId: uid,
        name: u.name,
        email: u.email,
        availablePercent: Math.max(0, 100 - load),
        committedPercent: load,
        projects: loadByUser.get(uid)?.projects ?? [],
        skills: profile?.skills ?? [],
        department: profile?.department,
        location: profile?.location,
        availableFrom: profile?.availableFrom ?? null,
        capacityHoursPerWeek: profile?.capacityHoursPerWeek ?? 40,
      };
    })
    .filter((p) => p.availablePercent >= 100 - threshold || p.committedPercent <= threshold)
    .sort((a, b) => b.availablePercent - a.availablePercent);

  return {
    threshold,
    available,
    freeingSoon: endingSoon.map((a) => ({
      allocationId: String(a._id),
      user: a.userId,
      project: a.projectId,
      percent: a.percent,
      endDate: a.endDate,
    })),
  };
}

export async function listDemands(
  workspaceId: string | null | undefined,
  query: { status?: string } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: orgOid };
  if (query.status) filter.status = query.status;
  return ResourceDemand.find(filter)
    .populate('projectId', 'name key')
    .sort({ periodStart: 1 })
    .lean();
}

export async function createDemand(
  workspaceId: string | null | undefined,
  actorId: string,
  input: {
    title: string;
    projectId?: string | null;
    roleLabel?: string;
    hoursNeeded: number;
    periodStart: string;
    periodEnd: string;
    priority?: string;
    status?: string;
    skills?: string[];
    notes?: string;
  }
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  if (!input.title?.trim() || !input.periodStart || !input.periodEnd) {
    throw new ApiError(400, 'title, periodStart, and periodEnd are required');
  }
  const hoursNeeded = Number(input.hoursNeeded);
  if (!Number.isFinite(hoursNeeded) || hoursNeeded < 0) {
    throw new ApiError(400, 'hoursNeeded must be a non-negative number');
  }
  const periodStart = new Date(input.periodStart);
  const periodEnd = new Date(input.periodEnd);
  if (periodEnd < periodStart) throw new ApiError(400, 'periodEnd must be on or after periodStart');

  if (input.projectId) {
    const projectIds = await workspaceProjectIds(orgId);
    if (!projectIds.some((id) => String(id) === input.projectId)) {
      throw new ApiError(400, 'Project is not in this workspace');
    }
  }

  const doc = await ResourceDemand.create({
    taskflowOrganizationId: orgOid,
    title: input.title.trim(),
    projectId: input.projectId || null,
    roleLabel: input.roleLabel?.trim() || undefined,
    hoursNeeded,
    periodStart,
    periodEnd,
    priority: (input.priority as 'low' | 'medium' | 'high' | 'critical') || 'medium',
    status: (input.status as 'open' | 'partially_filled' | 'filled' | 'cancelled') || 'open',
    skills: input.skills ?? [],
    notes: input.notes,
    createdBy: actorId,
  });

  return ResourceDemand.findById(doc._id).populate('projectId', 'name key').lean();
}

export async function updateDemand(
  workspaceId: string | null | undefined,
  id: string,
  input: Partial<{
    title: string;
    projectId: string | null;
    roleLabel: string;
    hoursNeeded: number;
    periodStart: string;
    periodEnd: string;
    priority: string;
    status: string;
    skills: string[];
    notes: string;
  }>
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const existing = await ResourceDemand.findOne({ _id: id, taskflowOrganizationId: orgOid });
  if (!existing) throw new ApiError(404, 'Demand not found');

  if (input.title !== undefined) existing.title = input.title.trim();
  if (input.projectId !== undefined) {
    if (input.projectId) {
      const projectIds = await workspaceProjectIds(orgId);
      if (!projectIds.some((pid) => String(pid) === input.projectId)) {
        throw new ApiError(400, 'Project is not in this workspace');
      }
      existing.projectId = new mongoose.Types.ObjectId(input.projectId);
    } else {
      existing.projectId = null;
    }
  }
  if (input.roleLabel !== undefined) existing.roleLabel = input.roleLabel.trim() || undefined;
  if (input.hoursNeeded !== undefined) {
    const hoursNeeded = Number(input.hoursNeeded);
    if (!Number.isFinite(hoursNeeded) || hoursNeeded < 0) {
      throw new ApiError(400, 'hoursNeeded must be a non-negative number');
    }
    existing.hoursNeeded = hoursNeeded;
  }
  if (input.periodStart) existing.periodStart = new Date(input.periodStart);
  if (input.periodEnd) existing.periodEnd = new Date(input.periodEnd);
  if (existing.periodEnd < existing.periodStart) {
    throw new ApiError(400, 'periodEnd must be on or after periodStart');
  }
  if (input.priority) existing.priority = input.priority as typeof existing.priority;
  if (input.status) existing.status = input.status as typeof existing.status;
  if (input.skills) existing.skills = input.skills;
  if (input.notes !== undefined) existing.notes = input.notes;

  await existing.save();
  return ResourceDemand.findById(existing._id).populate('projectId', 'name key').lean();
}

export async function deleteDemand(workspaceId: string | null | undefined, id: string) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const result = await ResourceDemand.findOneAndDelete({ _id: id, taskflowOrganizationId: orgOid });
  if (!result) throw new ApiError(404, 'Demand not found');
  return { deleted: true };
}

export async function getForecast(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const now = new Date();
  const horizon = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const [demands, memberIds, profiles, allocations] = await Promise.all([
    ResourceDemand.find({
      taskflowOrganizationId: orgOid,
      status: { $in: ['open', 'partially_filled'] },
      periodStart: { $lte: horizon },
      periodEnd: { $gte: now },
    })
      .populate('projectId', 'name key')
      .lean(),
    orgUserIds(orgOid),
    ResourceProfile.find({ taskflowOrganizationId: orgOid }).lean(),
    ResourceAllocation.find({
      taskflowOrganizationId: orgOid,
      softBooked: false,
      startDate: { $lte: horizon },
      $or: [{ endDate: null }, { endDate: { $gte: now } }],
    }).lean(),
  ]);

  const weeks = 13;
  const totalCapacityHrs = memberIds.reduce((sum, uid) => {
    const p = profiles.find((x) => String(x.userId) === String(uid));
    return sum + (p?.capacityHoursPerWeek ?? 40) * weeks;
  }, 0);

  const committedPercentAvg =
    memberIds.length === 0
      ? 0
      : (() => {
          const loads = memberIds.map((uid) =>
            allocations
              .filter((a) => String(a.userId) === String(uid))
              .reduce((s, a) => s + a.percent, 0)
          );
          return loads.reduce((s, v) => s + Math.min(v, 100), 0) / memberIds.length;
        })();

  const availableHrs = Math.round(totalCapacityHrs * (1 - committedPercentAvg / 100));
  const demandHrs = demands.reduce((s, d) => s + d.hoursNeeded, 0);
  const gapHrs = Math.round(demandHrs - availableHrs);

  return {
    horizonDays: 90,
    supply: {
      teamSize: memberIds.length,
      totalCapacityHours: Math.round(totalCapacityHrs),
      avgCommittedPercent: Math.round(committedPercentAvg * 10) / 10,
      availableHours: availableHrs,
    },
    demand: {
      openCount: demands.length,
      hoursNeeded: Math.round(demandHrs),
      items: demands,
    },
    gapHours: gapHrs,
    shortfall: gapHrs > 0,
  };
}

export async function listProfiles(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const memberIds = await orgUserIds(orgOid);
  const users = await User.find({ _id: { $in: memberIds } }).select('name email').lean();
  const profiles = await ResourceProfile.find({ taskflowOrganizationId: orgOid }).lean();
  const byUser = new Map(profiles.map((p) => [String(p.userId), p]));

  return users.map((u) => {
    const profile = byUser.get(String(u._id));
    return {
      userId: String(u._id),
      name: u.name,
      email: u.email,
      capacityHoursPerWeek: profile?.capacityHoursPerWeek ?? 40,
      skills: profile?.skills ?? [],
      seniority: profile?.seniority,
      department: profile?.department,
      location: profile?.location,
      availableFrom: profile?.availableFrom ?? null,
      notes: profile?.notes,
      profileId: profile ? String(profile._id) : null,
    };
  });
}

export async function upsertProfile(
  workspaceId: string | null | undefined,
  input: {
    userId: string;
    capacityHoursPerWeek?: number;
    skills?: string[];
    seniority?: string;
    department?: string;
    location?: string;
    availableFrom?: string | null;
    notes?: string;
  }
): Promise<{
  userId: string;
  name?: string;
  email?: string;
  capacityHoursPerWeek: number;
  skills: string[];
  seniority?: string;
  department?: string;
  location?: string;
  availableFrom?: Date | null;
  notes?: string;
  profileId: string;
}> {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  if (!input.userId) throw new ApiError(400, 'userId is required');

  const memberOk = await OrganizationMember.exists({
    organization: orgOid,
    user: input.userId,
    status: 'active',
  });
  if (!memberOk) throw new ApiError(400, 'User is not an active workspace member');

  const update: Record<string, unknown> = {};
  if (input.capacityHoursPerWeek != null) {
    const hrs = Number(input.capacityHoursPerWeek);
    if (!Number.isFinite(hrs) || hrs < 1 || hrs > 168) {
      throw new ApiError(400, 'capacityHoursPerWeek must be between 1 and 168');
    }
    update.capacityHoursPerWeek = hrs;
  }
  if (input.skills) update.skills = input.skills.map((s) => s.trim()).filter(Boolean);
  if (input.seniority !== undefined) update.seniority = input.seniority.trim() || undefined;
  if (input.department !== undefined) update.department = input.department.trim() || undefined;
  if (input.location !== undefined) update.location = input.location.trim() || undefined;
  if (input.availableFrom !== undefined) {
    update.availableFrom = input.availableFrom ? new Date(input.availableFrom) : null;
  }
  if (input.notes !== undefined) update.notes = input.notes;

  const doc = await ResourceProfile.findOneAndUpdate(
    { taskflowOrganizationId: orgOid, userId: input.userId },
    { $set: update, $setOnInsert: { taskflowOrganizationId: orgOid, userId: input.userId } },
    { upsert: true, new: true }
  ).lean();

  const user = await User.findById(input.userId).select('name email').lean();
  return {
    userId: input.userId,
    name: user?.name,
    email: user?.email,
    capacityHoursPerWeek: doc?.capacityHoursPerWeek ?? 40,
    skills: doc?.skills ?? [],
    seniority: doc?.seniority,
    department: doc?.department,
    location: doc?.location,
    availableFrom: doc?.availableFrom ?? null,
    notes: doc?.notes,
    profileId: String(doc?._id),
  };
}

export async function listTeamOptions(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const memberIds = await orgUserIds(orgOid);
  const [users, projects] = await Promise.all([
    User.find({ _id: { $in: memberIds } }).select('name email').sort({ name: 1 }).lean(),
    Project.find({ _id: { $in: await workspaceProjectIds(orgId) } })
      .select('name key')
      .sort({ name: 1 })
      .lean(),
  ]);
  return {
    users: users.map((u) => ({ id: String(u._id), name: u.name, email: u.email })),
    projects: projects.map((p) => ({ id: String(p._id), name: p.name, key: p.key })),
  };
}
