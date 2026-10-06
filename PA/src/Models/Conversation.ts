import mongoose from 'mongoose';
import type { MessageType } from '../MessageAnalyzer';
import type { ReplyLang } from '../Media/lang';

export type LeadPlatform = 'web' | 'app' | 'unknown';

export type LeadMemory = {
  topic?: string;
  platform?: LeadPlatform;
  featuresNoted?: string[];
  openQuestions?: string[];
  summary?: string;
};

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    at: { type: Date, default: Date.now },
    /** Who wrote an assistant message: the bot, or a human operator from the control apps. */
    by: { type: String, enum: ['bot', 'human'], default: undefined },
  },
  { _id: false }
);

const leadSchema = new mongoose.Schema(
  {
    topic: { type: String },
    platform: {
      type: String,
      enum: ['web', 'app', 'unknown'],
      default: 'unknown',
    },
    featuresNoted: { type: [String], default: [] },
    openQuestions: { type: [String], default: [] },
    summary: { type: String },
  },
  { _id: false }
);

const conversationSchema = new mongoose.Schema({
  chatId: { type: String, unique: true, required: true, index: true },
  messages: { type: [messageSchema], default: [] },
  lead: { type: leadSchema, default: () => ({}) },
  lastType: {
    type: String,
    enum: ['greeting', 'project_lead', 'requirement', 'support', 'random'],
  },
  lastLang: { type: String, enum: ['ml', 'en'] },
  /** Customer replied STOP — never include in broadcasts. Normal replies still work. */
  optedOut: { type: Boolean, default: false, index: true },
  optedOutAt: { type: Date },
  /** Last time the quiet-hours away message went to this chat (sent once per window). */
  awayNotifiedAt: { type: Date },
  /** Per-chat mute from control center — skips auto-reply when true. */
  autoReplyPaused: { type: Boolean, default: false, index: true },
  contactName: { type: String },
  contactPhone: { type: String },
  /** Legacy mute flag — no longer used to block replies. */
  handedOff: { type: Boolean, default: false, index: true },
  handedOffAt: { type: Date },
  /** Linked Taskflow CRM lead — chat continues; new details update this lead. */
  crmLeadId: { type: String },
  localLeadId: { type: String },
  leadCreatedAt: { type: Date },
  updatedAt: { type: Date, default: Date.now },
});

export type ConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
  at?: Date;
  by?: 'bot' | 'human';
};

export type ConversationDoc = {
  chatId: string;
  messages: ConversationMessage[];
  lead?: LeadMemory;
  lastType?: MessageType;
  lastLang?: ReplyLang;
  autoReplyPaused?: boolean;
  optedOut?: boolean;
  contactName?: string;
  contactPhone?: string;
  handedOff?: boolean;
  handedOffAt?: Date;
  crmLeadId?: string;
  localLeadId?: string;
  leadCreatedAt?: Date;
  updatedAt?: Date;
};

export const Conversation = mongoose.model('Conversation', conversationSchema);
