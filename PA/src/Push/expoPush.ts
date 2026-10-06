import { MobilePushToken } from '../Models/MobilePush';

type Json = Record<string, unknown>;

export async function sendExpoPush(
  tokens: string[],
  msg: { title: string; body: string; data?: Json }
): Promise<number> {
  if (!tokens.length) return 0;
  let sent = 0;
  for (let i = 0; i < tokens.length; i += 100) {
    const chunk = tokens.slice(i, i + 100);
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(
          chunk.map((to) => ({
            to,
            title: msg.title,
            body: msg.body,
            data: msg.data ?? {},
            sound: 'default',
            priority: 'high',
            channelId: 'alerts',
          }))
        ),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: Array<{ status?: string; details?: { error?: string } }>;
      };
      const tickets = json.data ?? [];
      const dead: string[] = [];
      tickets.forEach((t, idx) => {
        if (t.status === 'ok') sent += 1;
        else if (t.details?.error === 'DeviceNotRegistered') dead.push(chunk[idx]);
      });
      if (dead.length) await MobilePushToken.deleteMany({ token: { $in: dead } });
    } catch (err) {
      console.warn('Expo push failed', err);
    }
  }
  return sent;
}

/**
 * Push to every registered device that opted into `kind` (devices with no
 * filter receive everything). Never throws — push is best-effort.
 */
export async function pushToDevices(
  kind: string,
  msg: { title: string; body: string; data?: Json; critical?: boolean }
): Promise<number> {
  try {
    const devices = await MobilePushToken.find().select('token kinds').lean();
    const targets = devices
      .filter(
        (d) =>
          !d.kinds?.length ||
          d.kinds.includes(kind) ||
          // "Critical only" devices still hear about outages that stop the bot.
          (msg.critical === true && d.kinds.includes('critical'))
      )
      .map((d) => d.token);
    return await sendExpoPush(targets, {
      title: msg.title,
      body: msg.body,
      data: { kind, ...(msg.data ?? {}) },
    });
  } catch (err) {
    console.warn('pushToDevices failed', err);
    return 0;
  }
}
