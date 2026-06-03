import type { IssueLinkType } from '../issues/issueLink.model';

export type SchedulingEdge = { from: string; to: string };

/** Normalize issue links to predecessor → dependent edges for CPM (blocks only). */
export function normalizeSchedulingDependencies(
  links: Array<{ sourceIssue: string; targetIssue: string; linkType: IssueLinkType }>,
  issueIdSet: Set<string>
): SchedulingEdge[] {
  const edges: SchedulingEdge[] = [];
  const seen = new Set<string>();

  for (const link of links) {
    const source = String(link.sourceIssue);
    const target = String(link.targetIssue);
    if (!issueIdSet.has(source) || !issueIdSet.has(target)) continue;

    let from = '';
    let to = '';
    if (link.linkType === 'blocks') {
      from = target;
      to = source;
    } else if (link.linkType === 'is_blocked_by') {
      from = source;
      to = target;
    } else {
      continue;
    }

    const key = `${from}->${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from, to });
  }

  return edges;
}
