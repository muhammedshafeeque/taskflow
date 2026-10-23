import mongoose, { Document, Schema } from 'mongoose';

/**
 * Owner-set link between a WhatsApp chat (usually a support group) and the
 * client it belongs to. Stored in Atrium — not in PA — so the server, not the
 * bot's config, decides what a client chat may see.
 */
export interface IPaChatBinding extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  chatId: string;
  label?: string;
  customerOrgId?: mongoose.Types.ObjectId | null;
  /** Explicit project list; empty = the client's mapped projects. */
  projectIds: mongoose.Types.ObjectId[];
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const paChatBindingSchema = new Schema<IPaChatBinding>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    chatId: { type: String, required: true, trim: true },
    label: { type: String, trim: true },
    customerOrgId: { type: Schema.Types.ObjectId, ref: 'CustomerOrg', default: null },
    projectIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Project' }], default: [] },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

paChatBindingSchema.index({ taskflowOrganizationId: 1, chatId: 1 }, { unique: true });

export const PaChatBinding = mongoose.model<IPaChatBinding>('PaChatBinding', paChatBindingSchema);
