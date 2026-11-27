import mongoose, { Schema } from 'mongoose';

/**
 * A job offer to a candidate (AUT-37): drafted, approved (salary), sent with a private link, and
 * accepted or declined online by the candidate.
 */
export const OFFER_STATUSES = ['draft', 'pending_approval', 'approved', 'sent', 'accepted', 'declined', 'withdrawn'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

const offerSchema = new Schema(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    candidateId: { type: Schema.Types.ObjectId, ref: 'HrmsCandidate', required: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'HrmsJobOpening', required: true },
    status: { type: String, enum: OFFER_STATUSES, default: 'draft', index: true },
    designation: { type: String, trim: true },
    annualCtc: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'USD' },
    joiningDate: { type: Date },
    expiresAt: { type: Date },
    /** The letter as sent: the template with the offer's details filled in, editable while a draft. */
    letter: { type: String, default: '' },
    /** Pay above the opening's salary band. */
    aboveBand: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    rejectionNote: String,
    sentAt: Date,
    sentTo: String,
    response: {
      type: new Schema({ decision: { type: String, enum: ['accepted', 'declined'] }, name: String, note: String, at: Date }, { _id: false }),
      default: undefined,
    },
  },
  { timestamps: true }
);
// One live offer per candidate: draft, in approval, approved or out with them.
offerSchema.index(
  { candidateId: 1 },
  { unique: true, name: 'one_live_offer_per_candidate', partialFilterExpression: { status: { $in: ['draft', 'pending_approval', 'approved', 'sent'] } } }
);
offerSchema.index({ candidateId: 1, createdAt: -1 });

export const HrmsOffer = mongoose.model('HrmsOffer', offerSchema);
