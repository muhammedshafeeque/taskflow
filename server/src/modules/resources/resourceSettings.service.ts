import { ApiError } from '../../utils/ApiError';
import { ResourceSettings } from './models/resourceSettings.model';
import { requireWorkspaceId, toOrgOid } from './resourcesWorkspace';

export interface ResourceSettingsValues {
  defaultCapacityHoursPerWeek: number;
  benchThresholdPct: number;
  busyThresholdPct: number;
  overAllocationPct: number;
  forecastHorizonWeeks: number;
  conflictLookaheadDays: number;
  freeingSoonDays: number;
  hoursPerStoryPoint: number | null;
  defaultTaskHours: number | null;
  includePendingStageEstimates: boolean;
}

export const RESOURCE_SETTINGS_DEFAULTS: ResourceSettingsValues = {
  defaultCapacityHoursPerWeek: 40,
  benchThresholdPct: 20,
  busyThresholdPct: 80,
  overAllocationPct: 100,
  forecastHorizonWeeks: 13,
  conflictLookaheadDays: 90,
  freeingSoonDays: 30,
  hoursPerStoryPoint: null,
  defaultTaskHours: null,
  includePendingStageEstimates: true,
};

/** Numeric settings with their allowed range; `nullable` ones may be cleared to turn the feature off. */
const NUMERIC_FIELDS: Array<{ field: keyof ResourceSettingsValues; min: number; max: number; nullable?: boolean; int?: boolean }> = [
  { field: 'defaultCapacityHoursPerWeek', min: 1, max: 168 },
  { field: 'benchThresholdPct', min: 0, max: 100, int: true },
  { field: 'busyThresholdPct', min: 1, max: 200, int: true },
  { field: 'overAllocationPct', min: 1, max: 300, int: true },
  { field: 'forecastHorizonWeeks', min: 1, max: 52, int: true },
  { field: 'conflictLookaheadDays', min: 1, max: 366, int: true },
  { field: 'freeingSoonDays', min: 1, max: 366, int: true },
  { field: 'hoursPerStoryPoint', min: 0, max: 200, nullable: true },
  { field: 'defaultTaskHours', min: 0, max: 200, nullable: true },
];

export async function getResourceSettings(workspaceId: string | null | undefined): Promise<ResourceSettingsValues> {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const doc = await ResourceSettings.findOne({ taskflowOrganizationId: orgOid }).lean();
  const d = RESOURCE_SETTINGS_DEFAULTS;
  return {
    defaultCapacityHoursPerWeek: doc?.defaultCapacityHoursPerWeek ?? d.defaultCapacityHoursPerWeek,
    benchThresholdPct: doc?.benchThresholdPct ?? d.benchThresholdPct,
    busyThresholdPct: doc?.busyThresholdPct ?? d.busyThresholdPct,
    overAllocationPct: doc?.overAllocationPct ?? d.overAllocationPct,
    forecastHorizonWeeks: doc?.forecastHorizonWeeks ?? d.forecastHorizonWeeks,
    conflictLookaheadDays: doc?.conflictLookaheadDays ?? d.conflictLookaheadDays,
    freeingSoonDays: doc?.freeingSoonDays ?? d.freeingSoonDays,
    hoursPerStoryPoint: doc?.hoursPerStoryPoint ?? null,
    defaultTaskHours: doc?.defaultTaskHours ?? null,
    includePendingStageEstimates: doc?.includePendingStageEstimates ?? true,
  };
}

export async function updateResourceSettings(
  workspaceId: string | null | undefined,
  input: Partial<Record<keyof ResourceSettingsValues, unknown>>
): Promise<ResourceSettingsValues> {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const update: Record<string, unknown> = {};
  for (const { field, min, max, nullable, int } of NUMERIC_FIELDS) {
    const raw = input[field];
    if (raw === undefined) continue;
    if (raw === null || raw === '') {
      if (!nullable) throw new ApiError(400, `${field} is required`);
      update[field] = null;
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min || n > max) throw new ApiError(400, `${field} must be between ${min} and ${max}`);
    update[field] = int ? Math.round(n) : n;
  }
  if (input.includePendingStageEstimates !== undefined) {
    update.includePendingStageEstimates = Boolean(input.includePendingStageEstimates);
  }

  const current = await getResourceSettings(workspaceId);
  const next = { ...current, ...update } as ResourceSettingsValues;
  if (next.benchThresholdPct >= next.busyThresholdPct) {
    throw new ApiError(400, 'Bench threshold must be lower than the fully-booked threshold');
  }
  if (next.busyThresholdPct > next.overAllocationPct) {
    throw new ApiError(400, 'Fully-booked threshold cannot exceed the over-allocation limit');
  }

  await ResourceSettings.findOneAndUpdate(
    { taskflowOrganizationId: orgOid },
    { $set: update, $setOnInsert: { taskflowOrganizationId: orgOid } },
    { upsert: true }
  );
  return getResourceSettings(workspaceId);
}
