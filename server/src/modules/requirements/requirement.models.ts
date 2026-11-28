import mongoose, { Schema } from 'mongoose';

/**
 * Requirements, customer sign-off, and change requests (AUT-44).
 *
 * A requirement has numbered versions. The BA writes a draft version and sends it for sign-off; a customer
 * user signs it off or rejects it in the portal. Once a version is signed off, the next version needs an
 * approved change request: a change request records its cost and date impact and is approved in turn by
 * the project's BA lead, its project manager (the project lead), and the customer. Approved change
 * requests are linked to the stories that deliver them.
 */

const customerActorSchema = new Schema(
  {
    customerUserId: { type: Schema.Types.ObjectId, ref: 'CustomerUser' },
    customerOrgId: { type: Schema.Types.ObjectId, ref: 'CustomerOrg' },
    /** Name typed as a signature. */
    name: { type: String, trim: true },
    email: { type: String, trim: true },
  },
  { _id: false }
);

export type SignOffDecision = 'signed' | 'rejected';

const versionSchema = new Schema({
  version: { type: Number, required: true },
  content: { type: String, default: '' },
  /** What changed in this version. */
  summary: { type: String, default: '' },
  /** The approved change request this version delivers (needed once an earlier version was signed off). */
  changeRequestId: { type: Schema.Types.ObjectId, ref: 'ChangeRequest' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now },
  sentAt: { type: Date },
  sentBy: { type: Schema.Types.ObjectId, ref: 'User' },
  signOff: {
    type: new Schema(
      {
        decision: { type: String, enum: ['signed', 'rejected'], required: true },
        by: { type: customerActorSchema },
        note: { type: String },
        at: { type: Date, required: true },
      },
      { _id: false }
    ),
    default: undefined,
  },
});

export type RequirementStatus = 'draft' | 'awaiting_signoff' | 'signed_off' | 'rejected';

const requirementSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    key: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    /** Follows the latest version: draft, sent and waiting, signed off, or rejected by the customer. */
    status: { type: String, enum: ['draft', 'awaiting_signoff', 'signed_off', 'rejected'], default: 'draft', index: true },
    versions: { type: [versionSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
requirementSchema.index({ project: 1, key: 1 }, { unique: true });
export const Requirement = mongoose.model('Requirement', requirementSchema);

export type ChangeRequestStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'cancelled';
export type ApprovalRole = 'ba_lead' | 'pm' | 'customer';
export const APPROVAL_ORDER: ApprovalRole[] = ['ba_lead', 'pm', 'customer'];

const stepSchema = new Schema(
  {
    role: { type: String, enum: APPROVAL_ORDER, required: true },
    status: { type: String, enum: ['waiting', 'pending', 'approved', 'rejected'], default: 'waiting' },
    /** Staff approver (BA lead or PM) who decided. */
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    /** Customer approver who decided. */
    customer: { type: customerActorSchema },
    note: { type: String },
    at: { type: Date },
  },
  { _id: false }
);

const changeRequestSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    key: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    /** The requirement it changes, if any. */
    requirementId: { type: Schema.Types.ObjectId, ref: 'Requirement', index: true },
    /** Extra (or saved, if negative) cost of the change. */
    costImpact: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    /** Days the delivery date moves (negative = earlier). */
    scheduleImpactDays: { type: Number, default: 0 },
    status: { type: String, enum: ['draft', 'pending', 'approved', 'rejected', 'cancelled'], default: 'draft', index: true },
    steps: { type: [stepSchema], default: () => APPROVAL_ORDER.map((role) => ({ role, status: 'waiting' })) },
    /** Stories (or other issues) that deliver the approved change. */
    linkedIssueIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Issue' }], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    submittedAt: { type: Date },
    decidedAt: { type: Date },
  },
  { timestamps: true }
);
changeRequestSchema.index({ project: 1, key: 1 }, { unique: true });
export const ChangeRequest = mongoose.model('ChangeRequest', changeRequestSchema);

/** Per project: who the BA lead is, and the counters behind REQ-n and CR-n (never reused). */
const settingsSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, unique: true },
    baLeadUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    lastRequirementNumber: { type: Number, default: 0 },
    lastChangeRequestNumber: { type: Number, default: 0 },
  },
  { timestamps: true }
);
export const RequirementSettings = mongoose.model('RequirementSettings', settingsSchema);
