import mongoose, { Document, Schema, Types } from 'mongoose';
import type { IProjectRule } from '../projects/project.model';

export interface IProjectTemplate extends Document {
  /** Workspace that owns this template (custom templates only; built-in is virtual). */
  taskflowOrganizationId?: Types.ObjectId;
  name: string;
  description?: string;
  statuses: Array<{ id: string; name: string; order: number; isClosed?: boolean; icon?: string; color?: string; fontColor?: string }>;
  issueTypes: Array<{ id: string; name: string; order: number; icon?: string; color?: string; fontColor?: string }>;
  priorities: Array<{ id: string; name: string; order: number; icon?: string; color?: string; fontColor?: string }>;
  customFields?: Array<Record<string, unknown>>;
  fieldSchemes?: Array<Record<string, unknown>>;
  projectRules?: IProjectRule[];
  estimateApprovalEnabled?: boolean;
  rulesEnforcementMode?: 'log' | 'enforce';
  /** Published to org-wide template library for discovery when creating projects */
  isLibrary?: boolean;
  currentVersion?: number;
  createdAt: Date;
  updatedAt: Date;
}

const statusSchema = new Schema(
  { id: String, name: String, order: Number, isClosed: Boolean, icon: String, color: String, fontColor: String, userInLane: String },
  { _id: false }
);
const issueTypeSchema = new Schema(
  { id: String, name: String, order: Number, icon: String, color: String, fontColor: String },
  { _id: false }
);
const prioritySchema = new Schema(
  { id: String, name: String, order: Number, icon: String, color: String, fontColor: String },
  { _id: false }
);

const projectTemplateSchema = new Schema<IProjectTemplate>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', index: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    statuses: { type: [statusSchema], default: [] },
    issueTypes: { type: [issueTypeSchema], default: [] },
    priorities: { type: [prioritySchema], default: [] },
    customFields: { type: [Schema.Types.Mixed], default: [] },
    fieldSchemes: { type: [Schema.Types.Mixed], default: [] },
    projectRules: { type: [Schema.Types.Mixed], default: [] },
    estimateApprovalEnabled: { type: Boolean, default: false },
    rulesEnforcementMode: { type: String, enum: ['log', 'enforce'], default: 'enforce' },
    isLibrary: { type: Boolean, default: false },
    currentVersion: { type: Number, default: 1 },
  },
  { timestamps: true }
);

projectTemplateSchema.index({ taskflowOrganizationId: 1, isLibrary: 1 });

projectTemplateSchema.index({ taskflowOrganizationId: 1, name: 1 });

export const ProjectTemplate = mongoose.model<IProjectTemplate>('ProjectTemplate', projectTemplateSchema);
