import type { Chat } from 'whatsapp-web.js';

export type PresenceMode = 'typing' | 'recording';

/** WhatsApp drops chat state after ~25s, so refresh a bit before that. */
const REFRESH_MS = 20_000;

function enabled(): boolean {
  return process.env.BOT_TYPING_INDICATOR?.trim().toLowerCase() !== 'false';
}

/**
 * Mark the chat read and show "typing…" / "recording audio…" until the
 * returned stop function runs. Never throws — presence is cosmetic.
 */
export function startPresence(
  chat: Chat | null,
  mode: PresenceMode
): () => Promise<void> {
  if (!chat || !enabled()) return async () => undefined;

  void chat.sendSeen().catch(() => undefined);
  const pulse = () =>
    void (mode === 'recording'
      ? chat.sendStateRecording()
      : chat.sendStateTyping()
    ).catch(() => undefined);

  pulse();
  const timer = setInterval(pulse, REFRESH_MS);
  timer.unref?.();

  let stopped = false;
  return async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    await chat.clearState().catch(() => undefined);
  };
}
