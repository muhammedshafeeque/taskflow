import mongoose, { Document, Schema } from 'mongoose';

/**
 * A company-wide project designation (Dev Lead, QA Engineer, Intern…): a name and project permissions that
 * projects copy, plus what it suits, so inviting someone can suggest it.
 */
export interface IDesignationTemplate extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  name: string;
  code: string;
  description?: string;
  permissions: string[];
  /** Employee levels (from HR settings) this designation suits, e.g. ["Senior"]. */
  levels: string[];
  /** Words in an employee's job title or department that point here, e.g. ["qa", "test"]. */
  keywords: string[];
  /** Ticked by default when creating a project. */
  addToNewProjects: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IDesignationTemplate>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, lowercase: true, trim: true },
    description: { type: String, trim: true },
    permissions: { type: [String], default: [] },
    levels: { type: [String], default: [] },
    keywords: { type: [String], default: [] },
    addToNewProjects: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);
schema.index({ taskflowOrganizationId: 1, code: 1 }, { unique: true });

export const DesignationTemplate = mongoose.model<IDesignationTemplate>('DesignationTemplate', schema, 'project_designation_templates');
