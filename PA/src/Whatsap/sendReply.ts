import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { MessageMedia, type Message } from 'whatsapp-web.js';
import { getBotSettings } from '../Config/botSettings';
import type { ReplyLang } from '../Media/lang';
import type { MediaSource } from '../Media/resolveMessageContent';
import { synthesizeSpeech } from '../Media/tts';

const execFileAsync = promisify(execFile);

async function toOggOpus(mp3Buffer: Buffer): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ivorix-voice-'));
  const mp3Path = path.join(dir, 'in.mp3');
  const oggPath = path.join(dir, 'out.ogg');
  try {
    await fs.writeFile(mp3Path, mp3Buffer);
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      mp3Path,
      '-c:a',
      'libopus',
      '-b:a',
      '32k',
      '-vbr',
      'on',
      '-compression_level',
      '10',
      oggPath,
    ]);
    return await fs.readFile(oggPath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function sendVoiceNote(
  msg: Message,
  text: string,
  lang: ReplyLang
): Promise<void> {
  const { buffer } = await synthesizeSpeech(text, lang);
  const ogg = await toOggOpus(buffer);
  const media = new MessageMedia(
    'audio/ogg; codecs=opus',
    ogg.toString('base64'),
    `ivorix-reply-${Date.now()}.ogg`
  );

  try {
    await msg.reply(media, undefined, { sendAudioAsVoice: true });
  } catch (replyErr) {
    console.warn('msg.reply voice failed, trying chat.sendMessage', replyErr);
    const chat = await msg.getChat();
    await chat.sendMessage(media, { sendAudioAsVoice: true });
  }
}

/**
 * Voice in → voice when enabled. Text/image → text.
 * Lead handoff: alsoSendText adds a text copy after voice.
 */
export async function sendReply(
  msg: Message,
  text: string,
  source: MediaSource,
  lang: ReplyLang,
  opts?: { alsoSendText?: boolean }
): Promise<void> {
  const settings = await getBotSettings();
  const useVoice = source === 'voice' && settings.voiceRepliesEnabled;

  if (useVoice) {
    try {
      await sendVoiceNote(msg, text, lang);
    } catch (err) {
      console.error('Voice TTS reply failed; falling back to text once:', err);
      await msg.reply(text);
      return;
    }
    if (opts?.alsoSendText) {
      await msg.reply(text);
    }
    return;
  }

  await msg.reply(text);
}
