import { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import type { AuthPayload } from '../../types/express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as dashboardService from './dashboard.service';
import { ApiError } from '../../utils/ApiError';
import { formatMinutesForExport } from '../workLogs/workLogs.service';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';

export async function getDashboardStats(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const data = await dashboardService.getStatsForUser(userId, req.activeOrganizationId);
  res.status(200).json({ success: true, data });
}

export async function getWorkloadStats(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const projectId = req.query.projectId as string | undefined;
  const data = await dashboardService.getWorkloadStats(userId, projectId, undefined, req.activeOrganizationId);
  res.status(200).json({ success: true, data });
}

export async function getExecutiveStats(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const perms = req.user?.permissions ?? [];
  if (
    req.user?.role !== 'admin' &&
    !userHasPermission(perms, TASK_FLOW_PERMISSIONS.TASKFLOW.PLATFORM.EXECUTIVE.READ)
  ) {
    throw new ApiError(403, 'Insufficient permissions');
  }
  const data = await dashboardService.getExecutiveStats();
  res.status(200).json({ success: true, data });
}

export async function getPortfolioStats(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const data = await dashboardService.getPortfolioStats(userId, req.activeOrganizationId);
  res.status(200).json({ success: true, data });
}

export async function getDefectMetrics(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const projectId = req.query.projectId as string | undefined;
  const data = await dashboardService.getDefectMetrics(userId, projectId, undefined, req.activeOrganizationId);
  res.status(200).json({ success: true, data });
}

export async function getEstimatesStats(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const projectId = req.query.projectId as string | undefined;
  const data = await dashboardService.getEstimatesStats(userId, projectId, req.activeOrganizationId);
  res.status(200).json({ success: true, data });
}

export async function getProjectMetrics(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) throw new ApiError(400, 'projectId is required');
  const data = await dashboardService.getProjectMetrics(projectId, userId, req.activeOrganizationId);
  if (data === null) throw new ApiError(403, 'Access denied to this project');
  res.status(200).json({ success: true, data });
}

export async function getCostUsage(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const projectId = req.query.projectId as string | undefined;
  const fromStr = req.query.from as string | undefined;
  const toStr = req.query.to as string | undefined;
  const now = new Date();
  const from = fromStr ? new Date(fromStr) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = toStr ? new Date(toStr) : now;
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new ApiError(400, 'Invalid date range');
  }
  const data = await dashboardService.getCostUsageReport(userId, projectId, from, to, req.activeOrganizationId);
  res.status(200).json({ success: true, data });
}

export async function getPerformanceReportUsers(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const users = await dashboardService.getPerformanceReportTeammates(userId, req.activeOrganizationId);
  res.status(200).json({ success: true, data: { users } });
}

function parsePerformanceReportQuery(req: Request & { user?: AuthPayload }): {
  userId: string;
  from: Date;
  to: Date;
  targetUserIds: string[];
  filterProjectIds: string[] | undefined;
} {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const fromStr = req.query.from as string | undefined;
  const toStr = req.query.to as string | undefined;
  const userIdsRaw = req.query.userIds as string | undefined;
  const projectIdsRaw = req.query.projectIds as string | undefined;
  if (!fromStr || !toStr) {
    throw new ApiError(400, 'from and to date query parameters are required (YYYY-MM-DD)');
  }
  const from = new Date(fromStr);
  const to = new Date(toStr);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new ApiError(400, 'Invalid date range');
  }
  if (from.getTime() > to.getTime()) {
    throw new ApiError(400, 'from must be on or before to');
  }
  const targetUserIds = userIdsRaw
    ? userIdsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [userId];
  const filterProjectIds = projectIdsRaw
    ? projectIdsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  return { userId, from, to, targetUserIds, filterProjectIds };
}

export async function getPerformanceReport(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const { userId, from, to, targetUserIds, filterProjectIds } = parsePerformanceReportQuery(req);
  const data = await dashboardService.getPerformanceReport(
    userId,
    targetUserIds,
    from,
    to,
    filterProjectIds,
    req.activeOrganizationId
  );
  res.status(200).json({ success: true, data });
}

export async function exportPerformanceReportExcel(
  req: Request & { user?: AuthPayload },
  res: Response
): Promise<void> {
  const { userId, from, to, targetUserIds, filterProjectIds } = parsePerformanceReportQuery(req);
  const data = await dashboardService.getPerformanceReport(
    userId,
    targetUserIds,
    from,
    to,
    filterProjectIds,
    req.activeOrganizationId
  );

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Performance report');
  const headers = [
    'Member',
    'Project',
    'Issue key',
    'Title',
    'Updates',
    'Time logged (minutes)',
    'Time logged (formatted)',
    'Estimated (minutes)',
    'Status',
  ];
  sheet.addRow(headers);
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' },
  };

  for (const row of data.rows) {
    sheet.addRow([
      row.userName,
      row.projectName,
      row.issueKey,
      row.issueTitle,
      row.updates,
      row.timeLoggedMinutes,
      formatMinutesForExport(row.timeLoggedMinutes),
      row.estimatedMinutes ?? '',
      row.status,
    ]);
  }

  sheet.addRow([
    'Totals',
    '',
    '',
    '',
    data.totals.updates,
    data.totals.timeLoggedMinutes,
    formatMinutesForExport(data.totals.timeLoggedMinutes),
    data.totals.estimatedMinutes,
    '',
  ]);
  const totalsRow = sheet.getRow(sheet.rowCount);
  totalsRow.font = { bold: true };

  sheet.columns = [
    { width: 22 },
    { width: 22 },
    { width: 14 },
    { width: 40 },
    { width: 10 },
    { width: 18 },
    { width: 18 },
    { width: 16 },
    { width: 14 },
  ];

  const fromStr = (req.query.from as string).replace(/-/g, '');
  const toStr = (req.query.to as string).replace(/-/g, '');
  const filename = `performance_report_${fromStr}_to_${toStr}.xlsx`;
  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(Buffer.from(buffer));
}

export const getPerformanceReportUsersHandler = [asyncHandler(getPerformanceReportUsers)];
export const getPerformanceReportHandler = [asyncHandler(getPerformanceReport)];
export const exportPerformanceReportExcelHandler = [asyncHandler(exportPerformanceReportExcel)];
