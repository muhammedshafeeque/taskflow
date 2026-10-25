import mongoose, { Schema, Document } from 'mongoose';
import { RECORD_TYPES, type RecordType } from './recordTypes';

/** An explicit edge in the record graph, added by a person (or an automation). */
export interface IRecordLink extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  fromType: RecordType;
  fromId: mongoose.Types.ObjectId;
  toType: RecordType;
  toId: mongoose.Types.ObjectId;
  /** Free label read from "from" to "to", e.g. "related", "delivers", "billed by". */
  relation: string;
  note?: string;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const recordLinkSchema = new Schema<IRecordLink>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    fromType: { type: String, enum: RECORD_TYPES, required: true },
    fromId: { type: Schema.Types.ObjectId, required: true },
    toType: { type: String, enum: RECORD_TYPES, required: true },
    toId: { type: Schema.Types.ObjectId, required: true },
    relation: { type: String, required: true, trim: true, maxlength: 40, default: 'related' },
    note: { type: String, trim: true, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

recordLinkSchema.index(
  { taskflowOrganizationId: 1, fromType: 1, fromId: 1, toType: 1, toId: 1, relation: 1 },
  { unique: true }
);
recordLinkSchema.index({ taskflowOrganizationId: 1, toType: 1, toId: 1 });

export const RecordLink = mongoose.model<IRecordLink>('RecordLink', recordLinkSchema);
