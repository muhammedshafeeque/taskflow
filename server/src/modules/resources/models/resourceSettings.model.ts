import mongoose, { Document, Schema } from 'mongoose';

/** Per-workspace tunables for resource planning (thresholds, horizons, engagement load estimation). */
export interface IResourceSettings extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  /** Weekly hours assumed for people without a resource profile. */
  defaultCapacityHoursPerWeek: number;
  /** At or below this committed % a person counts as "on bench". */
  benchThresholdPct: number;
  /** At or above this committed % a person counts as fully booked. */
  busyThresholdPct: number;
  /** Committed % above which a person is over-allocated (a conflict). */
  overAllocationPct: number;
  /** Weeks covered by the forecast and the dashboard load trend. */
  forecastHorizonWeeks: number;
  /** Days ahead scanned for over-allocation conflicts. */
  conflictLookaheadDays: number;
  /** Days ahead for "freeing soon" / "ending soon" lists. */
  freeingSoonDays: number;
  /** Converts story points to hours for issues without a time estimate; null = don't convert. */
  hoursPerStoryPoint: number | null;
  /** Hours assumed for open issues with no estimate and no points; null = count them as 0h. */
  defaultTaskHours: number | null;
  /** Count stage estimates still awaiting approval when no approved one exists for the lane. */
  includePendingStageEstimates: boolean;
  /** Count hours logged on work logs as actual engagement on past days and today. */
  includeLoggedTime: boolean;
  /** Count timed calendar events a person owns or attends as engagement. */
  includeCalendarEvents: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const resourceSettingsSchema = new Schema<IResourceSettings>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true },
    defaultCapacityHoursPerWeek: { type: Number, default: 40, min: 1, max: 168 },
    benchThresholdPct: { type: Number, default: 20, min: 0, max: 100 },
    busyThresholdPct: { type: Number, default: 80, min: 1, max: 200 },
    overAllocationPct: { type: Number, default: 100, min: 1, max: 300 },
    forecastHorizonWeeks: { type: Number, default: 13, min: 1, max: 52 },
    conflictLookaheadDays: { type: Number, default: 90, min: 1, max: 366 },
    freeingSoonDays: { type: Number, default: 30, min: 1, max: 366 },
    hoursPerStoryPoint: { type: Number, default: null, min: 0, max: 200 },
    defaultTaskHours: { type: Number, default: null, min: 0, max: 200 },
    includePendingStageEstimates: { type: Boolean, default: true },
    includeLoggedTime: { type: Boolean, default: true },
    includeCalendarEvents: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const ResourceSettings = mongoose.model<IResourceSettings>('ResourceSettings', resourceSettingsSchema);
