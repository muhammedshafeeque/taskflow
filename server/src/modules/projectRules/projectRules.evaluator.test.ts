import {
  evaluateProjectRules,
  detectEnteringWorkLane,
  type RuleEvaluationContext,
} from './projectRules.evaluator';
import type { IProjectRule } from '../projects/project.model';

describe('projectRules.evaluator', () => {
  const baseProject = {
    estimateApprovalEnabled: true,
    rulesEnforcementMode: 'enforce',
    statuses: [
      { id: 'dev', name: 'Dev in progress', order: 2, userInLane: 'dev' },
      { id: 'todo', name: 'Todo', order: 1 },
    ],
    projectRules: [
      {
        id: 'r1',
        name: 'Block lane',
        enabled: true,
        order: 0,
        mode: 'enforce',
        trigger: 'issue.updated',
        conditions: [
          { field: 'status.enteringWorkLane', op: 'eq', value: true },
          { field: 'estimate.lanePending', op: 'eq', value: true },
        ],
        actions: [{ type: 'deny', message: 'Blocked' }],
      },
    ] as IProjectRule[],
  };

  it('detectEnteringWorkLane when moving to dev status', () => {
    const r = detectEnteringWorkLane(baseProject, 'Todo', 'Dev in progress');
    expect(r.entering).toBe(true);
    expect(r.laneId).toBe('dev');
  });

  it('denies entering work lane when estimate pending', () => {
    const ctx: RuleEvaluationContext = {
      project: baseProject,
      issue: { status: 'Dev in progress' },
      action: 'issue.enter_work_lane',
      userId: 'u1',
      memberPermissions: [],
      payload: { enteringWorkLane: true, lanePending: true },
    };
    const result = evaluateProjectRules(ctx);
    expect(result.allowed).toBe(false);
    expect(result.violations[0]?.message).toBe('Blocked');
  });

  it('allows when lane approved', () => {
    const ctx: RuleEvaluationContext = {
      project: baseProject,
      issue: { status: 'Dev in progress' },
      action: 'issue.enter_work_lane',
      userId: 'u1',
      memberPermissions: [],
      payload: { enteringWorkLane: true, lanePending: false },
    };
    const result = evaluateProjectRules(ctx);
    expect(result.allowed).toBe(true);
  });
});
