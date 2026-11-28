import mongoose, { Schema } from 'mongoose';

/** Per-workspace billing settings. */
const billingSettingsSchema = new Schema(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true },
    /**
     * Hourly rate used for time to invoice when a project has no contract or accepted-quote rate (AUT-42).
     * null = no default: such projects must get a rate before their time can be invoiced.
     */
    defaultHourlyRate: { type: Number, default: null, min: 0 },
  },
  { timestamps: true }
);

export const BillingSettings = mongoose.model('BillingSettings', billingSettingsSchema);
