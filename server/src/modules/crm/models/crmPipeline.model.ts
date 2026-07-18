import mongoose, { Document, Schema } from 'mongoose';

export interface ICrmStage extends Document {
  pipelineId: mongoose.Types.ObjectId;
  name: string;
  order: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
}

export interface ICrmPipeline extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  name: string;
  isDefault: boolean;
  stages: ICrmStage[];
  createdAt: Date;
  updatedAt: Date;
}

const stageSchema = new Schema(
  {
    name: { type: String, required: true },
    order: { type: Number, required: true },
    probability: { type: Number, default: 0 },
    isWon: { type: Boolean, default: false },
    isLost: { type: Boolean, default: false },
  },
  { _id: true }
);

const crmPipelineSchema = new Schema<ICrmPipeline>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true },
    isDefault: { type: Boolean, default: false },
    stages: { type: [stageSchema], default: [] },
  },
  { timestamps: true }
);

export const CrmPipeline = mongoose.model<ICrmPipeline>('CrmPipeline', crmPipelineSchema);
