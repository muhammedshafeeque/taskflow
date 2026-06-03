import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { Project, ProjectTimeline } from '../../lib/api';

export type LaneMode = 'epic' | 'release' | 'milestone';

type Lane = { id: string; label: string; sortOrder: number };

type BarItem = {
  id: string;
  label: string;
  start: string;
  end: string;
  issueKey?: string;
  isBaseline?: boolean;
  isRelease?: boolean;
  isMilestone?: boolean;
};

function resolveRange(startDate?: string, dueDate?: string): { start: string; end: string } | null {
  if (startDate && dueDate) return { start: startDate.slice(0, 10), end: dueDate.slice(0, 10) };
  if (dueDate) {
    const end = dueDate.slice(0, 10);
    const d = new Date(end);
    d.setDate(d.getDate() - 7);
    return { start: d.toISOString().slice(0, 10), end };
  }
  if (startDate) {
    const start = startDate.slice(0, 10);
    const d = new Date(start);
    d.setDate(d.getDate() + 3);
    return { start, end: d.toISOString().slice(0, 10) };
  }
  return null;
}

function dayMs(d: string): number {
  return new Date(d.slice(0, 10)).getTime();
}

function positionPct(date: string, rangeStart: string, rangeEnd: string): number {
  const s = dayMs(rangeStart);
  const e = dayMs(rangeEnd);
  const t = dayMs(date);
  if (e <= s) return 0;
  return Math.max(0, Math.min(100, ((t - s) / (e - s)) * 100));
}

function widthPct(start: string, end: string, rangeStart: string, rangeEnd: string): number {
  const left = positionPct(start, rangeStart, rangeEnd);
  const right = positionPct(end, rangeStart, rangeEnd);
  return Math.max(0.8, right - left);
}

