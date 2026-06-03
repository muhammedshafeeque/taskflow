import {
  getLeafIdsInSet,
  sumLeafStoryPoints,
  sumLeafStoryPointsForSubset,
  effectiveStoryPointsForIssue,
  type HierarchyIssueRow,
} from './issueHierarchy.service';
import mongoose from 'mongoose';

const epicId = new mongoose.Types.ObjectId();
const storyId = new mongoose.Types.ObjectId();
const taskId = new mongoose.Types.ObjectId();

const rows: HierarchyIssueRow[] = [
  { _id: epicId, parent: null, storyPoints: 100, status: 'Open', key: 'epic' },
  { _id: storyId, parent: epicId, storyPoints: 5, status: 'Open', key: 'story' },
  { _id: taskId, parent: storyId, storyPoints: 3, status: 'Done', key: 'task' },
];

describe('issueHierarchy.service', () => {
  it('getLeafIdsInSet returns only nodes without children in set', () => {
    const idSet = new Set(rows.map((r) => String(r._id)));
    const leaves = getLeafIdsInSet(idSet, rows);
    expect(leaves).toHaveLength(1);
    expect(leaves[0]).toBe(String(taskId));
  });

  it('sumLeafStoryPoints excludes parent SP when children exist', () => {
    const { totalSp, completedSp, leafCount } = sumLeafStoryPoints(rows, ['Done']);
    expect(totalSp).toBe(3);
    expect(completedSp).toBe(3);
    expect(leafCount).toBe(1);
  });

  it('sumLeafStoryPointsForSubset limits to subset ids', () => {
    const subset = new Set([String(storyId), String(taskId)]);
    const { totalSp } = sumLeafStoryPointsForSubset(rows, subset, []);
    expect(totalSp).toBe(3);
  });

  it('effectiveStoryPointsForIssue is zero for parents with children', () => {
    expect(effectiveStoryPointsForIssue(String(epicId), rows)).toBe(0);
    expect(effectiveStoryPointsForIssue(String(taskId), rows)).toBe(3);
  });
});
