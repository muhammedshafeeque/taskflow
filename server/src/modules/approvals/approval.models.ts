import mongoose, { Schema } from 'mongoose';

/** Record types that can go through the shared approval engine. */
export const APPROVAL_RECORD_TYPES = ['invoice', 'quote', 'purchase_order', 'expense', 'leave', 'payroll', 'offer'] as const;
export type ApprovalRecordType = (typeof APPROVAL_RECORD_TYPES)[number];

/** How a step finds its approvers. */
/** discount_limit: anyone whose quotation discount limit covers the request's discount (AUT-31). */
export const APPROVER_KINDS = ['manager', 'role', 'users', 'permission', 'discount_limit'] as const;
export type ApproverKind = (typeof APPROVER_KINDS)[number];

const orgRef = { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true } as const;

// ── Policy: the chain for one record type ────────────────────────────────────

export interface IApprovalPolicyStep {
  name: string;
  kind: ApproverKind;
  /** kind=manager: 1 = the requester's manager, 2 = their manager's manager, … */
  level?: number;
  roleId?: mongoose.Types.ObjectId;
  userIds?: mongoose.Types.ObjectId[];
  permission?: string;
  /** The step only applies when the amount is above this. Empty = always. */
  aboveAmount?: number | null;
}

export interface IApprovalPolicy {
  _id: mongoose.Types.ObjectId;
  taskflowOrganizationId: mongoose.Types.ObjectId;
  recordType: ApprovalRecordType;
  enabled: boolean;
  steps: IApprovalPolicyStep[];
  /** Used for a step when nobody it names can approve (e.g. no manager on file). */
  fallbackUserIds: mongoose.Types.ObjectId[];
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const policyStepSchema = new Schema<IApprovalPolicyStep>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    kind: { type: String, enum: APPROVER_KINDS, required: true },
    level: { type: Number, min: 1, max: 10 },
    roleId: { type: Schema.Types.ObjectId, ref: 'Role' },
    userIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: undefined },
    permission: { type: String, trim: true },
    aboveAmount: { type: Number, default: null, min: 0 },
  },
  { _id: false }
);

