import mongoose, { Schema } from 'mongoose';

/**
 * Platform-wide preferences, edited from Core → Preferences. Everything here is
 * data so each company can configure the product without code changes.
 */
export interface IPlatformSettings {
  key: string;
  /** Role given to users created by signup, SSO or integrations when no role is chosen. */
  defaultRoleId?: mongoose.Types.ObjectId | null;
  /** Require two-factor authentication for every staff account. */
  requireTwoFactor: boolean;
  /** Default currency for payroll/ledger when an employee has none. */
  updatedBy?: mongoose.Types.ObjectId;
}

const schema = new Schema<IPlatformSettings>(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    defaultRoleId: { type: Schema.Types.ObjectId, ref: 'Role', default: null },
    requireTwoFactor: { type: Boolean, default: false },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export const PlatformSettings = mongoose.model<IPlatformSettings>('PlatformSettings', schema);
