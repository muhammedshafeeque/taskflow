import type { Message, MessageMedia } from 'whatsapp-web.js';
import { getBotSettings } from '../Config/botSettings';
import { isLowQualityTranscript } from '../Memory/conversationMemory';
import { detectReplyLang, type ReplyLang } from './lang';
import { transcribeAudio } from './transcribe';

export type MediaSource = 'text' | 'voice' | 'image';

export type ResolvedContent = {
  text: string;
  source: MediaSource;
  lang: ReplyLang;
  /** Image with no caption — skip AI vision; ask user to describe. */
  imageNeedsDescription?: boolean;
};

const VOICE_TYPES = new Set(['ptt', 'audio']);
const IMAGE_TYPES = new Set(['image']);

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function downloadMediaWithRetry(
  msg: Message,
  attempts = 3
): Promise<MessageMedia | null> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      if (i > 0) await sleep(800 * i);
      const media = await msg.downloadMedia();
      if (media?.data) return media;
    } catch (err) {
      lastErr = err;
      console.warn(`downloadMedia attempt ${i + 1}/${attempts} failed`, err);
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

/**
 * Turn a WhatsApp message into analyzable text (plain text or STT).
 * Images: caption only — no vision model.
 */
export async function resolveMessageContent(
  msg: Message
): Promise<ResolvedContent | null> {
  const type = msg.type;

  if (VOICE_TYPES.has(type)) {
    if (!msg.hasMedia) return null;
    const media = await downloadMediaWithRetry(msg);
    if (!media?.data) return null;

    let { text, language } = await transcribeAudio(
      media.data,
      media.mimetype || 'audio/ogg'
    );
    if (!text) return null;

    // Low-quality forced-language transcript → one auto-language retry
    const settings = await getBotSettings();
    const forcedLang = (
      settings.sttLanguage ||
      process.env.GROQ_STT_LANGUAGE?.trim().toLowerCase() ||
      'ml'
    ).toLowerCase();
    if (isLowQualityTranscript(text) && forcedLang !== 'auto') {
      console.log('STT low quality — retry with auto language', {
        from: msg.from,
        preview: text.slice(0, 80),
      });
      try {
        const retry = await transcribeAudio(
          media.data,
          media.mimetype || 'audio/ogg',
          'auto'
        );
        if (retry.text && !isLowQualityTranscript(retry.text)) {
          text = retry.text;
          language = retry.language;
        } else if (retry.text && retry.text.length > text.length) {
          text = retry.text;
          language = retry.language;
        }
      } catch (err) {
        console.warn('STT auto retry failed', err);
      }
    }

    const lang = detectReplyLang(text, language);
    console.log('Voice transcribed', {
      from: msg.from,
      lang,
      whisperLang: language ?? null,
      preview: text.slice(0, 120),
    });
    return { text, source: 'voice', lang };
  }

  if (IMAGE_TYPES.has(type)) {
    const caption = msg.body?.trim() ?? '';
    if (!caption) {
      return {
        text: '',
        source: 'image',
        lang: 'en',
        imageNeedsDescription: true,
      };
    }
    console.log('Image caption only', {
      from: msg.from,
      preview: caption.slice(0, 80),
    });
    return { text: caption, source: 'image', lang: detectReplyLang(caption) };
  }

  const text = msg.body?.trim() ?? '';
  if (!text) return null;
  return { text, source: 'text', lang: detectReplyLang(text) };
}