const approvalPolicySchema = new Schema<IApprovalPolicy>(
  {
    taskflowOrganizationId: orgRef,
    recordType: { type: String, enum: APPROVAL_RECORD_TYPES, required: true },
    enabled: { type: Boolean, default: false },
    steps: { type: [policyStepSchema], default: [] },
    fallbackUserIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
approvalPolicySchema.index({ taskflowOrganizationId: 1, recordType: 1 }, { unique: true });

export const ApprovalPolicy = mongoose.model<IApprovalPolicy>('ApprovalPolicy', approvalPolicySchema);

// ── Request: one record going through its chain ──────────────────────────────

export type ApprovalRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type ApprovalStepStatus = 'waiting' | 'pending' | 'approved' | 'rejected' | 'skipped';

export interface IApprovalRequestStep {
  name: string;
  kind: ApproverKind;
  /** Copy of the policy step's approver settings, so editing the policy doesn't disturb open requests. */
  level?: number;
  roleId?: mongoose.Types.ObjectId;
  userIds?: mongoose.Types.ObjectId[];
  permission?: string;
  status: ApprovalStepStatus;
  /** Who may decide this step, worked out when the step starts. */
  approverIds: mongoose.Types.ObjectId[];
  decidedBy?: mongoose.Types.ObjectId;
  /** Set when a delegate decided for one of the approvers. */
  onBehalfOf?: mongoose.Types.ObjectId;
  decidedAt?: Date;
  note?: string;
}

export interface IApprovalHistoryEntry {
  at: Date;
  action: 'submitted' | 'approved' | 'rejected' | 'skipped' | 'cancelled' | 'restarted' | 'completed';
  step?: number;
  actorId?: mongoose.Types.ObjectId;
  onBehalfOf?: mongoose.Types.ObjectId;
  note?: string;
}

export interface IApprovalRequest {
  _id: mongoose.Types.ObjectId;
  taskflowOrganizationId: mongoose.Types.ObjectId;
  recordType: ApprovalRecordType;
  recordId: mongoose.Types.ObjectId;
  title: string;
  amount: number;
  currency?: string;
  link?: string;
  requestedBy: mongoose.Types.ObjectId;
  status: ApprovalRequestStatus;
  steps: IApprovalRequestStep[];
  currentStep: number;
  /** Approvers of the current step; kept at the top level so the queue is one indexed query. */
  currentApproverIds: mongoose.Types.ObjectId[];
  history: IApprovalHistoryEntry[];
  completedAt?: Date;
  /** Discount in percent of list price, for record types that have one (quotes). */
  discountPercent?: number;
  /**
   * chain: the record type's approval chain. discount_limit: the built-in approval for a quote above
   * the sender's discount limit while the quote chain is off (one step: someone whose limit covers it).
   */
  source?: 'chain' | 'discount_limit';
  createdAt: Date;
  updatedAt: Date;
}

const requestStepSchema = new Schema<IApprovalRequestStep>(
  {
    name: { type: String, required: true },
    kind: { type: String, enum: APPROVER_KINDS, required: true },
    level: Number,
    roleId: { type: Schema.Types.ObjectId, ref: 'Role' },
    userIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: undefined },
    permission: String,
    status: { type: String, enum: ['waiting', 'pending', 'approved', 'rejected', 'skipped'], default: 'waiting' },
    approverIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    onBehalfOf: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: Date,
    note: String,
  },
  { _id: false }
);

const historySchema = new Schema<IApprovalHistoryEntry>(
  {
    at: { type: Date, required: true },
    action: { type: String, required: true },
    step: Number,
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    onBehalfOf: { type: Schema.Types.ObjectId, ref: 'User' },
    note: String,
  },
  { _id: false }
);

const approvalRequestSchema = new Schema<IApprovalRequest>(
  {
    taskflowOrganizationId: orgRef,
    recordType: { type: String, enum: APPROVAL_RECORD_TYPES, required: true },
    recordId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true },
    amount: { type: Number, default: 0 },
    currency: String,
    link: String,
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
    steps: { type: [requestStepSchema], default: [] },
    currentStep: { type: Number, default: 0 },
    currentApproverIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [], index: true },
    history: { type: [historySchema], default: [] },
    completedAt: Date,
    discountPercent: Number,
    source: { type: String, enum: ['chain', 'discount_limit'], default: 'chain' },
  },
  // Two approvers clicking at once: the second save fails instead of overwriting the first.
  { timestamps: true, optimisticConcurrency: true }
);
approvalRequestSchema.index({ taskflowOrganizationId: 1, recordType: 1, recordId: 1, createdAt: -1 });

export const ApprovalRequest = mongoose.model<IApprovalRequest>('ApprovalRequest', approvalRequestSchema);

// ── Delegation: "while I'm away, X approves for me" ──────────────────────────

export interface IApprovalDelegation {
  _id: mongoose.Types.ObjectId;
  taskflowOrganizationId: mongoose.Types.ObjectId;
  fromUserId: mongoose.Types.ObjectId;
  toUserId: mongoose.Types.ObjectId;
  startsAt: Date;
  endsAt: Date;
  /** Empty = every record type. */
  recordTypes: ApprovalRecordType[];
  note?: string;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
}

const approvalDelegationSchema = new Schema<IApprovalDelegation>(
  {
    taskflowOrganizationId: orgRef,
    fromUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    toUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    recordTypes: { type: [{ type: String, enum: APPROVAL_RECORD_TYPES }], default: [] },
    note: { type: String, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);
approvalDelegationSchema.index({ taskflowOrganizationId: 1, fromUserId: 1, endsAt: 1 });

export const ApprovalDelegation = mongoose.model<IApprovalDelegation>('ApprovalDelegation', approvalDelegationSchema);
