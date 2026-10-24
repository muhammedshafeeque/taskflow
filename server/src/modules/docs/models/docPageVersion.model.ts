import mongoose, { Document, Schema } from 'mongoose';

/** Snapshot of a page as it was saved at `version`. The live page holds the latest version too. */
export interface IDocPageVersion extends Document {
  pageId: mongoose.Types.ObjectId;
  version: number;
  title: string;
  content: string;
  authorId: mongoose.Types.ObjectId;
  /** Optional note the author left when saving. */
  message?: string;
  createdAt: Date;
}

const docPageVersionSchema = new Schema<IDocPageVersion>(
  {
    pageId: { type: Schema.Types.ObjectId, ref: 'DocPage', required: true },
    version: { type: Number, required: true },
    title: { type: String, required: true },
    content: { type: String, default: '' },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

docPageVersionSchema.index({ pageId: 1, version: -1 }, { unique: true });

export const DocPageVersion = mongoose.model<IDocPageVersion>('DocPageVersion', docPageVersionSchema);
