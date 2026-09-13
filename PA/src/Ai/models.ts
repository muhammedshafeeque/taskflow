/**
 * Tiered Groq chat model selection for low-cost / high-accuracy routing.
 */

export type ModelTier = 'fast' | 'strong';

const DEFAULT_FAST = 'llama-3.1-8b-instant';
const DEFAULT_STRONG = 'qwen/qwen3.8-27b';

export function fastChatModel(): string {
  return (
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
