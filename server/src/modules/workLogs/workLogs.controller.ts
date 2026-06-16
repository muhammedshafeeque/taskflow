import { Request, Response } from 'express';
import type { AuthPayload } from '../../types/express';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import {
  createWorkLogSchema,
  updateWorkLogSchema,
  workLogIdParamSchema,
  issueIdOnlyParamSchema,
  globalTimesheetQuerySchema,
  timesheetDetailsQuerySchema,
  timesheetExportQuerySchema,
} from './workLogs.validation';
import * as workLogsService from './workLogs.service';
import { ApiError } from '../../utils/ApiError';

function parseDateOrToday(raw?: string): Date {
  if (!raw) return new Date();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return new Date();
  return d;
}

export async function createWorkLog(req: Request, res: Response): Promise<void> {
  const authorId = req.user?.id;
  if (!authorId) throw new ApiError(401, 'Unauthorized');
  const { minutesSpent, date, description, laneId, overrunReason } = req.body as {
    minutesSpent: number;
    date: string;
    description?: string;
    laneId?: string;
    overrunReason?: string;
  };
  const doc = await workLogsService.create(
    req.params.issueId,
    authorId,
    minutesSpent,
    parseDateOrToday(date),
    description,
    {
      laneId,
      overrunReason,
      memberPermissions: (req as Request & { projectPermissions?: string[] }).projectPermissions,
      userGlobalPermissions: req.user?.permissions,
      activeOrganizationId: (req as Request & { activeOrganizationId?: string }).activeOrganizationId,
    }
  );
  res.status(201).json({ success: true, data: doc });
}

export async function getWorkLogs(req: Request, res: Response): Promise<void> {
  const page = parseInt(String(req.query.page), 10) || 1;
  const limit = Math.min(parseInt(String(req.query.limit), 10) || 20, 100);
  const result = await workLogsService.findByIssue(req.params.issueId, { page, limit });
  res.status(200).json({ success: true, data: result });
}

export async function updateWorkLog(req: Request, res: Response): Promise<void> {
  const authorId = req.user?.id;
  if (!authorId) throw new ApiError(401, 'Unauthorized');
  const { minutesSpent, date, description } = req.body as {
    minutesSpent?: number;
    date?: string;
    description?: string;
  };
  const update: {
    minutesSpent?: number;
    date?: Date;
    description?: string;
  } = {};
  if (typeof minutesSpent === 'number') update.minutesSpent = minutesSpent;
  if (typeof date === 'string') update.date = parseDateOrToday(date);
  if (typeof description === 'string') update.description = description;

  const workLog = await workLogsService.update(
    req.params.id,
    req.params.issueId,
    authorId,
    update
  );
  if (!workLog) throw new ApiError(404, 'Work log not found');
  res.status(200).json({ success: true, data: workLog });
}

export async function deleteWorkLog(req: Request, res: Response): Promise<void> {
  const authorId = req.user?.id;
  if (!authorId) throw new ApiError(401, 'Unauthorized');
  const deleted = await workLogsService.remove(
    req.params.id,
    req.params.issueId,
    authorId
  );
  if (!deleted) throw new ApiError(404, 'Work log not found');
  res.status(200).json({ success: true, data: { message: 'Work log deleted' } });
}

export const createWorkLogHandler = [
  validate(createWorkLogSchema.shape.params, 'params'),
  validate(createWorkLogSchema.shape.body, 'body'),
  asyncHandler(createWorkLog),
];

export const updateWorkLogHandler = [
  validate(updateWorkLogSchema.shape.params, 'params'),
  validate(updateWorkLogSchema.shape.body, 'body'),
  asyncHandler(updateWorkLog),
];

export const workLogIdParamHandler = [
  validate(workLogIdParamSchema.shape.params, 'params'),
];

export const issueIdParamHandler = [
  validate(issueIdOnlyParamSchema.shape.params, 'params'),
];

export async function getGlobalTimesheet(req: Request & { user?: AuthPayload; activeOrganizationId?: string }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');

  const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date(end);
  if (!startDate) start.setDate(end.getDate() - 6);

  const data = await workLogsService.getGlobalTimesheet(userId, start, end, req.activeOrganizationId);
  res.status(200).json({ success: true, data });
}

export const globalTimesheetHandler = [
  validate(globalTimesheetQuerySchema.shape.query, 'query'),
  asyncHandler(getGlobalTimesheet),
];

export async function getTimesheetDetails(req: Request & { user?: AuthPayload; activeOrganizationId?: string }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');

  const { userId: targetUserId, date } = req.query as { userId: string; date: string };
  const data = await workLogsService.getTimesheetDetails(userId, targetUserId, date, req.activeOrganizationId);
  res.status(200).json({ success: true, data });
}

export const timesheetDetailsHandler = [
  validate(timesheetDetailsQuerySchema.shape.query, 'query'),
  asyncHandler(getTimesheetDetails),
];

export async function exportTimesheetExcel(req: Request & { user?: AuthPayload; activeOrganizationId?: string }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');

  const { startDate, endDate } = req.query as { startDate: string; endDate: string };
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ApiError(400, 'Invalid startDate or endDate');
  }
  if (start > end) throw new ApiError(400, 'startDate must be before endDate');

  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Timesheet', { views: [{ state: 'frozen', ySplit: 1 }] });

  const data = await workLogsService.getTimesheetExportData(userId, start, end, req.activeOrganizationId);

  const headers = [
    'User',
    'Date',
    'Issue Key',
    'Issue Title',
    'Project',
    'Time (minutes)',
    'Time (formatted)',
    'Remark',
    'Created At',
  ];
  sheet.addRow(headers);
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' },
  };

  for (const row of data) {
    const timeFormatted = workLogsService.formatMinutesForExport(row.minutesSpent);
    sheet.addRow([
      row.authorName,
      row.date,
      row.issueKey,
      row.issueTitle,
      row.projectName,
      row.minutesSpent,
      timeFormatted,
      row.description ?? '',
      row.createdAt,
    ]);
  }

  sheet.columns = [
    { width: 18 },
    { width: 12 },
    { width: 14 },
    { width: 40 },
    { width: 20 },
    { width: 14 },
    { width: 14 },
    { width: 30 },
    { width: 22 },
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `timesheet_${startDate}_to_${endDate}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(Buffer.from(buffer));
}

export const timesheetExportHandler = [
  validate(timesheetExportQuerySchema.shape.query, 'query'),
  asyncHandler(exportTimesheetExcel),
];

