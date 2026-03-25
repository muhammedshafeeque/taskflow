import mongoose, { Document, Schema } from 'mongoose';

export type NotificationType =
  | 'mention'
  | 'watch_comment'
  | 'watch_status'
  | 'watch_field'
  | 'issue_assigned'
  | 'issue_unassigned'
  | 'subtask_change'
  | 'invitation_accepted';

export interface INotification extends Document {
  toUser: mongoose.Types.ObjectId;
  type: NotificationType;
  title: string;
  body?: string;
  url?: string;
  readAt?: Date | null;
  meta?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    toUser: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true, index: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    url: { type: String, default: '' },
    readAt: { type: Date, default: null, index: true },
    meta: { type: Schema.Types.Mixed, default: undefined },
  },
  { timestamps: true }
);

notificationSchema.index({ toUser: 1, createdAt: -1 });

export const Notification = mongoose.model<INotification>('Notification', notificationSchema);

