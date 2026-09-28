import qrcode from 'qrcode-terminal';
import { whatsapp } from './client';
import { clearBotIdCache } from './groupMention';
import { drainInbox, handleIncomingMessage } from './handler';

export { whatsapp };

let ready = false;
let authenticated = false;
let lastDisconnectReason: string | null = null;
let reconnectAttempts = 0;
let reconnectTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;

/** Exponential backoff (5s → 5min) so a flapping session doesn't spin. */
function scheduleReconnect() {
  if (shuttingDown || reconnectTimer) return;
  const delay = Math.min(5000 * 2 ** reconnectAttempts, 5 * 60 * 1000);
  reconnectAttempts++;
  console.warn(`WhatsApp reconnect in ${Math.round(delay / 1000)}s`, {
    attempt: reconnectAttempts,
  });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    whatsapp.initialize().catch((err) => {
      console.error('WhatsApp re-initialize failed', err);
      scheduleReconnect();
    });
  }, delay);
}

/** Finish in-flight replies, then close the browser so the session persists cleanly. */
export async function stopWhatsApp(): Promise<void> {
  shuttingDown = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  await Promise.race([
    drainInbox(),
    new Promise((r) => setTimeout(r, 15_000)),
  ]);
  await whatsapp.destroy().catch(() => undefined);
}

export function getWhatsAppStatus() {
  return {
    ready,
    authenticated,
    lastDisconnectReason,
  };
}

export function startWhatsApp() {
  whatsapp.on('qr', (qr) => {
    ready = false;
    console.log('Scan this QR with WhatsApp Business → Linked devices');
    qrcode.generate(qr, { small: true });
  });

  whatsapp.on('ready', () => {
    ready = true;
    lastDisconnectReason = null;
    reconnectAttempts = 0;
    clearBotIdCache();
    console.log('WhatsApp client is ready');
  });

  whatsapp.on('authenticated', () => {
    authenticated = true;
    clearBotIdCache();
    console.log('WhatsApp authenticated');
  });

  whatsapp.on('auth_failure', (msg) => {
    authenticated = false;
    ready = false;
    console.error('WhatsApp auth failed', msg);
  });

  whatsapp.on('disconnected', (reason) => {
    ready = false;
    lastDisconnectReason = String(reason);
    clearBotIdCache();
    console.warn('WhatsApp disconnected', reason);
    scheduleReconnect();
  });

  whatsapp.on('message', handleIncomingMessage);

  return whatsapp.initialize();
}
