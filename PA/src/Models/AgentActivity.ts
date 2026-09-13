import mongoose from 'mongoose';

export type AgentType =
  | 'CHAT_ANALYZER'
  | 'SUPPORT_ENGINEER'
  | 'QA_LEAD'
  | 'REPLY_CRITIC';

const agentActivitySchema = new mongoose.Schema({
  agentType: {
    type: String,
    enum: [
      'CHAT_ANALYZER',
      'SUPPORT_ENGINEER',
      'QA_LEAD',
      'REPLY_CRITIC',
    ],
    required: true,
    index: true,
  },
  projectId: { type: String },
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SupportConversation',
    index: true,
  },
  messageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SupportMessage',
  },
  groupId: { type: String, index: true },
  action: { type: String, default: '' },
  status: {
    type: String,
    enum: [
      'ANALYZING',
      'WAITING_FOR_CONTEXT',
      'RESPONDING',
      'ESCALATED_TO_QA',
      'WAITING_FOR_QA',
      'COMPLETED',
      'PENDING',
      'INVESTIGATING',
      'NEEDS_MORE_INFORMATION',
      'NOT_AN_ISSUE',
      'CONFIRMED_ISSUE',
      'DUPLICATE',
      'TICKET_CREATED',
      'FAILED',
    ],
    default: 'PENDING',
    index: true,
  },
  input: { type: mongoose.Schema.Types.Mixed },
  output: { type: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now },
});

export type AgentActivityDoc = {
  _id: mongoose.Types.ObjectId;
  agentType: AgentType;
  projectId?: string;
  conversationId?: mongoose.Types.ObjectId;
  messageId?: mongoose.Types.ObjectId;
  groupId?: string;
  action?: string;
  status?: string;
  input?: unknown;
  output?: unknown;
  createdAt?: Date;
};

export const AgentActivity = mongoose.model(
  'AgentActivity',
  agentActivitySchema
);
