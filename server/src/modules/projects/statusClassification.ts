import { Project } from './project.model';

const LEGACY_CLOSED_NAMES = ['done', 'closed', 'clossed', 'resolved', 'completed'];

type StatusLike = { name?: string; isClosed?: boolean };

export function inferClosedFromName(name: string): boolean {
  const normalized = String(name ?? '').trim().toLowerCase();
  return LEGACY_CLOSED_NAMES.some((token) => normalized === token || normalized.includes(token));
}

export function isClosedStatus(statusName: string, statuses?: StatusLike[]): boolean {
  const normalizedName = String(statusName ?? '').trim();
  if (!normalizedName) return false;
  const configured = (statuses ?? []).find((s) => String(s.name ?? '') === normalizedName);
  if (configured && configured.isClosed !== undefined) return Boolean(configured.isClosed);
  return inferClosedFromName(normalizedName);
}

export function getClosedStatusNamesFromStatuses(statuses?: StatusLike[]): string[] {
  const list = Array.isArray(statuses) ? statuses : [];
  if (list.length === 0) return ['Done', 'Closed', 'Resolved'];
  return list
    .filter((s) => isClosedStatus(String(s.name ?? ''), list))
    .map((s) => String(s.name ?? ''))
    .filter(Boolean);
}

export async function getClosedStatusNamesForProject(projectId: string): Promise<string[]> {
  const project = await Project.findById(projectId).select('statuses').lean();
  const names = getClosedStatusNamesFromStatuses((project as { statuses?: StatusLike[] } | null)?.statuses);
  return names.length > 0 ? names : ['Done', 'Closed', 'Resolved'];
}
