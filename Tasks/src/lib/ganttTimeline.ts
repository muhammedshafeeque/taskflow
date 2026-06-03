import type { ProjectTimeline } from './api';
import { computeCriticalPath } from './criticalPath';

export type GanttTaskRow = {
  id: string;
  name: string;
  start: string;
  end: string;
  progress: number;
  dependencies?: string;
  custom_class?: string;
};

function resolveStartEnd(startDate?: string, dueDate?: string): { start: string; end: string } | null {
  if (startDate && dueDate) {
    return { start: startDate.slice(0, 10), end: dueDate.slice(0, 10) };
  }
  if (dueDate) {
    const end = dueDate.slice(0, 10);
    const d = new Date(end);
    d.setDate(d.getDate() - 7);
    return { start: d.toISOString().slice(0, 10), end };
  }
  if (startDate) {
    const start = startDate.slice(0, 10);
    const d = new Date(start);
    d.setDate(d.getDate() + 1);
    return { start, end: d.toISOString().slice(0, 10) };
  }
  return null;
}

function depthOf(id: string, parentMap: Map<string, string>): number {
  let d = 0;
  let cur = parentMap.get(id);
  while (cur && d < 20) {
    d++;
    cur = parentMap.get(cur);
  }
  return d;
}

export type BuildGanttOptions = {
  showIssues?: boolean;
  showMilestones?: boolean;
  showBaseline?: boolean;
  highlightCritical?: boolean;
  collapseSubtasks?: boolean;
  timeline: ProjectTimeline;
};

export function buildGanttTasks(options: BuildGanttOptions): GanttTaskRow[] {
  const {
    showIssues = true,
    showMilestones = false,
    showBaseline = true,
    highlightCritical = true,
    collapseSubtasks = false,
    timeline,
  } = options;

  const parentMap = new Map<string, string>();
  const hasChild = new Set<string>();
  for (const e of timeline.parentEdges) {
    parentMap.set(e.childId, e.parentId);
    hasChild.add(e.parentId);
  }

  const predMap = new Map<string, string[]>();
  for (const d of timeline.dependencies) {
    const list = predMap.get(d.to) ?? [];
    list.push(d.from);
    predMap.set(d.to, list);
  }

  const issueRows = timeline.issues.filter((i) => {
    if (!i.startDate && !i.dueDate) return false;
    if (collapseSubtasks && parentMap.has(i.id)) return false;
    return true;
  });

  const cpmInput = issueRows
    .map((i) => {
      const range = resolveStartEnd(i.startDate, i.dueDate);
      if (!range) return null;
      return {
        id: i.id,
        start: range.start,
        end: range.end,
        predecessors: predMap.get(i.id) ?? [],
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  const cpm = highlightCritical ? computeCriticalPath(cpmInput) : null;
  const tasks: GanttTaskRow[] = [];

  if (showIssues) {
    for (const issue of issueRows) {
      const range = resolveStartEnd(issue.startDate, issue.dueDate);
      if (!range) continue;
      const indent = '  '.repeat(depthOf(issue.id, parentMap));
      const preds = predMap.get(issue.id);
      const classes: string[] = [];
      if (cpm?.criticalIds.has(issue.id)) classes.push('gantt-critical');
      tasks.push({
        id: issue.id,
        name: `${indent}${issue.key} ${issue.title}`.slice(0, 80),
        start: range.start,
        end: range.end,
        progress: issue.progress,
        dependencies: preds?.length ? preds.join(',') : undefined,
        custom_class: classes.length ? classes.join(' ') : undefined,
      });

      if (showBaseline) {
        const bRange = resolveStartEnd(issue.baselineStartDate, issue.baselineDueDate);
        if (bRange) {
          tasks.push({
            id: `baseline-${issue.id}`,
            name: `${indent}${issue.key} (baseline)`.slice(0, 80),
            start: bRange.start,
            end: bRange.end,
            progress: 0,
            custom_class: 'gantt-baseline',
          });
        }
      }
    }
  }

  if (showMilestones) {
    for (const m of timeline.milestones) {
      if (!m.dueDate) continue;
      const end = m.dueDate.slice(0, 10);
      const d = new Date(end);
      d.setDate(d.getDate() - 3);
      tasks.push({
        id: `milestone-${m.id}`,
        name: `◆ ${m.name}`.slice(0, 60),
        start: d.toISOString().slice(0, 10),
        end,
        progress: m.status === 'done' ? 100 : 0,
        custom_class: 'gantt-milestone',
      });
    }
  }

  return tasks;
}
