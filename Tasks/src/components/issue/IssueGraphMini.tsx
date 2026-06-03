import { useEffect, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { Link } from 'react-router-dom';
import { projectsApi, type IssueGraphData, getIssueKey, type Issue } from '../../lib/api';

interface IssueGraphMiniProps {
  projectId: string;
  issue: Issue;
  token: string;
}

export default function IssueGraphMini({ projectId, issue, token }: IssueGraphMiniProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 400, h: 280 });
  const [graph, setGraph] = useState<IssueGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setDims({ w: el.clientWidth || 400, h: 280 });
    });
    ro.observe(el);
    setDims({ w: el.clientWidth || 400, h: 280 });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setLoading(true);
    projectsApi
      .getLinkGraph(projectId, token, {
        centerIssueId: issue._id,
        depth: 2,
        includeParentEdges: true,
      })
      .then((res) => {
        setLoading(false);
        if (res.success && res.data) setGraph(res.data);
        else setError(res.message ?? 'Failed to load graph');
      });
  }, [projectId, issue._id, token]);

  const graphData = graph
    ? {
        nodes: graph.nodes.map((n) => ({
          ...n,
          id: n.id,
          color: n.id === issue._id ? 'var(--accent)' : undefined,
        })),
        links: graph.edges.map((e) => ({
          source: e.source,
          target: e.target,
          linkType: e.linkType,
        })),
      }
    : { nodes: [], links: [] };

  const ticketKey = getIssueKey(issue);

  return (
    <div ref={containerRef} className="w-full">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] text-[color:var(--text-muted)]">Links and hierarchy within 2 hops</p>
        <Link
          to={`/projects/${projectId}/link-graph?center=${encodeURIComponent(issue._id)}`}
          className="text-[11px] font-medium text-[color:var(--accent)] hover:underline"
        >
          Open full graph
        </Link>
      </div>
      {loading && <p className="text-xs text-[color:var(--text-muted)] py-8 text-center">Loading graph…</p>}
      {error && <p className="text-xs text-red-500 py-4">{error}</p>}
      {!loading && !error && graphData.nodes.length === 0 && (
        <p className="text-xs text-[color:var(--text-muted)] py-8 text-center">No linked issues in range.</p>
      )}
      {!loading && !error && graphData.nodes.length > 0 && (
        <ForceGraph2D
          width={dims.w}
          height={dims.h}
          graphData={graphData}
          nodeLabel={(n: { key?: string; title?: string }) => `${n.key ?? ''}: ${n.title ?? ''}`}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const label = (node as { key?: string }).key ?? '';
            const fontSize = 10 / globalScale;
            ctx.font = `${fontSize}px Sans-Serif`;
            const isCenter = (node as { id?: string }).id === issue._id;
            ctx.beginPath();
            ctx.arc(node.x!, node.y!, isCenter ? 6 : 4, 0, 2 * Math.PI);
            ctx.fillStyle = isCenter ? '#6366f1' : '#94a3b8';
            ctx.fill();
            ctx.fillStyle = '#e2e8f0';
            ctx.fillText(label, node.x! + 8, node.y! + 3);
          }}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          linkColor={() => 'rgba(148,163,184,0.5)'}
          onNodeClick={(node) => {
            const n = node as { id?: string | number; key?: string };
            if (n.id && String(n.id) !== issue._id && n.key) {
              window.location.href = `/projects/${projectId}/issues/${encodeURIComponent(n.key)}`;
            }
          }}
        />
      )}
      <p className="text-[10px] text-[color:var(--text-muted)] mt-1">Center: {ticketKey}</p>
    </div>
  );
}
