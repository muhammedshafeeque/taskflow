import mongoose, { Document, Schema } from 'mongoose';

export const UPDATE_TYPES = ['feature', 'improvement', 'fix', 'security', 'other'] as const;
export type AppUpdateType = (typeof UPDATE_TYPES)[number];

export interface IAppUpdate extends Document {
  updateId: string;
  date: string;
  type: AppUpdateType;
  title: string;
  details: string;
  contentHash: string;
  createdAt: Date;
  updatedAt: Date;
}

const appUpdateSchema = new Schema<IAppUpdate>(
  {
    updateId: { type: String, required: true, unique: true, trim: true },
    date: { type: String, required: true, trim: true },
    type: { type: String, enum: UPDATE_TYPES, required: true },
    title: { type: String, required: true, trim: true },
    details: { type: String, required: true, trim: true },
    contentHash: { type: String, required: true },
  },
  {
    timestamps: true,
    collection: 'app_updates',
  }
);

export const AppUpdate = mongoose.model<IAppUpdate>('AppUpdate', appUpdateSchema);

export interface IUserUpdateAcknowledgement extends Document {
  userId: mongoose.Types.ObjectId;
  updateId: string;
  acknowledgedAt: Date;
}

const userUpdateAcknowledgementSchema = new Schema<IUserUpdateAcknowledgement>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updateId: { type: String, required: true, trim: true },
    acknowledgedAt: { type: Date, required: true, default: Date.now },
  },
  {
    collection: 'user_update_acknowledgements',
  }
);

userUpdateAcknowledgementSchema.index({ userId: 1, updateId: 1 }, { unique: true });

export const UserUpdateAcknowledgement = mongoose.model<IUserUpdateAcknowledgement>(
  'UserUpdateAcknowledgement',
  userUpdateAcknowledgementSchema
);
