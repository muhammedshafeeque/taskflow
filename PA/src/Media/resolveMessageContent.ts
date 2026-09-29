import type { Message, MessageMedia } from 'whatsapp-web.js';
import { getBotSettings } from '../Config/botSettings';
import { isLowQualityTranscript } from '../Memory/conversationMemory';
import { detectReplyLang, type ReplyLang } from './lang';
import { downloadAndDecrypt, encryptedMediaRef } from './decryptMedia';
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

type DownloadedMedia = Pick<MessageMedia, 'data' | 'mimetype'>;

/** whatsapp-web.js first; if WA Web refuses, fetch + decrypt from the CDN directly. */
async function downloadMediaWithRetry(
  msg: Message,
  attempts = 2
): Promise<DownloadedMedia | null> {
  let lastErr: unknown;
  try {
    const media = await msg.downloadMedia();
    if (media?.data) return media;
  } catch (err) {
    lastErr = err;
    console.warn('downloadMedia failed — trying direct decrypt', {
      from: msg.from,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const ref = encryptedMediaRef(msg);
  if (!ref) {
    console.warn('Direct decrypt unavailable — no media key on message', {
      from: msg.from,
    });
    if (lastErr) throw lastErr;
    return null;
  }
  for (let i = 0; i < attempts; i++) {
    try {
      if (i > 0) await sleep(800 * i);
      const buf = await downloadAndDecrypt(ref);
      return {
        data: buf.toString('base64'),
        mimetype: ref.mimetype || 'audio/ogg',
      };
    } catch (err) {
      lastErr = err;
      console.warn(`Direct decrypt attempt ${i + 1}/${attempts} failed`, {
        from: msg.from,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  throw lastErr;
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
