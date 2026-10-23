import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ICustomerPermissionOverrides {
  granted: string[];
  revoked: string[];
}

export interface ICustomerUser extends Document {
  customerOrgId: Types.ObjectId;
  name: string;
  email: string;
  password: string;
  avatarUrl?: string;
  roleId: Types.ObjectId;
  isOrgAdmin: boolean;
  status: 'active' | 'inactive' | 'pending';
  mustChangePassword: boolean;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  refreshTokenJti?: string | null;
  invitedBy?: Types.ObjectId;
  lastLoginAt?: Date;
  permissionOverrides: ICustomerPermissionOverrides;
  createdAt: Date;
  updatedAt: Date;
}

const customerUserSchema = new Schema<ICustomerUser>(
  {
    customerOrgId: { type: Schema.Types.ObjectId, ref: 'CustomerOrg', required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    avatarUrl: { type: String },
    roleId: { type: Schema.Types.ObjectId, ref: 'CustomerRole', required: true },
    isOrgAdmin: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'inactive', 'pending'], default: 'pending' },
    mustChangePassword: { type: Boolean, default: true },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    refreshTokenJti: { type: String, select: false, default: null },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'CustomerUser' },
    lastLoginAt: { type: Date },
    permissionOverrides: {
      type: {
        granted: { type: [String], default: [] },
        revoked: { type: [String], default: [] },
      },
      default: () => ({ granted: [], revoked: [] }),
    },
  },
  { timestamps: true }
);

customerUserSchema.index({ customerOrgId: 1, email: 1 }, { unique: true });

export const CustomerUser = mongoose.model<ICustomerUser>('CustomerUser', customerUserSchema);
