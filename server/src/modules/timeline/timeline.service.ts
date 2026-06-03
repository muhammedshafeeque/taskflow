import mongoose from 'mongoose';
import { Issue } from '../issues/issue.model';
import { IssueLink } from '../issues/issueLink.model';
import { Milestone } from '../milestones/milestone.model';
import { Project } from '../projects/project.model';
import { ProjectMember } from '../projects/projectMember.model';
import { ApiError } from '../../utils/ApiError';
import { getClosedStatusNamesForProject } from '../projects/statusClassification';
import { normalizeSchedulingDependencies } from './timelineDependencies';
import { isoDate } from './criticalPath';
import { getProjectObjectIdsInWorkspace } from '../projects/workspaceProjectAccess';

export type TimelineIssueRow = {
  id: string;
  key: string;
  title: string;
  type: string;
  status: string;
  parentId?: string;
  milestoneId?: string;
  fixVersionIds: string[];
  startDate?: string;
  dueDate?: string;
  baselineStartDate?: string;
  baselineDueDate?: string;
  progress: number;
};

export type ProjectTimelineResult = {
  range: { start: string; end: string };
  issues: TimelineIssueRow[];
  milestones: Array<{
    id: string;
    name: string;
    dueDate?: string;
    baselineStartDate?: string;
    baselineDueDate?: string;
    status: string;
  }>;
  versions: Array<{ id: string; name: string; releaseDate?: string }>;
  dependencies: Array<{ from: string; to: string }>;
  parentEdges: Array<{ parentId: string; childId: string }>;
};

function progressFromStatus(status: string, closedStatuses: string[]): number {
  const s = status.toLowerCase();
  if (closedStatuses.includes(status)) return 100;
  if (s.includes('progress')) return 50;
  return 0;
}

function computeRange(dates: string[]): { start: string; end: string } {
  const today = new Date().toISOString().slice(0, 10);
  if (dates.length === 0) {
    const d = new Date();
    const end = new Date(d);
    end.setDate(end.getDate() + 30);
    return { start: today, end: end.toISOString().slice(0, 10) };
  }
  const sorted = [...dates].sort();
  return { start: sorted[0], end: sorted[sorted.length - 1] };
}

export async function getProjectTimeline(
  projectId: string,
  userId: string
): Promise<ProjectTimelineResult> {
  const member = await ProjectMember.exists({
    project: projectId,
    user: new mongoose.Types.ObjectId(userId),
  });
  if (!member) throw new ApiError(403, 'Access denied');

  const projectOid = new mongoose.Types.ObjectId(projectId);
  const [project, issues, milestones] = await Promise.all([
    Project.findById(projectOid).select('versions key').lean(),
    Issue.find({ project: projectOid })
      .select('_id key title type status parent milestone fixVersion startDate dueDate baselineStartDate baselineDueDate')
      .lean(),
    Milestone.find({ project: projectOid })
      .select('_id name dueDate baselineStartDate baselineDueDate status')
      .lean(),
  ]);

  const issueIds = issues.map((i) => i._id);
  const links =
    issueIds.length > 0
      ? await IssueLink.find({
          $or: [{ sourceIssue: { $in: issueIds } }, { targetIssue: { $in: issueIds } }],
          linkType: { $in: ['blocks', 'is_blocked_by'] },
        }).lean()
      : [];

  if (!project) throw new ApiError(404, 'Project not found');

  const closedStatuses = await getClosedStatusNamesForProject(projectId);
  const issueIdStrs = issues.map((i) => String(i._id));
  const issueIdSet = new Set(issueIdStrs);

  const projectKey = String(project.key ?? '');
  const issueRows: TimelineIssueRow[] = issues.map((i) => {
    const id = String(i._id);
    const key =
      (i as { key?: string }).key ??
      (projectKey ? `${projectKey}-${id.slice(-6)}` : id.slice(-8));
    return {
      id,
      key,
      title: String(i.title ?? ''),
      type: String(i.type ?? 'Task'),
      status: String(i.status ?? ''),
      parentId: i.parent ? String(i.parent) : undefined,
      milestoneId: i.milestone ? String(i.milestone) : undefined,
      fixVersionIds: Array.isArray(i.fixVersion) ? i.fixVersion.map(String) : [],
      startDate: isoDate(i.startDate as Date | undefined),
      dueDate: isoDate(i.dueDate as Date | undefined),
      baselineStartDate: isoDate(i.baselineStartDate as Date | undefined),
      baselineDueDate: isoDate(i.baselineDueDate as Date | undefined),
      progress: progressFromStatus(String(i.status ?? ''), closedStatuses),
    };
  });

  const parentEdges: Array<{ parentId: string; childId: string }> = [];
  for (const i of issues) {
    if (i.parent) {
      parentEdges.push({ parentId: String(i.parent), childId: String(i._id) });
    }
  }

  const filteredLinks = links.filter(
    (l) => issueIdSet.has(String(l.sourceIssue)) && issueIdSet.has(String(l.targetIssue))
  );
  const dependencies = normalizeSchedulingDependencies(
    filteredLinks.map((l) => ({
      sourceIssue: String(l.sourceIssue),
      targetIssue: String(l.targetIssue),
      linkType: l.linkType,
    })),
    issueIdSet
  );

  const versions = ((project.versions ?? []) as Array<{ id: string; name: string; releaseDate?: Date; order?: number }>).map(
    (v) => ({
      id: String(v.id),
      name: String(v.name),
      releaseDate: isoDate(v.releaseDate),
      order: typeof v.order === 'number' ? v.order : 0,
    })
  );

  const milestoneRows = milestones.map((m) => ({
    id: String(m._id),
    name: String(m.name),
    dueDate: isoDate(m.dueDate as Date | undefined),
    baselineStartDate: isoDate(m.baselineStartDate as Date | undefined),
    baselineDueDate: isoDate(m.baselineDueDate as Date | undefined),
    status: String(m.status ?? 'open'),
  }));

  const allDates: string[] = [];
  for (const row of issueRows) {
    if (row.startDate) allDates.push(row.startDate);
    if (row.dueDate) allDates.push(row.dueDate);
    if (row.baselineStartDate) allDates.push(row.baselineStartDate);
    if (row.baselineDueDate) allDates.push(row.baselineDueDate);
  }
  for (const m of milestoneRows) {
    if (m.dueDate) allDates.push(m.dueDate);
    if (m.baselineDueDate) allDates.push(m.baselineDueDate);
  }
  for (const v of versions) {
    if (v.releaseDate) allDates.push(v.releaseDate);
  }

  return {
    range: computeRange(allDates),
    issues: issueRows,
    milestones: milestoneRows,
    versions,
    dependencies,
    parentEdges,
  };
}

