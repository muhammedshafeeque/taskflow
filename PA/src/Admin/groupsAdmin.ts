import {
  WhatsappGroup,
  normalizeGroupProjects,
  type AtriumProjectRef,
  type WhatsappGroupDoc,
} from '../Models/WhatsappGroup';
import { whatsapp } from '../Whatsap/client';
import { listTaskflowProjects } from './taskflowContext';

export type GroupListItem = {
  chatId: string;
  name: string;
  autoReplyEnabled: boolean;
  mentionOnly: boolean;
  atriumProjects: AtriumProjectRef[];
  participantEstimate?: number;
  updatedAt?: string;
};

function chatIdOf(chat: {
  id?: { _serialized?: string } | string;
}): string {
  if (!chat.id) return '';
  if (typeof chat.id === 'string') return chat.id;
  return String(chat.id._serialized || '');
}

function toListItem(
  chatId: string,
  name: string,
  cfg: WhatsappGroupDoc | undefined,
  participantEstimate?: number
): GroupListItem {
  return {
    chatId,
    name: name || cfg?.name || chatId,
    autoReplyEnabled: Boolean(cfg?.autoReplyEnabled),
    mentionOnly: cfg?.mentionOnly !== false,
    atriumProjects: normalizeGroupProjects(cfg),
    participantEstimate,
    updatedAt: cfg?.updatedAt
      ? new Date(cfg.updatedAt).toISOString()
      : undefined,
  };
}

export async function listWhatsAppGroups(): Promise<GroupListItem[]> {
  const configs = await WhatsappGroup.find().lean();
  const byId = new Map(
    configs.map((c) => [c.chatId, c as WhatsappGroupDoc])
  );

  let live: Array<{
    id?: { _serialized?: string } | string;
    name?: string;
    isGroup?: boolean;
    participants?: unknown[];
  }> = [];

  try {
    if (whatsapp.info) {
      const chats = await whatsapp.getChats();
      live = chats.filter((c) => {
        const id = chatIdOf(c);
        return Boolean(c.isGroup) || id.endsWith('@g.us');
      }) as typeof live;
    }
  } catch (err) {
    console.warn('listWhatsAppGroups getChats failed', err);
  }

  const seen = new Set<string>();
  const rows: GroupListItem[] = [];

  for (const chat of live) {
    const chatId = chatIdOf(chat);
    if (!chatId || seen.has(chatId)) continue;
    seen.add(chatId);
    const name = String(chat.name || chatId).trim();
    const cfg = byId.get(chatId);

    if (cfg && name && name !== cfg.name) {
      await WhatsappGroup.updateOne(
        { chatId },
        { $set: { name, updatedAt: new Date() } }
      );
    }

    rows.push(
      toListItem(
        chatId,
        name,
        cfg,
        Array.isArray(chat.participants) ? chat.participants.length : undefined
      )
    );
  }

  for (const cfg of configs) {
    if (seen.has(cfg.chatId)) continue;
    rows.push(toListItem(cfg.chatId, cfg.name || cfg.chatId, cfg as WhatsappGroupDoc));
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

export async function patchWhatsAppGroup(
  chatId: string,
  patch: {
    name?: string;
    autoReplyEnabled?: boolean;
    mentionOnly?: boolean;
    atriumProjects?: AtriumProjectRef[] | null;
  }
): Promise<GroupListItem> {
  const $set: Record<string, unknown> = { updatedAt: new Date() };
  const $unset: Record<string, 1> = {};

  if (typeof patch.name === 'string') $set.name = patch.name.trim();
  if (typeof patch.autoReplyEnabled === 'boolean') {
    $set.autoReplyEnabled = patch.autoReplyEnabled;
  }
  if (typeof patch.mentionOnly === 'boolean') {
    $set.mentionOnly = patch.mentionOnly;
  }

  if (patch.atriumProjects !== undefined) {
    const cleaned = Array.isArray(patch.atriumProjects)
      ? patch.atriumProjects
          .filter((p) => p && (p.id || p.name))
          .map((p) => ({
            id: String(p.id || p.name).trim(),
            name: String(p.name || p.id).trim(),
            ...(p.key ? { key: String(p.key).trim() } : {}),
          }))
      : [];
    $set.atriumProjects = cleaned;
    // Drop legacy single fields when saving multi
    $unset.atriumProjectId = 1;
    $unset.atriumProjectName = 1;
    $unset.atriumProjectKey = 1;
  }

  const update: Record<string, unknown> = {
    $set,
    $setOnInsert: { chatId },
  };
  if (Object.keys($unset).length) update.$unset = $unset;

  const doc = await WhatsappGroup.findOneAndUpdate({ chatId }, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  }).lean();

  const saved = doc as WhatsappGroupDoc;
  return toListItem(chatId, saved.name || patch.name || chatId, saved);
}

export async function getGroupConfig(
  chatId: string
): Promise<WhatsappGroupDoc | null> {
  return (await WhatsappGroup.findOne({ chatId }).lean()) as WhatsappGroupDoc | null;
}

export { listTaskflowProjects };
