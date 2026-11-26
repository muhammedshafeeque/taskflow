export interface OrgPerson {
  _id: string;
  name: string;
  status: string;
  managerId?: string | null;
}

export interface OrgNode<T extends OrgPerson> {
  person: T;
  reports: OrgNode<T>[];
  /** Everyone below, at any depth. */
  total: number;
}

/**
 * Who reports to whom, without leavers. People whose manager has left or is unknown start their own line, and
 * so does one person of any circular line left in old data, so nobody disappears.
 */
export function buildOrgTree<T extends OrgPerson>(all: T[]): OrgNode<T>[] {
  const people = all.filter((p) => p.status !== 'terminated');
  const byId = new Map(people.map((p) => [p._id, p]));
  const reportsOf = new Map<string, T[]>();
  for (const p of people) {
    if (p.managerId && p.managerId !== p._id && byId.has(p.managerId)) reportsOf.set(p.managerId, [...(reportsOf.get(p.managerId) ?? []), p]);
  }
  const placed = new Set<string>();
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  const build = (person: T): OrgNode<T> => {
    placed.add(person._id);
    const reports: OrgNode<T>[] = [];
    for (const r of [...(reportsOf.get(person._id) ?? [])].sort(byName)) if (!placed.has(r._id)) reports.push(build(r));
    return { person, reports, total: reports.reduce((s, r) => s + 1 + r.total, 0) };
  };
  const isRoot = (p: T) => !p.managerId || p.managerId === p._id || !byId.has(p.managerId);
  const roots = people.filter(isRoot).sort(byName).map(build);
  for (const p of [...people].sort(byName)) if (!placed.has(p._id)) roots.push(build(p));
  return roots;
}
