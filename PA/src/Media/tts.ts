import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { EdgeTTS } from 'node-edge-tts';
import type { ReplyLang } from './lang';
import { prepareTtsText } from './prepareTtsText';

/**
 * Synthesize speech with free Edge neural TTS (Malayalam or English).
 */
export async function synthesizeSpeech(
  text: string,
  lang: ReplyLang
): Promise<{
  buffer: Buffer;
  mimetype: string;
  filename: string;
}> {
  const voice = lang === 'ml' ? 'ml-IN-SobhanaNeural' : 'en-IN-NeerjaNeural';
  const locale = lang === 'ml' ? 'ml-IN' : 'en-IN';
  const filename = `evorix-tts-${Date.now()}.mp3`;
  const audioPath = path.join(os.tmpdir(), filename);

  const tts = new EdgeTTS({
    voice,
    lang: locale,
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    timeout: 30000,
  });

  try {
    const spoken =
      prepareTtsText(text, lang) ||
      (lang === 'ml'
        ? 'മനസ്സിലായി. കൂടുതൽ വിശദാംശം പറയൂ.'
        : 'Got it. Please share a bit more detail.');

    console.log('TTS synthesize', {
      lang,
      voice,
      preview: spoken.slice(0, 80),
    });
    await tts.ttsPromise(spoken.slice(0, 800), audioPath);
    const buffer = await fs.readFile(audioPath);
    return {
      buffer,
      mimetype: 'audio/mpeg',
      filename,
    };
  } finally {
    await fs.unlink(audioPath).catch(() => undefined);
  }
}
