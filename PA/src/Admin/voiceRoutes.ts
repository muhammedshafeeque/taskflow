import type { Request, Response } from 'express';
import { transcribeAudio } from '../Media/transcribe';
import { synthesizeSpeech } from '../Media/tts';
import { runVoiceCommand } from './voiceCommand';

/**
 * POST /voice/transcribe
 * Body: { audioBase64: string, mimetype?: string, language?: 'en'|'ml'|'auto' }
 */
export async function voiceTranscribe(req: Request, res: Response) {
  const body = (req.body ?? {}) as {
    audioBase64?: string;
    mimetype?: string;
    language?: string;
  };
  const audioBase64 = String(body.audioBase64 ?? '').trim();
  if (!audioBase64) {
    res.status(400).json({ success: false, error: 'audioBase64 is required' });
    return;
  }
  const mimetype = String(body.mimetype ?? 'audio/webm').trim() || 'audio/webm';
  const langRaw = String(body.language ?? '').trim().toLowerCase();
  const language =
    langRaw === 'en' || langRaw === 'ml' || langRaw === 'auto'
      ? (langRaw as 'en' | 'ml' | 'auto')
      : undefined;
  const result = await transcribeAudio(audioBase64, mimetype, language);
  res.json({ success: true, data: result });
}

/**
 * POST /voice/command
 * Body: { text: string }
 */
export async function voiceCommand(req: Request, res: Response) {
  const text = String((req.body as { text?: string })?.text ?? '').trim();
  const data = await runVoiceCommand(text);
  res.json({ success: true, data });
}

/**
 * POST /voice/speak
 * Body: { text: string, lang?: 'en'|'ml' }
 * Returns base64 mp3.
 */
export async function voiceSpeak(req: Request, res: Response) {
  const body = (req.body ?? {}) as { text?: string; lang?: string };
  const text = String(body.text ?? '').trim();
  if (!text) {
    res.status(400).json({ success: false, error: 'text is required' });
    return;
  }
  const lang = body.lang === 'ml' ? 'ml' : 'en';
  const { buffer, mimetype, filename } = await synthesizeSpeech(text, lang);
  res.json({
    success: true,
    data: {
      mimetype,
      filename,
      audioBase64: buffer.toString('base64'),
    },
  });
}
