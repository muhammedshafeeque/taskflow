import mongoose, { Document, Schema } from 'mongoose';

export interface ISlaTarget {
  priority: string;
  firstResponseMinutes: number;
  resolutionMinutes: number;
}

export interface ISlaPolicy extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  name: string;
  targets: ISlaTarget[];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const slaTargetSchema = new Schema(
  {
    priority: { type: String, required: true },
    firstResponseMinutes: { type: Number, required: true },
    resolutionMinutes: { type: Number, required: true },
  },
  { _id: false }
);

const slaPolicySchema = new Schema<ISlaPolicy>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true },
    targets: { type: [slaTargetSchema], default: [] },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const SlaPolicy = mongoose.model<ISlaPolicy>('SlaPolicy', slaPolicySchema);