export default function RoadmapLanes({
  timeline,
  project,
  projectId,
  laneMode,
  milestoneFilterIds,
}: {
  timeline: ProjectTimeline;
  project: Project | null;
  projectId: string;
  laneMode: LaneMode;
  milestoneFilterIds?: Set<string>;
}) {
  const epicTypeNames = useMemo(() => {
    const names = new Set(
      (project?.issueTypes ?? [])
        .filter((t) => /epic/i.test(t.name))
        .map((t) => t.name)
    );
    if (names.size === 0) names.add('Epic');
    return names;
  }, [project]);

  const versionNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of project?.versions ?? []) m.set(v.id, v.name);
    return m;
  }, [project]);

  const milestoneNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const ms of timeline.milestones) m.set(ms.id, ms.name);
    return m;
  }, [timeline.milestones]);

  const { lanes, barsByLane } = useMemo(() => {
    const laneMap = new Map<string, Lane>();
    const bars = new Map<string, BarItem[]>();

    const ensureLane = (id: string, label: string, order: number) => {
      if (!laneMap.has(id)) laneMap.set(id, { id, label, sortOrder: order });
      if (!bars.has(id)) bars.set(id, []);
    };

    const epicIssues = timeline.issues.filter((i) => epicTypeNames.has(i.type));
    const epicIdSet = new Set(epicIssues.map((e) => e.id));

    const resolveEpicLane = (issue: (typeof timeline.issues)[0]): string => {
      let cur = issue.parentId;
      while (cur) {
        if (epicIdSet.has(cur)) return cur;
        const parent = timeline.issues.find((i) => i.id === cur);
        cur = parent?.parentId;
      }
      return '__none__';
    };

    if (laneMode === 'epic') {
      for (const epic of epicIssues) {
        ensureLane(epic.id, `${epic.key} ${epic.title}`.slice(0, 48), 0);
      }
      ensureLane('__none__', 'No epic', 9999);
      for (const issue of timeline.issues) {
        if (milestoneFilterIds?.size && issue.milestoneId && !milestoneFilterIds.has(issue.milestoneId)) {
          continue;
        }
        const laneId = epicIdSet.has(issue.id) ? issue.id : resolveEpicLane(issue);
        const lane = laneId === '__none__' ? '__none__' : laneId;
        if (epicIdSet.has(issue.id) && issue.parentId) continue;
        const range = resolveRange(issue.startDate, issue.dueDate);
        if (!range) continue;
        ensureLane(lane, laneMap.get(lane)?.label ?? 'No epic', laneMap.get(lane)?.sortOrder ?? 9999);
        bars.get(lane)!.push({
          id: issue.id,
          label: issue.title,
          start: range.start,
          end: range.end,
          issueKey: issue.key,
        });
        const bRange = resolveRange(issue.baselineStartDate, issue.baselineDueDate);
        if (bRange) {
          bars.get(lane)!.push({
            id: `b-${issue.id}`,
            label: `${issue.key} baseline`,
            start: bRange.start,
            end: bRange.end,
            issueKey: issue.key,
            isBaseline: true,
          });
        }
      }
    } else if (laneMode === 'release') {
      for (const v of timeline.versions) {
        ensureLane(v.id, v.name, v.order ?? project?.versions?.find((pv) => pv.id === v.id)?.order ?? 0);
      }
      ensureLane('__none__', 'Unscheduled', 9999);
      for (const issue of timeline.issues) {
        if (milestoneFilterIds?.size && issue.milestoneId && !milestoneFilterIds.has(issue.milestoneId)) {
          continue;
        }
        const vid = issue.fixVersionIds[0] ?? '__none__';
        const range = resolveRange(issue.startDate, issue.dueDate);
        if (!range) continue;
        const label = vid === '__none__' ? 'Unscheduled' : versionNameById.get(vid) ?? vid;
        ensureLane(vid, label, vid === '__none__' ? 9999 : 0);
        bars.get(vid)!.push({
          id: issue.id,
          label: issue.title,
          start: range.start,
          end: range.end,
          issueKey: issue.key,
        });
      }
      for (const v of timeline.versions) {
        if (!v.releaseDate) continue;
        const d = v.releaseDate.slice(0, 10);
        bars.get(v.id)?.push({
          id: `rel-${v.id}`,
          label: `Release ${v.name}`,
          start: d,
          end: d,
          isRelease: true,
        });
      }
    } else {
      for (const m of timeline.milestones) {
        ensureLane(m.id, m.name, 0);
      }
      ensureLane('__none__', 'No milestone', 9999);
      for (const issue of timeline.issues) {
        const mid = issue.milestoneId ?? '__none__';
        if (milestoneFilterIds?.size && mid !== '__none__' && !milestoneFilterIds.has(mid)) continue;
        const range = resolveRange(issue.startDate, issue.dueDate);
        if (!range) continue;
        const label = mid === '__none__' ? 'No milestone' : milestoneNameById.get(mid) ?? mid;
        ensureLane(mid, label, mid === '__none__' ? 9999 : 0);
        bars.get(mid)!.push({
          id: issue.id,
          label: issue.title,
          start: range.start,
          end: range.end,
          issueKey: issue.key,
        });
      }
      for (const m of timeline.milestones) {
        if (!m.dueDate) continue;
        const d = m.dueDate.slice(0, 10);
        bars.get(m.id)?.push({
          id: `ms-${m.id}`,
          label: m.name,
          start: d,
          end: d,
          isMilestone: true,
        });
      }
    }

    const sortedLanes = [...laneMap.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
    return { lanes: sortedLanes, barsByLane: bars };
  }, [timeline, laneMode, epicTypeNames, versionNameById, milestoneNameById, milestoneFilterIds]);

  const { start: rangeStart, end: rangeEnd } = timeline.range;

  if (lanes.length === 0) {
    return <p className="text-sm text-[color:var(--text-muted)]">No lanes to display.</p>;
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col border border-[color:var(--border-subtle)] rounded-lg overflow-hidden bg-[color:var(--bg-surface)]">
      <div className="grid grid-cols-[200px_1fr] border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] text-[10px] text-[color:var(--text-muted)] shrink-0">
        <div className="px-3 py-2 font-semibold">Lane</div>
        <div className="px-3 py-2 flex justify-between">
          <span>{rangeStart}</span>
          <span>{rangeEnd}</span>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {lanes.map((lane) => {
          const items = barsByLane.get(lane.id) ?? [];
          if (items.length === 0) return null;
          return (
            <div key={lane.id} className="grid grid-cols-[200px_1fr] border-b border-[color:var(--border-subtle)]/60 min-h-[44px]">
              <div className="px-3 py-2 text-xs font-medium text-[color:var(--text-primary)] truncate" title={lane.label}>
                {lane.label}
              </div>
              <div className="relative h-11 mx-2 my-1 bg-[color:var(--bg-page)]/50 rounded">
                {items.map((bar) => {
                  const left = positionPct(bar.start, rangeStart, rangeEnd);
                  const width = widthPct(bar.start, bar.end, rangeStart, rangeEnd);
                  const className = bar.isBaseline
                    ? 'roadmap-bar-baseline'
                    : bar.isRelease
                      ? 'roadmap-bar-release'
                      : bar.isMilestone
                        ? 'roadmap-bar-milestone'
                        : 'roadmap-bar-issue';
                  const inner = (
                    <div
                      className={`absolute top-1/2 -translate-y-1/2 h-5 rounded-sm ${className} overflow-hidden`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={bar.label}
                    />
                  );
                  if (bar.issueKey && !bar.isBaseline && !bar.isRelease && !bar.isMilestone) {
                    return (
                      <Link
                        key={bar.id}
                        to={`/projects/${projectId}/issues/${encodeURIComponent(bar.issueKey)}`}
                        className="block"
                      >
                        {inner}
                      </Link>
                    );
                  }
                  return <div key={bar.id}>{inner}</div>;
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
