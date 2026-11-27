import mongoose, { Schema } from 'mongoose';

/**
 * How leads and deals may move between stages, per workspace (AUT-32).
 * allowSkip: jump ahead more than one stage. allowBack: move to an earlier stage, or reopen.
 * Closing (won / lost / unqualified) is always allowed from an open stage, with a reason.
 */
export interface ICrmStageRules {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  leads: { allowSkip: boolean; allowBack: boolean };
  deals: { allowSkip: boolean; allowBack: boolean };
  updatedBy?: mongoose.Types.ObjectId;
  updatedAt?: Date;
}

const flow = { allowSkip: { type: Boolean, default: true }, allowBack: { type: Boolean, default: true } };

const schema = new Schema<ICrmStageRules>(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true },
    leads: { type: new Schema(flow, { _id: false }), default: () => ({}) },
    deals: { type: new Schema(flow, { _id: false }), default: () => ({}) },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export const CrmStageRules = mongoose.model<ICrmStageRules>('CrmStageRules', schema);
