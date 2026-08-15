import mongoose, { Document, Schema } from 'mongoose';

/** Singleton key for the platform-wide module enable map. */
export const PLATFORM_MODULE_SETTINGS_KEY = 'default';

export interface IPlatformModuleSettings extends Document {
  key: string;
  /** Toggleable module id → enabled. Missing keys are treated as enabled. */
  enabledModules: Record<string, boolean>;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const platformModuleSettingsSchema = new Schema<IPlatformModuleSettings>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: PLATFORM_MODULE_SETTINGS_KEY,
      index: true,
    },
    enabledModules: {
      type: Map,
      of: Boolean,
      default: {},
    },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

export const PlatformModuleSettings = mongoose.model<IPlatformModuleSettings>(
  'PlatformModuleSettings',
  platformModuleSettingsSchema
);
