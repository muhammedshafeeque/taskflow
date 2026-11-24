import { TASK_FLOW_PERMISSIONS } from './permissions';

const H = TASK_FLOW_PERMISSIONS.TASKFLOW.HR;

export interface PayAccess {
  /** Salary and HR notes. */
  see: boolean;
  set: boolean;
  /** Hourly cost rate. */
  seeRate: boolean;
  setRate: boolean;
}

/** One rule for server and screens. Payroll people see and set salaries anyway, so payroll rights include it. */
export function payAccessOf(can: (permission: string) => boolean): PayAccess {
  const set = can(H.SALARY.MANAGE) || can(H.PAYROLL.MANAGE);
  const see = set || can(H.SALARY.READ) || can(H.PAYROLL.READ);
  const rate = can(H.COST_RATE.MANAGE);
  return { see, set, seeRate: see || rate, setRate: set || rate };
}
