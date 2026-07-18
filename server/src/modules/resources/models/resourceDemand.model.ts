import mongoose, { Document, Schema } from 'mongoose';

export type ResourceDemandPriority = 'low' | 'medium' | 'high' | 'critical';
export type ResourceDemandStatus = 'open' | 'partially_filled' | 'filled' | 'cancelled';

export interface IResourceDemand extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  title: string;
  projectId?: mongoose.Types.ObjectId | null;
  roleLabel?: string;
  hoursNeeded: number;
  periodStart: Date;
  periodEnd: Date;
  priority: ResourceDemandPriority;
  status: ResourceDemandStatus;
  skills: string[];
  notes?: string;
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const resourceDemandSchema = new Schema<IResourceDemand>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    roleLabel: { type: String, trim: true },
    hoursNeeded: { type: Number, required: true, min: 0 },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    status: {
      type: String,
      enum: ['open', 'partially_filled', 'filled', 'cancelled'],
      default: 'open',
    },
    skills: { type: [String], default: [] },
    notes: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

resourceDemandSchema.index({ taskflowOrganizationId: 1, periodStart: 1, periodEnd: 1 });
resourceDemandSchema.index({ taskflowOrganizationId: 1, status: 1 });

export const ResourceDemand = mongoose.model<IResourceDemand>('ResourceDemand', resourceDemandSchema);
