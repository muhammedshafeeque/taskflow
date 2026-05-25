import mongoose, { Document, Schema } from 'mongoose';
import { ALL_TASK_FLOW_PERMISSIONS, ALL_PROJECT_PERMISSIONS } from '../../shared/constants/permissions';

export interface IRole extends Document {
  name: string;
  code?: string;
  permissions: string[];
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function isValidRolePermissionSet(perms: string[]): boolean {
  return perms.every(
    (p) => ALL_TASK_FLOW_PERMISSIONS.includes(p) || ALL_PROJECT_PERMISSIONS.includes(p) || p.includes(':')
  );
}

const roleSchema = new Schema<IRole>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, lowercase: true, trim: true },
    permissions: {
      type: [String],
      default: [],
      validate: {
        validator: (perms: string[]) => isValidRolePermissionSet(perms),
        message: (props: { value: string[] }) => `Invalid permission(s): ${props.value}`,
      },
    },
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true }
);

roleSchema.index({ code: 1 }, { unique: true, sparse: true });

export const Role = mongoose.model<IRole>('Role', roleSchema);
