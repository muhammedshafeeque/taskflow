import mongoose, { Document, Schema } from 'mongoose';

export interface IResourceAllocation extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  /** Commitment 1–100 */
  percent: number;
  startDate: Date;
  endDate?: Date | null;
  billable: boolean;
  softBooked: boolean;
  roleLabel?: string;
  notes?: string;
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const resourceAllocationSchema = new Schema<IResourceAllocation>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    percent: { type: Number, required: true, min: 1, max: 100 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    billable: { type: Boolean, default: true },
    softBooked: { type: Boolean, default: false },
    roleLabel: { type: String, trim: true },
    notes: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

resourceAllocationSchema.index({ taskflowOrganizationId: 1, userId: 1, startDate: 1 });
resourceAllocationSchema.index({ taskflowOrganizationId: 1, projectId: 1 });

export const ResourceAllocation = mongoose.model<IResourceAllocation>(
  'ResourceAllocation',
  resourceAllocationSchema
);
