import mongoose, { Schema } from 'mongoose';

/**
 * Sales-to-delivery handover for a won deal (AUT-41). Sales works through the checklist and sends it to
 * the project manager, who accepts it or returns it with a note saying what is missing.
 *
 * open → submitted → accepted, or submitted → returned → submitted again. Reopening or losing the deal
 * cancels a handover that was not accepted yet; winning it again opens it again.
 */
export type HandoverStatus = 'open' | 'submitted' | 'returned' | 'accepted' | 'cancelled';
export const HANDOVER_STATUSES: HandoverStatus[] = ['open', 'submitted', 'returned', 'accepted', 'cancelled'];

const itemSchema = new Schema({
  title: { type: String, required: true, trim: true },
  required: { type: Boolean, default: true },
  done: { type: Boolean, default: false },
  doneBy: { type: Schema.Types.ObjectId, ref: 'User' },
  doneAt: { type: Date },
  note: { type: String, trim: true },
});

const handoverSchema = new Schema(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    dealId: { type: Schema.Types.ObjectId, ref: 'CrmDeal', required: true, unique: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    status: { type: String, enum: HANDOVER_STATUSES, default: 'open', index: true },
    items: { type: [itemSchema], default: [] },
    /** What delivery needs to know: scope, promises made, contacts, risks. */
    notes: { type: String, default: '' },
    /** The project manager who accepts it; the delivery project's lead by default. */
    pmUserId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    submittedAt: { type: Date },
    acceptedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    acceptedAt: { type: Date },
    returnedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    returnedAt: { type: Date },
    returnNote: { type: String },
  },
  { timestamps: true }
);
export const CrmHandover = mongoose.model('CrmHandover', handoverSchema);

/** The checklist every new handover starts with, per workspace. */
const templateSchema = new Schema(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true },
    items: {
      type: [new Schema({ title: { type: String, required: true, trim: true }, required: { type: Boolean, default: true } }, { _id: false })],
      default: [],
    },
  },
  { timestamps: true }
);
export const CrmHandoverTemplate = mongoose.model('CrmHandoverTemplate', templateSchema);

export const DEFAULT_HANDOVER_ITEMS = [
  { title: 'Scope and deliverables agreed with the customer', required: true },
  { title: 'Signed contract or accepted quote attached', required: true },
  { title: 'Customer contacts and decision makers listed', required: true },
  { title: 'Timeline, milestones and go-live date', required: true },
  { title: 'Billing terms and payment schedule', required: true },
  { title: 'Promises, assumptions and risks noted', required: false },
];
