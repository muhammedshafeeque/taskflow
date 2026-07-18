import mongoose, { Document, Schema } from 'mongoose';

export interface IKbArticle extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  title: string;
  slug: string;
  category: string;
  body: string;
  published: boolean;
  authorId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const kbArticleSchema = new Schema<IKbArticle>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true },
    slug: { type: String, required: true },
    category: { type: String, default: 'general' },
    body: { type: String, required: true },
    published: { type: Boolean, default: false },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

kbArticleSchema.index({ taskflowOrganizationId: 1, slug: 1 }, { unique: true });

export const KbArticle = mongoose.model<IKbArticle>('KbArticle', kbArticleSchema);
