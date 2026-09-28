/**
 * Tiered Groq chat model selection for low-cost / high-accuracy routing.
 */

export type ModelTier = 'fast' | 'strong';

import { getGroq } from '../Config/groq';

const DEFAULT_FAST = 'openai/gpt-oss-20b';
const DEFAULT_STRONG = 'qwen/qwen3.8-27b';

/** Set by verifyGroqModels() when the configured fast model is unavailable. */
let fastOverride: string | null = null;

export function fastChatModel(): string {
  return (
    fastOverride ||
    process.env.GROQ_FAST_MODEL?.trim() ||
    process.env.SUPPORT_FAST_MODEL?.trim() ||
    DEFAULT_FAST
  );
}

/** Strong model for QA, polished replies, hard DMs. */
export function strongChatModel(): string {
  return (
    process.env.SUPPORT_STRONG_MODEL?.trim() ||
    process.env.SUPPORT_CHAT_MODEL?.trim() ||
    process.env.GROQ_CHAT_MODEL?.trim() ||
    process.env.GROQ_MODEL?.trim() ||
    DEFAULT_STRONG
  );
}

/** @deprecated Prefer strongChatModel / fastChatModel — kept for callers. */
export function supportChatModel(): string {
  return strongChatModel();
}

export function modelForTier(tier: ModelTier): string {
  return tier === 'fast' ? fastChatModel() : strongChatModel();
}

/**
 * gpt-oss reasons before answering and that counts against max_tokens;
 * low effort keeps short JSON/classify calls fast and untruncated.
 */
export function reasoningParams(model: string): {
  reasoning_effort?: 'low';
} {
  return /gpt-oss/i.test(model) ? { reasoning_effort: 'low' } : {};
}

/**
 * Startup check: Groq retires models (llama-3.1-8b-instant 404'd silently and
 * every fast agent fell back to rules). Fail loud and fall back to strong.
 */
export async function verifyGroqModels(): Promise<void> {
  let available: Set<string>;
  try {
    const list = await getGroq().models.list();
    available = new Set(list.data.map((m) => m.id));
  } catch (err) {
    console.warn('Could not list Groq models — skipping model check', err);
    return;
  }

  const strong = strongChatModel();
  if (!available.has(strong)) {
    console.error(
      `Groq strong model "${strong}" is not available. Set GROQ_CHAT_MODEL to one of: ${[...available].join(', ')}`
    );
  }
  const fast = fastChatModel();
  if (!available.has(fast)) {
    fastOverride = available.has(DEFAULT_FAST) ? DEFAULT_FAST : strong;
    console.error(
      `Groq fast model "${fast}" is not available — using "${fastOverride}". Update GROQ_FAST_MODEL.`
    );
  }
  const whisper = process.env.GROQ_WHISPER_MODEL?.trim() || 'whisper-large-v3';
  if (!available.has(whisper)) {
    console.error(`Groq Whisper model "${whisper}" is not available — voice notes will fail.`);
  }
}

export type AgentCallLog = {
  agent: string;
  tier: ModelTier | 'none';
  model?: string;
  skipped?: boolean;
  reason?: string;
};

export function pushAgentCall(
  log: AgentCallLog[],
  entry: AgentCallLog
): void {
  log.push(entry);
}
