import mongoose, { Document, Schema } from 'mongoose';
import { ALL_PROJECT_PERMISSIONS } from '../../shared/constants/permissions';

export interface IProjectDesignation extends Document {
  name: string;
  code: string;
  projectId: mongoose.Types.ObjectId;
  permissions: string[];
  isSystem: boolean;
  /** The company template it was copied from, if any. */
  templateId?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const projectDesignationSchema = new Schema<IProjectDesignation>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, lowercase: true, trim: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    permissions: {
      type: [String],
      default: [],
      validate: {
        validator(perms: string[]) {
          return perms.every((p) => ALL_PROJECT_PERMISSIONS.includes(p));
        },
        message: (props: { value: string[] }) => `Invalid project permission(s): ${props.value}`,
      },
    },
    isSystem: { type: Boolean, default: false },
    templateId: { type: Schema.Types.ObjectId, ref: 'DesignationTemplate', default: null },
  },
  { timestamps: true }
);

projectDesignationSchema.index({ projectId: 1, code: 1 }, { unique: true });

export const ProjectDesignation = mongoose.model<IProjectDesignation>(
  'ProjectDesignation',
  projectDesignationSchema,
  'project_designations'
);