export async function snapshotProjectBaseline(
  projectId: string,
  userId: string
): Promise<{ updated: number }> {
  const member = await ProjectMember.exists({
    project: projectId,
    user: new mongoose.Types.ObjectId(userId),
  });
  if (!member) throw new ApiError(403, 'Access denied');

  const issues = await Issue.find({
    project: projectId,
    $or: [
      { startDate: { $exists: true, $ne: null } },
      { dueDate: { $exists: true, $ne: null } },
    ],
  }).select('_id startDate dueDate');

  let updated = 0;
  for (const issue of issues) {
    const $set: Record<string, Date> = {};
    if (issue.startDate) $set.baselineStartDate = issue.startDate as Date;
    if (issue.dueDate) $set.baselineDueDate = issue.dueDate as Date;
    if (Object.keys($set).length === 0) continue;
    await Issue.updateOne({ _id: issue._id }, { $set });
    updated++;
  }
  return { updated };
}

export type PortfolioTimelineLane = {
  projectId: string;
  projectName: string;
  projectKey: string;
  startDate?: string;
  endDate?: string;
  milestoneCount: number;
  nextMilestone?: { name: string; dueDate: string };
  nextRelease?: { name: string; releaseDate: string };
  epicCount: number;
  datedIssueCount: number;
};

export async function getPortfolioTimeline(
  userId: string,
  taskflowOrganizationId: string | null | undefined
): Promise<PortfolioTimelineLane[]> {
  const projectObjectIds = await getProjectObjectIdsInWorkspace(userId, taskflowOrganizationId);
  if (projectObjectIds.length === 0) return [];

  const projects = await Project.find({ _id: { $in: projectObjectIds } })
    .select('name key versions issueTypes')
    .lean();

  const lanes: PortfolioTimelineLane[] = [];

  for (const proj of projects) {
    const pid = String(proj._id);
    const epicTypeNames = new Set(
      ((proj.issueTypes ?? []) as Array<{ name?: string }>)
        .filter((t) => /epic/i.test(String(t.name ?? '')))
        .map((t) => String(t.name))
    );
    if (epicTypeNames.size === 0) epicTypeNames.add('Epic');

    const [datedIssues, milestones, epicCount] = await Promise.all([
      Issue.find({
        project: proj._id,
        $or: [
          { startDate: { $exists: true, $ne: null } },
          { dueDate: { $exists: true, $ne: null } },
        ],
      })
        .select('startDate dueDate')
        .lean(),
      Milestone.find({ project: proj._id, dueDate: { $exists: true, $ne: null } })
        .sort({ dueDate: 1 })
        .limit(1)
        .select('name dueDate')
        .lean(),
      Issue.countDocuments({ project: proj._id, type: { $in: [...epicTypeNames] } }),
    ]);

    const dates: string[] = [];
    for (const i of datedIssues) {
      if (i.startDate) dates.push(isoDate(i.startDate as Date)!);
      if (i.dueDate) dates.push(isoDate(i.dueDate as Date)!);
    }

    const versions = (proj.versions ?? []) as Array<{
      id: string;
      name: string;
      releaseDate?: Date;
      status?: string;
    }>;
    const unreleased = versions
      .filter((v) => v.status !== 'released' && v.releaseDate)
      .sort((a, b) => new Date(a.releaseDate!).getTime() - new Date(b.releaseDate!).getTime());

    if (unreleased[0]?.releaseDate) {
      dates.push(isoDate(unreleased[0].releaseDate)!);
    }

    const range = computeRange(dates);
    const ms = milestones[0];

    lanes.push({
      projectId: pid,
      projectName: String(proj.name),
      projectKey: String(proj.key ?? ''),
      startDate: dates.length ? range.start : undefined,
      endDate: dates.length ? range.end : undefined,
      milestoneCount: await Milestone.countDocuments({ project: proj._id }),
      nextMilestone: ms
        ? { name: String(ms.name), dueDate: isoDate(ms.dueDate as Date)! }
        : undefined,
      nextRelease: unreleased[0]
        ? {
            name: String(unreleased[0].name),
            releaseDate: isoDate(unreleased[0].releaseDate)!,
          }
        : undefined,
      epicCount,
      datedIssueCount: datedIssues.length,
    });
  }

  return lanes.sort((a, b) => a.projectName.localeCompare(b.projectName));
}
