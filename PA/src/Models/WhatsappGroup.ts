import mongoose from 'mongoose';

const atriumProjectRefSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    key: { type: String },
  },
  { _id: false }
);

const whatsappGroupSchema = new mongoose.Schema({
  chatId: { type: String, unique: true, required: true, index: true },
  name: { type: String, default: '' },
  /** Opt-in: when false, group messages are ignored. */
  autoReplyEnabled: { type: Boolean, default: false, index: true },
  /** When true, only reply if the bot is @mentioned or quoted.
   * Ignored for official support groups (autoReplyEnabled + atriumProjects). */
  mentionOnly: { type: Boolean, default: true },
  /** Assigned Atrium projects — makes this the official project support group. */
  atriumProjects: { type: [atriumProjectRefSchema], default: [] },
  /** @deprecated legacy single-project fields — migrated on read */
  atriumProjectId: { type: String },
  atriumProjectName: { type: String },
  atriumProjectKey: { type: String },
  updatedAt: { type: Date, default: Date.now },
});

export type AtriumProjectRef = {
  id: string;
  name: string;
  key?: string;
};

export type WhatsappGroupDoc = {
  chatId: string;
  name?: string;
  autoReplyEnabled?: boolean;
  mentionOnly?: boolean;
  atriumProjects?: AtriumProjectRef[];
  atriumProjectId?: string;
  atriumProjectName?: string;
  atriumProjectKey?: string;
  updatedAt?: Date;
};

export const WhatsappGroup = mongoose.model('WhatsappGroup', whatsappGroupSchema);

/** Normalize legacy single project → atriumProjects[]. */
export function normalizeGroupProjects(
  doc: WhatsappGroupDoc | null | undefined
): AtriumProjectRef[] {
  if (!doc) return [];
  const list = Array.isArray(doc.atriumProjects)
    ? doc.atriumProjects
        .filter((p) => p && (p.id || p.name))
        .map((p) => ({
          id: String(p.id || p.name),
          name: String(p.name || p.id),
          key: p.key ? String(p.key) : undefined,
        }))
    : [];
  if (list.length) return list;
  if (doc.atriumProjectId || doc.atriumProjectName) {
    return [
      {
        id: String(doc.atriumProjectId || doc.atriumProjectName),
        name: String(doc.atriumProjectName || doc.atriumProjectId),
        key: doc.atriumProjectKey
          ? String(doc.atriumProjectKey)
          : undefined,
      },
    ];
  }
  return [];
}
