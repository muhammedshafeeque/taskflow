import mongoose, { Document, Schema } from 'mongoose';

export interface IMilestone extends Document {
  project: mongoose.Types.ObjectId;
  name: string;
  dueDate?: Date;
  baselineStartDate?: Date;
  baselineDueDate?: Date;
  status: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const milestoneSchema = new Schema<IMilestone>(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    name: { type: String, required: true },
    dueDate: { type: Date },
    baselineStartDate: { type: Date },
    baselineDueDate: { type: Date },
    status: { type: String, default: 'open' },
    description: { type: String, default: '' },
  },
  { timestamps: true }
);

milestoneSchema.index({ project: 1 });
milestoneSchema.index({ project: 1, dueDate: 1 });

export const Milestone = mongoose.model<IMilestone>('Milestone', milestoneSchema);
