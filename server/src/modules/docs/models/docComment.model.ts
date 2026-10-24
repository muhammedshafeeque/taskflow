import mongoose, { Document, Schema } from 'mongoose';

export interface IDocComment extends Document {
  pageId: mongoose.Types.ObjectId;
  /** Replies point at the top-level comment they answer. */
  parentId: mongoose.Types.ObjectId | null;
  authorId: mongoose.Types.ObjectId;
  body: string;
  resolved: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const docCommentSchema = new Schema<IDocComment>(
  {
    pageId: { type: Schema.Types.ObjectId, ref: 'DocPage', required: true, index: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'DocComment', default: null },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true },
    resolved: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const DocComment = mongoose.model<IDocComment>('DocComment', docCommentSchema);
