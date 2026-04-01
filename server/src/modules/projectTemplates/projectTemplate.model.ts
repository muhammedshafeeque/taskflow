import mongoose, { Document, Schema } from 'mongoose';

export interface IProjectTemplate extends Document {
  name: string;
  description?: string;
  statuses: Array<{ id: string; name: string; order: number; isClosed?: boolean; icon?: string; color?: string }>;
  issueTypes: Array<{ id: string; name: string; order: number; icon?: string; color?: string }>;
  priorities: Array<{ id: string; name: string; order: number; icon?: string; color?: string }>;
  createdAt: Date;
  updatedAt: Date;
}

const statusSchema = new Schema(
  { id: String, name: String, order: Number, isClosed: Boolean, icon: String, color: String },
  { _id: false }
);
const issueTypeSchema = new Schema(
  { id: String, name: String, order: Number, icon: String, color: String },
  { _id: false }
);
const prioritySchema = new Schema(
  { id: String, name: String, order: Number, icon: String, color: String },
  { _id: false }
);

const projectTemplateSchema = new Schema<IProjectTemplate>(
  {
    name: { type: String, required: true },
    description: { type: String, default: '' },
    statuses: { type: [statusSchema], default: [] },
    issueTypes: { type: [issueTypeSchema], default: [] },
    priorities: { type: [prioritySchema], default: [] },
  },
  { timestamps: true }
);

export const ProjectTemplate = mongoose.model<IProjectTemplate>('ProjectTemplate', projectTemplateSchema);
