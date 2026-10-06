import mongoose from 'mongoose';

export type BroadcastAudience = {
  /** Only chats active within this many days (default 30). */
  activeWithinDays?: number;
  lang?: 'ml' | 'en';
  /** Only chats that produced a lead. */
  leadsOnly?: boolean;
  /** Explicit chat ids (overrides the filters above when non-empty). */
  chatIds?: string[];
};

export type BroadcastStatus = 'draft' | 'sending' | 'paused' | 'done' | 'cancelled';

const broadcastSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    message: { type: String, required: true },
    audience: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['draft', 'sending', 'paused', 'done', 'cancelled'],
      default: 'draft',
      index: true,
    },
    /** Resolved at send time so later chats don't sneak in. */
    recipients: { type: [String], default: [] },
    sent: { type: [String], default: [] },
    failed: { type: [{ chatId: String, error: String }], default: [] },
    skippedOptOut: { type: Number, default: 0 },
    startedAt: { type: Date },
    finishedAt: { type: Date },
  },
  { timestamps: true }
);

export const Broadcast = mongoose.model('Broadcast', broadcastSchema);

const messageTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    /** Where it shows up: quick replies in a chat, broadcasts, or both. */
    usage: { type: String, enum: ['reply', 'broadcast', 'both'], default: 'both' },
  },
  { timestamps: true }
);

export const MessageTemplate = mongoose.model('MessageTemplate', messageTemplateSchema);
