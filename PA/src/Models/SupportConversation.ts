import mongoose from 'mongoose';

export type SupportConversationStatus =
  | 'open'
  | 'waiting_qa'
  | 'ticketed'
  | 'resolved';

const supportConversationSchema = new mongoose.Schema({
  groupId: { type: String, required: true, index: true },
  groupName: { type: String, default: '' },
  projectIds: { type: [String], default: [] },
  status: {
    type: String,
    enum: ['open', 'waiting_qa', 'ticketed', 'resolved'],
    default: 'open',
    index: true,
  },
  ticketIds: { type: [String], default: [] },
  lastQaStatus: { type: String },
  lastPriority: { type: String },
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
});

supportConversationSchema.index({ groupId: 1, status: 1 });

export type SupportConversationDoc = {
  _id: mongoose.Types.ObjectId;
  groupId: string;
  groupName?: string;
  projectIds: string[];
  status: SupportConversationStatus;
  ticketIds: string[];
  lastQaStatus?: string;
  lastPriority?: string;
  updatedAt?: Date;
  createdAt?: Date;
};

export const SupportConversation = mongoose.model(
  'SupportConversation',
  supportConversationSchema
);
