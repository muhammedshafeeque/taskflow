import mongoose from 'mongoose';
import { ProjectMember } from '../projects/projectMember.model';

/** Sentinel for "unassigned" in assigneeIds (client sends same string). */
export const REPORT_UNASSIGNED = '__unassigned__';

const MAX_FILTER_ARRAY = 50;

export interface ReportFilters {
  dateFrom?: string;
  dateTo?: string;
  dateField?: 'createdAt' | 'updatedAt';
  statuses?: string[];
  priorities?: string[];
  types?: string[];
  /** User ObjectId strings; use REPORT_UNASSIGNED to include issues with no assignee. */
  assigneeIds?: string[];
}

function trimStringArray(arr: unknown, max: number): string[] | undefined {
  if (!Array.isArray(arr)) return undefined;
  const out = arr
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
  return out.length ? out : undefined;
}

/**
 * Coerce stored config.filters into a safe ReportFilters object.
 */
export function parseReportFilters(raw: unknown): ReportFilters {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const dateField = o.dateField === 'createdAt' || o.dateField === 'updatedAt' ? o.dateField : undefined;
  const dateFrom = typeof o.dateFrom === 'string' ? o.dateFrom.trim() : undefined;
  const dateTo = typeof o.dateTo === 'string' ? o.dateTo.trim() : undefined;
  return {
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    dateField,
    statuses: trimStringArray(o.statuses, MAX_FILTER_ARRAY),
    priorities: trimStringArray(o.priorities, MAX_FILTER_ARRAY),
    types: trimStringArray(o.types, MAX_FILTER_ARRAY),
    assigneeIds: trimStringArray(o.assigneeIds, MAX_FILTER_ARRAY),
  };
}

function parseIsoDateDay(s: string): Date | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function endOfUtcDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 999);
  return x;
}

function startOfUtcDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

/**
 * Resolves allowed projects for the user, then builds a Mongo match for Issue.
 * Returns null if the user has no access (e.g. not a member of selected project).
 */
export async function buildIssueMatch(
  userId: string,
  projectId: string | undefined,
  filters: ReportFilters
): Promise<Record<string, unknown> | null> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  let projectIds: mongoose.Types.ObjectId[];
  if (projectId) {
    const isMember = await ProjectMember.exists({ user: userObjectId, project: projectId });
    if (!isMember) return null;
    projectIds = [new mongoose.Types.ObjectId(projectId)];
  } else {
    const ids = await ProjectMember.find({ user: userObjectId }).distinct('project');
    projectIds = ids.map((id) => new mongoose.Types.ObjectId(id));
  }
  if (projectIds.length === 0) return null;

  const match: Record<string, unknown> = { project: { $in: projectIds } };

  const dateField = filters.dateField ?? 'updatedAt';
  let fromD: Date | null = null;
  let toD: Date | null = null;
  if (filters.dateFrom) {
    fromD = parseIsoDateDay(filters.dateFrom);
    if (fromD) fromD = startOfUtcDay(fromD);
  }
  if (filters.dateTo) {
    toD = parseIsoDateDay(filters.dateTo);
    if (toD) toD = endOfUtcDay(toD);
  }
  if (fromD && toD && fromD > toD) {
    const tmp = fromD;
    fromD = toD;
    toD = tmp;
  }
  if (fromD || toD) {
    const range: Record<string, Date> = {};
    if (fromD) range.$gte = fromD;
    if (toD) range.$lte = toD;
    match[dateField] = range;
  }

  if (filters.statuses?.length) {
    match.status = { $in: filters.statuses };
  }
  if (filters.priorities?.length) {
    match.priority = { $in: filters.priorities };
  }
  if (filters.types?.length) {
    match.type = { $in: filters.types };
  }

  if (filters.assigneeIds?.length) {
    const wantUnassigned = filters.assigneeIds.includes(REPORT_UNASSIGNED);
    const oidStrings = filters.assigneeIds.filter((id) => id !== REPORT_UNASSIGNED && mongoose.Types.ObjectId.isValid(id));
    const objectIds = oidStrings.map((id) => new mongoose.Types.ObjectId(id));

    if (wantUnassigned && objectIds.length > 0) {
      match.$or = [
        { assignee: { $in: objectIds } },
        { assignee: null },
        { assignee: { $exists: false } },
      ];
    } else if (wantUnassigned) {
      match.$or = [{ assignee: null }, { assignee: { $exists: false } }];
    } else if (objectIds.length > 0) {
      match.assignee = { $in: objectIds };
    }
  }

  return match;
}
