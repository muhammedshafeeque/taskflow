import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ITemplateSnapshot {
  name: string;
  description?: string;
  statuses: unknown[];
  issueTypes: unknown[];
  priorities: unknown[];
  customFields?: unknown[];
  fieldSchemes?: unknown[];
  projectRules?: unknown[];
  estimateApprovalEnabled?: boolean;
  rulesEnforcementMode?: 'log' | 'enforce';
}

export interface IProjectTemplateVersion extends Document {
  templateId: Types.ObjectId;
  version: number;
  snapshot: ITemplateSnapshot;
  changelog?: string;
  createdBy?: Types.ObjectId;
  createdAt: Date;
}

const snapshotSchema = new Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: '' },
    statuses: { type: Schema.Types.Mixed, default: [] },
    issueTypes: { type: Schema.Types.Mixed, default: [] },
    priorities: { type: Schema.Types.Mixed, default: [] },
    customFields: { type: Schema.Types.Mixed, default: [] },
    fieldSchemes: { type: Schema.Types.Mixed, default: [] },
    projectRules: { type: Schema.Types.Mixed, default: [] },
    estimateApprovalEnabled: { type: Boolean, default: false },
    rulesEnforcementMode: { type: String, enum: ['log', 'enforce'], default: 'enforce' },
  },
  { _id: false }
);

const projectTemplateVersionSchema = new Schema<IProjectTemplateVersion>(
  {
    templateId: { type: Schema.Types.ObjectId, ref: 'ProjectTemplate', required: true, index: true },
    version: { type: Number, required: true },
    snapshot: { type: snapshotSchema, required: true },
    changelog: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

projectTemplateVersionSchema.index({ templateId: 1, version: 1 }, { unique: true });

export const ProjectTemplateVersion = mongoose.model<IProjectTemplateVersion>(
  'ProjectTemplateVersion',
  projectTemplateVersionSchema
);
