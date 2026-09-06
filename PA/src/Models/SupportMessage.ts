import mongoose from 'mongoose';

const supportMessageSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SupportConversation',
    index: true,
  },
  groupId: { type: String, required: true, index: true },
  whatsappMessageId: { type: String, index: true },
  senderId: { type: String },
  senderName: { type: String },
  senderPhone: { type: String },
  message: { type: String, default: '' },
  messageType: {
    type: String,
    enum: ['user', 'assistant', 'system'],
    default: 'user',
  },
  replyToMessageId: { type: String },
  analysis: { type: mongoose.Schema.Types.Mixed },
  agentOutputs: { type: mongoose.Schema.Types.Mixed },
  ticketId: { type: String },
  createdAt: { type: Date, default: Date.now },
});

export type SupportMessageDoc = {
  _id: mongoose.Types.ObjectId;
  conversationId?: mongoose.Types.ObjectId;
  groupId: string;
  whatsappMessageId?: string;
  senderId?: string;
  senderName?: string;
  senderPhone?: string;
  message: string;
  messageType: 'user' | 'assistant' | 'system';
  replyToMessageId?: string;
  analysis?: unknown;
  agentOutputs?: unknown;
  ticketId?: string;
  createdAt?: Date;
};

export const SupportMessage = mongoose.model(
  'SupportMessage',
  supportMessageSchema
);
