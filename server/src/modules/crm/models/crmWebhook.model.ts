import mongoose, { Document, Schema } from 'mongoose';

export interface ICrmWebhook extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  name: string;
  url: string;
  events: string[];
  secret: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const crmWebhookSchema = new Schema<ICrmWebhook>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true },
    url: { type: String, required: true },
    events: { type: [String], default: [] },
    secret: { type: String, required: true },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const CrmWebhook = mongoose.model<ICrmWebhook>('CrmWebhook', crmWebhookSchema);
