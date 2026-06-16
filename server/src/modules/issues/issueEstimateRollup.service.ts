import mongoose from 'mongoose';
import { Issue } from './issue.model';
import { StageEstimate } from '../stageEstimates/stageEstimate.model';
import { getDescendantIds, getLeafIdsInSet, type HierarchyIssueRow } from './issueHierarchy.service';

export interface StageEstimateRollup {
  byLane: Record<string, number>;
  totalApprovedMinutes: number;
  totalPendingMinutes: number;
  fromChildren: boolean;
  leafCount: number;
}

/** Roll up approved stage estimates for an issue (leaf-only when children exist). */
export async function rollupStageEstimatesForIssue(issueId: string): Promise<StageEstimateRollup> {
  const issue = await Issue.findById(issueId).select('project parent').lean();
  if (!issue) {
    return { byLane: {}, totalApprovedMinutes: 0, totalPendingMinutes: 0, fromChildren: false, leafCount: 0 };
  }

  const projectId = String(issue.project);
  const descendants = await getDescendantIds(projectId, issueId);
  const hasChildren = descendants.length > 0;

  let targetIds: string[];
  if (hasChildren) {
    const allIds = [issueId, ...descendants];
    const rows = await Issue.find({ _id: { $in: allIds } }).select('_id parent').lean();
    const idSet = new Set(allIds);
    targetIds = getLeafIdsInSet(idSet, rows as HierarchyIssueRow[]);
  } else {
    targetIds = [issueId];
  }

  const estimates = await StageEstimate.find({
    issue: { $in: targetIds.map((id) => new mongoose.Types.ObjectId(id)) },
    state: { $in: ['approved', 'pending'] },
  }).lean();

  const byLane: Record<string, number> = {};
  let totalApprovedMinutes = 0;
  let totalPendingMinutes = 0;

  for (const e of estimates) {
    if (e.state === 'approved') {
      byLane[e.laneId] = (byLane[e.laneId] ?? 0) + e.minutes;
      totalApprovedMinutes += e.minutes;
    } else if (e.state === 'pending') {
      totalPendingMinutes += e.minutes;
    }
  }

  return {
    byLane,
    totalApprovedMinutes,
    totalPendingMinutes,
    fromChildren: hasChildren,
    leafCount: targetIds.length,
  };
}
