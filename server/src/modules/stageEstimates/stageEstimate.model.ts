import mongoose, { Document, Schema, Types } from 'mongoose';

export type StageEstimateState = 'pending' | 'approved' | 'rejected';

export interface IStageEstimate extends Document {
  issue: Types.ObjectId;
  project: Types.ObjectId;
  laneId: string;
  statusId?: string;
  assigneeId?: Types.ObjectId;
  minutes: number;
  state: StageEstimateState;
  submittedBy: Types.ObjectId;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  rejectNote?: string;
  forceApproveNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

const stageEstimateSchema = new Schema<IStageEstimate>(
  {
    issue: { type: Schema.Types.ObjectId, ref: 'Issue', required: true, index: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    laneId: { type: String, required: true },
    statusId: { type: String },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User' },
    minutes: { type: Number, required: true, min: 0 },
    state: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    rejectNote: { type: String },
    forceApproveNote: { type: String },
  },
  { timestamps: true }
);

stageEstimateSchema.index({ issue: 1, laneId: 1, state: 1 });
stageEstimateSchema.index({ project: 1, state: 1 });

export const StageEstimate = mongoose.model<IStageEstimate>('StageEstimate', stageEstimateSchema);
