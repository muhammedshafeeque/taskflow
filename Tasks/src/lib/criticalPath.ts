export type CpmTaskInput = {
  id: string;
  start: string;
  end: string;
  predecessors: string[];
};

export type CriticalPathResult = {
  criticalIds: Set<string>;
  projectEnd: number;
  slackById: Record<string, number>;
};

function parseDay(s: string): Date {
  const d = new Date(s.slice(0, 10));
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween(start: string, end: string): number {
  const a = parseDay(start).getTime();
  const b = parseDay(end).getTime();
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

export function computeCriticalPath(tasks: CpmTaskInput[]): CriticalPathResult {
  const ids = tasks.map((t) => t.id);
  const idSet = new Set(ids);
  const duration = new Map<string, number>();
  const preds = new Map<string, string[]>();

  for (const t of tasks) {
    duration.set(t.id, daysBetween(t.start, t.end));
    const p = (t.predecessors ?? []).filter((x) => idSet.has(x) && x !== t.id);
    preds.set(t.id, p);
  }

  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  const topo: string[] = [];
  const inDeg = new Map<string, number>();
  for (const id of ids) inDeg.set(id, 0);
  for (const id of ids) {
    inDeg.set(id, (preds.get(id) ?? []).length);
  }
  const queue = ids.filter((id) => (inDeg.get(id) ?? 0) === 0);
  while (queue.length) {
    const id = queue.shift()!;
    topo.push(id);
    for (const other of ids) {
      if ((preds.get(other) ?? []).includes(id)) {
        inDeg.set(other, (inDeg.get(other) ?? 1) - 1);
        if (inDeg.get(other) === 0) queue.push(other);
      }
    }
  }
  if (topo.length < ids.length) {
    for (const id of ids) {
      if (!topo.includes(id)) topo.push(id);
    }
  }

  for (const id of topo) {
    const d = duration.get(id) ?? 1;
    const predList = preds.get(id) ?? [];
    let start = 0;
    for (const p of predList) {
      start = Math.max(start, ef.get(p) ?? 0);
    }
    es.set(id, start);
    ef.set(id, start + d);
  }

  let projectEnd = 0;
  for (const id of ids) {
    projectEnd = Math.max(projectEnd, ef.get(id) ?? 0);
  }

  const ls = new Map<string, number>();
  const lf = new Map<string, number>();
  const succs = new Map<string, string[]>();
  for (const id of ids) succs.set(id, []);
  for (const id of ids) {
    for (const p of preds.get(id) ?? []) {
      succs.get(p)!.push(id);
    }
  }

  for (let i = topo.length - 1; i >= 0; i--) {
    const id = topo[i];
    const d = duration.get(id) ?? 1;
    const s = succs.get(id) ?? [];
    if (s.length === 0) {
      lf.set(id, projectEnd);
      ls.set(id, projectEnd - d);
    } else {
      let finish = Infinity;
      for (const n of s) {
        finish = Math.min(finish, ls.get(n) ?? projectEnd);
      }
      if (!Number.isFinite(finish)) finish = projectEnd;
      lf.set(id, finish);
      ls.set(id, finish - d);
    }
  }

  const criticalIds = new Set<string>();
  const slackById: Record<string, number> = {};
  for (const id of ids) {
    const slack = (ls.get(id) ?? 0) - (es.get(id) ?? 0);
    slackById[id] = slack;
    if (slack <= 0) criticalIds.add(id);
  }

  return { criticalIds, projectEnd, slackById };
}
