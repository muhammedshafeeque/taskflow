import mongoose, { Schema } from 'mongoose';

/**
 * A request to hire for a new position (AUT-41), usually raised by a department head.
 *
 * draft → pending_approval → approved → opened (a job opening was created from it).
 * Rejected requests can be edited and sent again; cancelled ones are final.
 */
export type HiringRequestStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'opened' | 'cancelled';
export const HIRING_REQUEST_STATUSES: HiringRequestStatus[] = ['draft', 'pending_approval', 'approved', 'rejected', 'opened', 'cancelled'];

const hiringRequestSchema = new Schema(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    department: { type: String, trim: true },
    location: { type: String, trim: true },
    employmentType: { type: String, default: 'full_time' },
    level: { type: String, trim: true },
    headcount: { type: Number, default: 1, min: 1 },
    /** Annual pay budget for each hire. */
    budgetMin: { type: Number, min: 0 },
    budgetMax: { type: Number, min: 0 },
    currency: { type: String, default: 'USD' },
    targetStartDate: { type: Date },
    justification: { type: String, default: '' },
    status: { type: String, enum: HIRING_REQUEST_STATUSES, default: 'draft', index: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    submittedAt: { type: Date },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: { type: Date },
    decisionNote: { type: String },
    /** The job opening created from it. */
    jobId: { type: Schema.Types.ObjectId, ref: 'HrmsJobOpening' },
    /** The unfilled resource demand it was raised for, if any. */
    demandId: { type: Schema.Types.ObjectId, ref: 'ResourceDemand' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
  },
  { timestamps: true }
);
hiringRequestSchema.index({ taskflowOrganizationId: 1, department: 1, status: 1 });

export const HrmsHiringRequest = mongoose.model('HrmsHiringRequest', hiringRequestSchema);
