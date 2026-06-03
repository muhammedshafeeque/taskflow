import mongoose from 'mongoose';
import { Issue } from './issue.model';
import { IssueLink } from './issueLink.model';
import { ProjectMember } from '../projects/projectMember.model';
import { ApiError } from '../../utils/ApiError';
import type { IssueLinkType } from './issueLink.model';

export type GraphNode = {
  id: string;
  key: string;
  title: string;
  type: string;
  status: string;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  linkType: string;
  synthetic?: boolean;
};

export type IssueGraphResult = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

function parseLinkTypes(raw?: string): IssueLinkType[] | null {
  if (!raw?.trim()) return null;
  const allowed: IssueLinkType[] = [
    'blocks',
    'is_blocked_by',
    'duplicates',
    'is_duplicated_by',
    'relates_to',
  ];
  const parts = raw.split(',').map((s) => s.trim()) as IssueLinkType[];
  const filtered = parts.filter((p) => allowed.includes(p));
  return filtered.length ? filtered : null;
}

export async function getProjectIssueGraph(
  projectId: string,
  userId: string,
  options: {
    linkTypes?: string;
    centerIssueId?: string;
    depth?: number;
    includeParentEdges?: boolean;
  } = {}
): Promise<IssueGraphResult> {
  const member = await ProjectMember.exists({
    project: projectId,
    user: new mongoose.Types.ObjectId(userId),
  });
  if (!member) throw new ApiError(403, 'Access denied');

  const projectOid = new mongoose.Types.ObjectId(projectId);
  const issues = await Issue.find({ project: projectOid })
    .select('_id key title type status parent')
    .lean();
  const issueIds = issues.map((i) => String(i._id));
  const issueIdSet = new Set(issueIds);

  if (issueIds.length === 0) {
    return { nodes: [], edges: [] };
  }

  const typeFilter = parseLinkTypes(options.linkTypes);
  const includeParent = options.includeParentEdges !== false;

  const links = await IssueLink.find({
    $or: [
      { sourceIssue: { $in: issueIds } },
      { targetIssue: { $in: issueIds } },
    ],
  }).lean();

  const nodes: GraphNode[] = issues.map((i) => ({
    id: String(i._id),
    key: String(i.key ?? ''),
    title: String(i.title ?? ''),
    type: String(i.type ?? 'Task'),
    status: String(i.status ?? ''),
  }));

  const edges: GraphEdge[] = [];

  for (const link of links) {
    const src = String(link.sourceIssue);
    const tgt = String(link.targetIssue);
    if (!issueIdSet.has(src) || !issueIdSet.has(tgt)) continue;
    const lt = link.linkType as IssueLinkType;
    if (typeFilter && !typeFilter.includes(lt)) continue;
    edges.push({
      id: String(link._id),
      source: src,
      target: tgt,
      linkType: lt,
    });
  }

  if (includeParent) {
    for (const i of issues) {
      if (!i.parent) continue;
      const parentId = String(i.parent);
      const childId = String(i._id);
      if (!issueIdSet.has(parentId)) continue;
      edges.push({
        id: `parent:${childId}`,
        source: parentId,
        target: childId,
        linkType: 'parent_child',
        synthetic: true,
      });
    }
  }

  const centerId = options.centerIssueId;
  const maxDepth = options.depth ?? 0;
  if (centerId && issueIdSet.has(centerId) && maxDepth > 0) {
    const adj = new Map<string, Set<string>>();
    const addAdj = (a: string, b: string) => {
      if (!adj.has(a)) adj.set(a, new Set());
      adj.get(a)!.add(b);
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(b)!.add(a);
    };
    for (const e of edges) {
      addAdj(e.source, e.target);
    }

    const reachable = new Set<string>([centerId]);
    let frontier = [centerId];
    for (let d = 0; d < maxDepth; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const nb of adj.get(id) ?? []) {
          if (!reachable.has(nb)) {
            reachable.add(nb);
            next.push(nb);
          }
        }
      }
      frontier = next;
    }

    const filteredNodes = nodes.filter((n) => reachable.has(n.id));
    const nodeSet = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = edges.filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target));
    return { nodes: filteredNodes, edges: filteredEdges };
  }

  return { nodes, edges };
}
