import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export type UserRole = 'user' | 'admin';

export enum UserType {
  TASKFLOW = 'taskflow',
  CUSTOMER = 'customer',
}

export enum AuthProvider {
  LOCAL = 'local',
  GOOGLE = 'google',
  MICROSOFT = 'microsoft',
}

export interface IPermissionOverrides {
  granted: string[];
  revoked: string[];
}

export interface IUser extends Document {
  email: string;
  password?: string | null;
  name: string;
  avatarUrl?: string;
  role: UserRole;
  roleId?: mongoose.Types.ObjectId;
  enabled: boolean;
  mustChangePassword: boolean;
  permissionOverrides: IPermissionOverrides;
  /** Snapshot of effective TaskFlow permissions (dot notation); merged with role on write */
  permissions: string[];
  userType: UserType;
  provider: AuthProvider;
  googleId?: string | null;
  microsoftId?: string | null;
  providerEmail?: string | null;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: false, select: false, default: null },
    name: { type: String, required: true, trim: true },
    avatarUrl: { type: String, default: null },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    roleId: { type: Schema.Types.ObjectId, ref: 'Role', default: null },
    enabled: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: true },
    permissionOverrides: {
      type: {
        granted: { type: [String], default: [] },
        revoked: { type: [String], default: [] },
      },
      default: () => ({ granted: [], revoked: [] }),
    },
    permissions: { type: [String], default: [] },
    userType: { type: String, enum: Object.values(UserType), default: UserType.TASKFLOW },
    provider: { type: String, enum: Object.values(AuthProvider), default: AuthProvider.LOCAL },
    googleId: { type: String, default: null },
    microsoftId: { type: String, default: null },
    providerEmail: { type: String, default: null },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function (candidate: string): Promise<boolean> {
  if (!this.password) return Promise.resolve(false);
  return bcrypt.compare(candidate, this.password);
};

userSchema.index({ googleId: 1 }, { unique: true, sparse: true });
userSchema.index({ microsoftId: 1 }, { unique: true, sparse: true });

export const User = mongoose.model<IUser>('User', userSchema);
