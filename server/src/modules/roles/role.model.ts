import mongoose, { Document, Schema } from 'mongoose';
import { isValidPermission } from '../../constants/permissions';

export interface IRole extends Document {
  name: string;
  code?: string;
  permissions: string[];
  /** Roles whose permissions this one also has (e.g. Senior builds on Junior). */
  inherits: mongoose.Types.ObjectId[];
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function isValidRolePermissionSet(perms: string[]): boolean {
  return perms.every((p) => isValidPermission(p));
}

function invalidRolePermissions(perms: string[]): string[] {
  return perms.filter((p) => !isValidPermission(p));
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
        message: (props: { value: string[] }) =>
          `Invalid permission(s): ${invalidRolePermissions(props.value).join(', ')}`,
      },
    },
    inherits: { type: [{ type: Schema.Types.ObjectId, ref: 'Role' }], default: [] },
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true }
);

roleSchema.index({ code: 1 }, { unique: true, sparse: true });

export const Role = mongoose.model<IRole>('Role', roleSchema);
