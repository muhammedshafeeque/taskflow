import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { projectsApi, roadmapsApi, type Project, type Roadmap, type ProjectTimeline } from '../lib/api';
import RoadmapLanes, { type LaneMode } from '../components/roadmap/RoadmapLanes';

export default function RoadmapPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { token } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [timeline, setTimeline] = useState<ProjectTimeline | null>(null);
  const [roadmaps, setRoadmaps] = useState<Roadmap[]>([]);
  const [selectedRoadmapId, setSelectedRoadmapId] = useState<string | null>(null);
  const [laneMode, setLaneMode] = useState<LaneMode>('epic');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || !projectId) return;
    setLoading(true);
    Promise.all([
      projectsApi.get(projectId, token),
      projectsApi.getTimeline(projectId, token),
      roadmapsApi.list(projectId, token),
    ]).then(([projRes, tlRes, roadRes]) => {
      setLoading(false);
      if (projRes.success && projRes.data) setProject(projRes.data);
      if (tlRes.success && tlRes.data) setTimeline(tlRes.data);
      if (roadRes.success && roadRes.data) {
        const list = Array.isArray(roadRes.data) ? roadRes.data : [];
        setRoadmaps(list);
        if (list.length && !selectedRoadmapId) setSelectedRoadmapId(list[0]._id);
      }
    });
  }, [token, projectId]);

  const milestoneFilterIds = useMemo(() => {
    if (!selectedRoadmapId) return undefined;
    const r = roadmaps.find((x) => x._id === selectedRoadmapId);
    if (!r?.milestoneIds?.length) return undefined;
    return new Set(r.milestoneIds);
  }, [selectedRoadmapId, roadmaps]);

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-sm text-[color:var(--text-muted)]">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col p-6">
      <div className="mb-4 flex shrink-0 items-center justify-between flex-wrap gap-4">
        <h1 className="text-lg font-semibold text-[color:var(--text-primary)]">
          Roadmap {project ? `· ${project.name}` : ''}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={laneMode}
            onChange={(e) => setLaneMode(e.target.value as LaneMode)}
            className="px-3 py-1.5 rounded-md bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] text-sm"
          >
            <option value="epic">By epic</option>
            <option value="release">By release</option>
            <option value="milestone">By milestone</option>
          </select>
          {roadmaps.length > 0 && (
            <select
              value={selectedRoadmapId ?? ''}
              onChange={(e) => setSelectedRoadmapId(e.target.value || null)}
              className="px-3 py-1.5 rounded-md bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] text-sm"
            >
              <option value="">All milestones</option>
              {roadmaps.map((r) => (
                <option key={r._id} value={r._id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      {!timeline ? (
        <p className="text-sm text-[color:var(--text-muted)]">Failed to load timeline data.</p>
      ) : (
        <RoadmapLanes
          timeline={timeline}
          project={project}
          projectId={projectId!}
          laneMode={laneMode}
          milestoneFilterIds={milestoneFilterIds}
        />
      )}
    </div>
  );
}
