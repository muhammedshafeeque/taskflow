import mongoose, { Document, Schema } from 'mongoose';

/**
 * A file a client sent over WhatsApp (screenshot, voice note, document), stored
 * through the active storage backend. Ownership fields decide who may
 * download it again through the client-scoped API.
 */
export interface IPaFile extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  key: string;
  url: string;
  originalName: string;
  mimeType: string;
  size: number;
  customerOrgId?: mongoose.Types.ObjectId | null;
  chatId: string;
  serviceTicketId?: mongoose.Types.ObjectId | null;
  uploadedBy: mongoose.Types.ObjectId;
  createdAt: Date;
}

const paFileSchema = new Schema<IPaFile>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    key: { type: String, required: true, unique: true },
    url: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    customerOrgId: { type: Schema.Types.ObjectId, ref: 'CustomerOrg', default: null, index: true },
    chatId: { type: String, required: true, index: true },
    serviceTicketId: { type: Schema.Types.ObjectId, ref: 'ServiceTicket', default: null, index: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const PaFile = mongoose.model<IPaFile>('PaFile', paFileSchema);
