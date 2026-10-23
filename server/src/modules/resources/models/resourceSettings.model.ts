import mongoose, { Document, Schema } from 'mongoose';

/** Per-workspace tunables for resource planning (engagement load estimation). */
export interface IResourceSettings extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  /** Converts story points to hours for issues without a time estimate; null = don't convert. */
  hoursPerStoryPoint: number | null;
  /** Hours assumed for open issues with no estimate and no points; null = count them as 0h. */
  defaultTaskHours: number | null;
  /** Count stage estimates still awaiting approval when no approved one exists for the lane. */
  includePendingStageEstimates: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const resourceSettingsSchema = new Schema<IResourceSettings>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true },
    hoursPerStoryPoint: { type: Number, default: null, min: 0, max: 200 },
    defaultTaskHours: { type: Number, default: null, min: 0, max: 200 },
    includePendingStageEstimates: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const ResourceSettings = mongoose.model<IResourceSettings>('ResourceSettings', resourceSettingsSchema);
