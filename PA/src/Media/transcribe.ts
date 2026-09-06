import { toFile } from 'groq-sdk';
import { getBotSettings } from '../Config/botSettings';
import { getGroq } from '../Config/groq';

const DEFAULT_WHISPER = 'whisper-large-v3';

export type TranscriptionResult = {
  text: string;
  /** ISO-639-1 / name from Whisper when available. */
  language?: string;
};

function extensionForMime(mimetype: string): string {
  const base = mimetype.split(';')[0]?.trim().toLowerCase() ?? '';
  if (base.includes('ogg') || base.includes('opus')) return 'ogg';
  if (base.includes('mpeg') || base.includes('mp3')) return 'mp3';
  if (base.includes('mp4') || base.includes('m4a')) return 'm4a';
  if (base.includes('wav')) return 'wav';
  if (base.includes('webm')) return 'webm';
  if (base.includes('flac')) return 'flac';
  return 'ogg';
}

/**
 * Transcribe voice.
 * @param languageOverride - when set (e.g. control-center English commands), ignore BotSettings STT.
 */
export async function transcribeAudio(
  base64Data: string,
  mimetype: string,
  languageOverride?: 'ml' | 'en' | 'auto'
): Promise<TranscriptionResult> {
  const buffer = Buffer.from(base64Data, 'base64');
  const ext = extensionForMime(mimetype);
  const file = await toFile(buffer, `voice.${ext}`, {
    type: mimetype.split(';')[0],
  });

  const settings = await getBotSettings();
  const forced =
    languageOverride ||
    settings.sttLanguage ||
    process.env.GROQ_STT_LANGUAGE?.trim().toLowerCase() ||
    'ml';
  const model = process.env.GROQ_WHISPER_MODEL?.trim() || DEFAULT_WHISPER;

  const language =
    forced === 'auto' ? undefined : forced === 'en' ? 'en' : 'ml';

  const result = await getGroq().audio.transcriptions.create({
    file,
    model,
    prompt:
      language === 'en'
        ? 'Transcribe clear English. Speakers discuss business, projects, leads, WhatsApp, Atrium, Taskflow, Ivorix.'
        : 'Transcribe Malayalam speech in Malayalam script when possible. English product words (app, billing, features) may appear.',
    ...(language ? { language } : {}),
    response_format: 'verbose_json',
    temperature: 0,
  });

  const raw = result as { text?: string; language?: string };
  const text = raw.text?.trim() ?? '';
  const detected = raw.language?.trim().toLowerCase() ?? language ?? 'malayalam';

  console.log('Whisper result', {
    language: detected,
    forced: language ?? 'auto',
    model,
    preview: text.slice(0, 120),
  });

  return { text, language: detected };
}
