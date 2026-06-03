import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import ForceGraph2D from 'react-force-graph-2d';
import { useAuth } from '../contexts/AuthContext';
import { projectsApi, type IssueGraphData, type Project } from '../lib/api';

const LINK_TYPE_OPTIONS = [
  { value: '', label: 'All link types' },
  { value: 'blocks,is_blocked_by', label: 'Blocks' },
  { value: 'duplicates,is_duplicated_by', label: 'Duplicates' },
  { value: 'relates_to', label: 'Related' },
];

export default function IssueLinkGraph() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { token } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 500 });
  const [project, setProject] = useState<Project | null>(null);
  const [graph, setGraph] = useState<IssueGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [linkTypes, setLinkTypes] = useState(searchParams.get('linkTypes') ?? '');
  const centerIssueId = searchParams.get('center') ?? undefined;
  const [depth, setDepth] = useState(
    searchParams.get('depth') ? parseInt(searchParams.get('depth')!, 10) : undefined
  );
  const [includeParent, setIncludeParent] = useState(searchParams.get('includeParent') !== 'false');

  useEffect(() => {
    if (!token || !projectId) return;
    projectsApi.get(projectId, token).then((res) => {
      if (res.success && res.data) setProject(res.data);
    });
  }, [token, projectId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setDims({ w: el.clientWidth, h: Math.max(400, window.innerHeight - 220) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!token || !projectId) return;
    setLoading(true);
    setError('');
    projectsApi
      .getLinkGraph(projectId, token, {
        linkTypes: linkTypes || undefined,
        centerIssueId,
        depth,
        includeParentEdges: includeParent,
      })
      .then((res) => {
        setLoading(false);
        if (res.success && res.data) setGraph(res.data);
        else setError(res.message ?? 'Failed to load');
      });
  }, [token, projectId, linkTypes, centerIssueId, depth, includeParent]);

  const graphData = graph
    ? {
        nodes: graph.nodes.map((n) => ({ ...n, id: n.id })),
        links: graph.edges.map((e) => ({ source: e.source, target: e.target, linkType: e.linkType })),
      }
    : { nodes: [], links: [] };

  function applyFilters() {
    const next = new URLSearchParams();
    if (linkTypes) next.set('linkTypes', linkTypes);
    if (centerIssueId) next.set('center', centerIssueId);
    if (depth != null) next.set('depth', String(depth));
    if (!includeParent) next.set('includeParent', 'false');
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 p-6">
      <div className="mb-4 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[color:var(--text-primary)]">
            Issue link graph {project ? `· ${project.name}` : ''}
          </h1>
          <p className="text-sm text-[color:var(--text-muted)]">
            {graphData.nodes.length} issues · {graphData.links.length} edges
          </p>
        </div>
        {projectId && (
          <Link
            to={`/projects/${projectId}/issues`}
            className="text-sm text-[color:var(--accent)] hover:underline"
          >
            ← Issues
          </Link>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-3 items-end">
        <label className="text-xs">
          <span className="block text-[color:var(--text-muted)] mb-1">Link types</span>
          <select
            value={linkTypes}
            onChange={(e) => setLinkTypes(e.target.value)}
            className="rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-2 py-1.5 text-sm"
          >
            {LINK_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-[color:var(--text-muted)] mb-1">Subgraph depth</span>
          <input
            type="number"
            min={1}
            max={5}
            placeholder="All"
            value={depth ?? ''}
            onChange={(e) => setDepth(e.target.value ? parseInt(e.target.value, 10) : undefined)}
            className="w-20 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs flex items-center gap-2 pb-1.5">
          <input
            type="checkbox"
            checked={includeParent}
            onChange={(e) => setIncludeParent(e.target.checked)}
          />
          Parent/child edges
        </label>
        <button type="button" onClick={applyFilters} className="btn-primary text-sm px-3 py-1.5 rounded-md">
          Apply
        </button>
      </div>

      <div
        ref={containerRef}
        className="flex-1 min-h-[400px] rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden"
      >
        {loading && (
          <p className="text-sm text-[color:var(--text-muted)] p-8 text-center">Loading graph…</p>
        )}
        {error && <p className="text-sm text-red-500 p-8 text-center">{error}</p>}
        {!loading && !error && graphData.nodes.length === 0 && (
          <p className="text-sm text-[color:var(--text-muted)] p-8 text-center">No issues to display.</p>
        )}
        {!loading && !error && graphData.nodes.length > 0 && (
          <ForceGraph2D
            width={dims.w}
            height={dims.h}
            graphData={graphData}
            nodeLabel={(n: { key?: string; title?: string }) => `${n.key}: ${n.title}`}
            nodeCanvasObject={(node, ctx, globalScale) => {
              const label = (node as { key?: string }).key ?? '';
              const fontSize = 11 / globalScale;
              ctx.font = `${fontSize}px Sans-Serif`;
              ctx.beginPath();
              ctx.arc(node.x!, node.y!, 5, 0, 2 * Math.PI);
              ctx.fillStyle = '#6366f1';
              ctx.fill();
              ctx.fillStyle = '#cbd5e1';
              ctx.fillText(label, node.x! + 7, node.y! + 3);
            }}
            linkDirectionalArrowLength={5}
            linkDirectionalArrowRelPos={1}
            linkColor={() => 'rgba(148,163,184,0.45)'}
            onNodeClick={(node) => {
              const n = node as { key?: string };
              if (projectId && n.key) {
                window.location.href = `/projects/${projectId}/issues/${encodeURIComponent(n.key)}`;
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
