import mongoose, { Document, Schema } from 'mongoose';

/**
 * Manually entered engagement: work the system can't see in tasks, allocations or the calendar
 * (support duty, pre-sales, training, internal initiatives…). Counted on every working day of its range.
 */
export interface IResourceEngagementEntry extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  title: string;
  /** Free-text category so each workspace can use its own vocabulary. */
  category?: string;
  startDate: Date;
  endDate: Date;
  /** 'hours' = hours per working day; 'percent' = share of the day's capacity. */
  mode: 'hours' | 'percent';
  value: number;
  projectId?: mongoose.Types.ObjectId | null;
  notes?: string;
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const resourceEngagementEntrySchema = new Schema<IResourceEngagementEntry>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
    category: { type: String, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    mode: { type: String, enum: ['hours', 'percent'], default: 'hours' },
    value: { type: Number, required: true, min: 0 },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    notes: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

resourceEngagementEntrySchema.index({ taskflowOrganizationId: 1, userId: 1, startDate: 1, endDate: 1 });

export const ResourceEngagementEntry = mongoose.model<IResourceEngagementEntry>(
  'ResourceEngagementEntry',
  resourceEngagementEntrySchema
);
