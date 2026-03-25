import { Report } from './report.model';
import { Issue } from '../issues/issue.model';
import { ApiError } from '../../utils/ApiError';
import * as dashboardService from '../dashboard/dashboard.service';
import { buildIssueMatch, parseReportFilters, type ReportFilters } from './reportFilters';

export type ReportType =
  | 'issues_by_status'
  | 'issues_by_type'
  | 'issues_by_priority'
  | 'issues_by_assignee'
  | 'workload'
  | 'defects';

export type { ReportFilters } from './reportFilters';

export interface ReportConfig {
  filters?: Record<string, unknown>;
  groupBy?: string;
  chartType?: 'bar' | 'pie' | 'table';
}

async function groupIssuesByField(
  userId: string,
  projectId: string | undefined,
  filters: ReportFilters,
  field: 'status' | 'type' | 'priority'
): Promise<Record<string, number>> {
  const match = await buildIssueMatch(userId, projectId, filters);
  if (!match) return {};
  const aggregationResult = await Issue.aggregate<{ _id: string | null; count: number }>([
    { $match: match },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
  ]);
  const out: Record<string, number> = {};
  for (const row of aggregationResult) {
    const key = row._id != null && row._id !== '' ? String(row._id) : 'Unknown';
    out[key] = row.count;
  }
  return out;
}

export async function listReports(userId: string): Promise<unknown[]> {
  const list = await Report.find({ user: userId })
    .populate('project', 'name key')
    .sort({ createdAt: -1 })
    .lean();
  return list;
}

export async function createReport(
  userId: string,
  input: { name: string; project?: string; type: ReportType; config?: ReportConfig }
): Promise<unknown> {
  const doc = await Report.create({
    user: userId,
    project: input.project ?? undefined,
    name: input.name,
    type: input.type,
    config: input.config ?? {},
  });
  return doc.toObject();
}

export async function updateReport(
  reportId: string,
  userId: string,
  input: Partial<{ name: string; project: string | null; type: ReportType; config: ReportConfig }>
): Promise<unknown | null> {
  const report = await Report.findOne({ _id: reportId, user: userId });
  if (!report) return null;
  const updateData: Record<string, unknown> = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.project !== undefined) updateData.project = input.project || null;
  if (input.type !== undefined) updateData.type = input.type;
  if (input.config !== undefined) updateData.config = input.config;
  const doc = await Report.findByIdAndUpdate(reportId, { $set: updateData }, { new: true }).lean();
  return doc;
}

export async function deleteReport(reportId: string, userId: string): Promise<boolean> {
  const result = await Report.deleteOne({ _id: reportId, user: userId });
  return result.deletedCount > 0;
}

export async function executeReport(reportId: string, userId: string): Promise<unknown> {
  const report = await Report.findById(reportId).lean();
  if (!report) throw new ApiError(404, 'Report not found');
  if (String(report.user) !== userId) throw new ApiError(403, 'Access denied');

  const projectId = report.project ? String(report.project) : undefined;
  const config = (report.config ?? {}) as ReportConfig;
  const filters = parseReportFilters(config.filters);

  switch (report.type) {
    case 'issues_by_status': {
      const issuesByStatus = await groupIssuesByField(userId, projectId, filters, 'status');
      return {
        type: 'issues_by_status',
        data: issuesByStatus,
        labels: Object.keys(issuesByStatus),
        values: Object.values(issuesByStatus),
      };
    }
    case 'issues_by_type': {
      const byType = await groupIssuesByField(userId, projectId, filters, 'type');
      return {
        type: 'issues_by_type',
        data: byType,
        labels: Object.keys(byType),
        values: Object.values(byType),
      };
    }
    case 'issues_by_priority': {
      const byPriority = await groupIssuesByField(userId, projectId, filters, 'priority');
      return {
        type: 'issues_by_priority',
        data: byPriority,
        labels: Object.keys(byPriority),
        values: Object.values(byPriority),
      };
    }
    case 'issues_by_assignee': {
      const workload = await dashboardService.getWorkloadStats(userId, projectId, filters);
      return {
        type: 'issues_by_assignee',
        data: workload.entries,
        labels: workload.entries.map((e) => e.userName),
        values: workload.entries.map((e) => e.totalCount),
      };
    }
    case 'workload': {
      const workload = await dashboardService.getWorkloadStats(userId, projectId, filters);
      return {
        type: 'workload',
        data: workload.entries,
        labels: workload.entries.map((e) => e.userName),
        values: workload.entries.map((e) => e.totalCount),
      };
    }
    case 'defects': {
      const defects = await dashboardService.getDefectMetrics(userId, projectId, filters);
      const byStatus = defects.byStatus;
      const byPriority = defects.byPriority;
      return {
        type: 'defects',
        data: {
          totalBugs: defects.totalBugs,
          openBugs: defects.openBugs,
          closedBugs: defects.closedBugs,
          defectDensity: defects.defectDensity,
        },
        byStatus: { labels: Object.keys(byStatus), values: Object.values(byStatus) },
        byPriority: { labels: Object.keys(byPriority), values: Object.values(byPriority) },
      };
    }
    default:
      throw new ApiError(400, 'Unknown report type');
  }
}
