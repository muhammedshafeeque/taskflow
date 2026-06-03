import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { projectsApi, issuesApi, type Project, type ProjectTimeline } from '../lib/api';
import { buildGanttTasks } from '../lib/ganttTimeline';
import FrappeGantt from 'frappe-gantt';

export default function GanttPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const ganttRef = useRef<InstanceType<typeof FrappeGantt> | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [timeline, setTimeline] = useState<ProjectTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [showMilestones, setShowMilestones] = useState(true);
  const [showBaseline, setShowBaseline] = useState(true);
  const [highlightCritical, setHighlightCritical] = useState(true);
  const [collapseSubtasks, setCollapseSubtasks] = useState(false);
  const [baselineSaving, setBaselineSaving] = useState(false);

  const load = useCallback(() => {
    if (!token || !projectId) return;
    setLoading(true);
    Promise.all([
      projectsApi.get(projectId, token),
      projectsApi.getTimeline(projectId, token),
    ]).then(([projRes, tlRes]) => {
      setLoading(false);
      if (projRes.success && projRes.data) setProject(projRes.data);
      if (tlRes.success && tlRes.data) setTimeline(tlRes.data);
      else setTimeline(null);
    });
  }, [token, projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const ganttTasks = timeline
    ? buildGanttTasks({
        timeline,
        showIssues: true,
        showMilestones,
        showBaseline,
        highlightCritical,
        collapseSubtasks,
      })
    : [];

  const [containerHeight, setContainerHeight] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateHeight = () => {
      const h = el.offsetHeight || el.getBoundingClientRect().height;
      if (h > 0) setContainerHeight(h);
    };
    updateHeight();
    const ro = new ResizeObserver((entries) => {
      const { height } = entries[0]?.contentRect ?? {};
      if (height && height > 0) setContainerHeight(height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ganttTasks.length]);

  useEffect(() => {
    if (!containerRef.current || ganttTasks.length === 0 || containerHeight <= 0 || !token) {
      if (ganttRef.current && containerRef.current) {
        ganttRef.current.clear?.();
        ganttRef.current = null;
      }
      return;
    }

    if (ganttRef.current) {
      ganttRef.current.clear?.();
      ganttRef.current = null;
    }

    const issueKeyById = new Map(timeline?.issues.map((i) => [i.id, i.key]) ?? []);

    const gantt = new FrappeGantt(containerRef.current, ganttTasks, {
      view_mode: 'Month',
      view_modes: ['Day', 'Week', 'Month'],
      readonly: false,
      container_height: containerHeight,
      on_click: (task: { id: string }) => {
        if (task.id.startsWith('baseline-') || task.id.startsWith('milestone-')) return;
        const key = issueKeyById.get(task.id);
        if (key && projectId) {
          navigate(`/projects/${projectId}/issues/${encodeURIComponent(key)}`);
        }
      },
      on_date_change: (task: { id: string; start: string; end: string }) => {
        if (!token || task.id.startsWith('baseline-') || task.id.startsWith('milestone-')) return;
        void issuesApi.update(
          task.id,
          { startDate: task.start, dueDate: task.end },
          token
        ).then(() => load());
      },
    });
    ganttRef.current = gantt;

    return () => {
      gantt.clear?.();
      ganttRef.current = null;
    };
  }, [ganttTasks, containerHeight, token, projectId, navigate, load, timeline]);

  async function handleSnapshotBaseline() {
    if (!token || !projectId) return;
    setBaselineSaving(true);
    const res = await projectsApi.snapshotTimelineBaseline(projectId, token);
    setBaselineSaving(false);
    if (res.success) load();
  }

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-sm text-[color:var(--text-muted)]">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col p-6">
      <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-[color:var(--text-primary)]">
          Gantt {project ? `· ${project.name}` : ''}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5 text-[color:var(--text-muted)]">
            <input type="checkbox" checked={showMilestones} onChange={(e) => setShowMilestones(e.target.checked)} />
            Milestones
          </label>
          <label className="flex items-center gap-1.5 text-[color:var(--text-muted)]">
            <input type="checkbox" checked={showBaseline} onChange={(e) => setShowBaseline(e.target.checked)} />
            Baseline
          </label>
          <label className="flex items-center gap-1.5 text-[color:var(--text-muted)]">
            <input type="checkbox" checked={highlightCritical} onChange={(e) => setHighlightCritical(e.target.checked)} />
            Critical path
          </label>
          <label className="flex items-center gap-1.5 text-[color:var(--text-muted)]">
            <input type="checkbox" checked={collapseSubtasks} onChange={(e) => setCollapseSubtasks(e.target.checked)} />
            Top-level only
          </label>
          <button
            type="button"
            disabled={baselineSaving}
            onClick={handleSnapshotBaseline}
            className="btn-secondary px-3 py-1.5 rounded-md text-xs"
          >
            {baselineSaving ? 'Saving…' : 'Set baseline from current'}
          </button>
        </div>
      </div>
      {highlightCritical && (
        <p className="text-[11px] text-[color:var(--text-muted)] mb-2 shrink-0">
          <span className="inline-block w-3 h-2 rounded-sm bg-red-500/80 mr-1 align-middle" />
          Critical path (zero slack, blocks dependencies)
        </p>
      )}
      {ganttTasks.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">
          No issues with start or due dates. Add dates on issues to see them on the Gantt chart.
        </p>
      ) : (
        <div ref={containerRef} className="gantt-wrapper flex-1 min-h-0" />
      )}
    </div>
  );
}
