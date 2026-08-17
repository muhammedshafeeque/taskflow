const LEGACY_CLOSED = ['done', 'closed', 'clossed', 'resolved', 'completed'];

export function inferClosedFromName(name: string): boolean {
  const normalized = String(name ?? '').trim().toLowerCase();
  return LEGACY_CLOSED.some((token) => normalized === token || normalized.includes(token));
}

export function isClosedStatus(
  statusName: string,
  statuses?: Array<{ name?: string; isClosed?: boolean }>
): boolean {
  const normalizedName = String(statusName ?? '').trim();
  if (!normalizedName) return false;
  const configured = (statuses ?? []).find((s) => String(s.name ?? '') === normalizedName);
  if (configured && configured.isClosed !== undefined) return Boolean(configured.isClosed);
  return inferClosedFromName(normalizedName);
}

export function getClosedStatusNames(statuses?: Array<{ name?: string; isClosed?: boolean }>): string[] {
  const list = Array.isArray(statuses) ? statuses : [];
  if (list.length === 0) return ['Done', 'Closed', 'Resolved'];
  return list
    .filter((s) => isClosedStatus(String(s.name ?? ''), list))
    .map((s) => String(s.name ?? ''))
    .filter(Boolean);
}

export function findInProgressStatus(statuses?: Array<{ name?: string; isClosed?: boolean }>): string | undefined {
  const list = statuses ?? [];
  const open = list.filter((s) => !isClosedStatus(String(s.name ?? ''), list));
  const preferred = open.find((s) => /progress|doing|active|started/i.test(String(s.name ?? '')));
  return preferred?.name ?? open.find((s) => !/backlog|todo|to do|open/i.test(String(s.name ?? '')))?.name;
}
