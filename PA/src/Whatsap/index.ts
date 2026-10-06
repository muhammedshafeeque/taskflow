import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import { whatsapp } from './client';
import { pushToDevices } from '../Push/expoPush';
import { clearBotIdCache } from './groupMention';
import { drainInbox, handleIncomingMessage } from './handler';

export { whatsapp };

let ready = false;
let authenticated = false;
let lastDisconnectReason: string | null = null;
let reconnectAttempts = 0;
let reconnectTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;
let qrPending = false;
let manualReconnect: Promise<void> | null = null;
let lastReconnectAt: string | null = null;
let latestQr: string | null = null;
let readyWatchdog: NodeJS.Timeout | null = null;
let watchdogRestarts = 0;
let alertedDown = false;

/** Seconds to wait between `authenticated` and `ready` before restarting the browser. */
const READY_TIMEOUT_MS = Math.max(30, Number(process.env.WA_READY_TIMEOUT_SEC) || 120) * 1000;
const MAX_WATCHDOG_RESTARTS = 3;

function clearReadyWatchdog() {
  if (readyWatchdog) clearTimeout(readyWatchdog);
  readyWatchdog = null;
}

/**
 * whatsapp-web.js sometimes authenticates but never fires `ready` (WA Web
 * stuck loading). Restart automatically, a few times at most, then leave it
 * for a human (the mobile app gets a push).
 */
function armReadyWatchdog() {
  clearReadyWatchdog();
  readyWatchdog = setTimeout(() => {
    readyWatchdog = null;
    if (ready || shuttingDown) return;
    if (watchdogRestarts >= MAX_WATCHDOG_RESTARTS) {
      console.error('WhatsApp still not ready after watchdog restarts — manual action needed');
      void notifyOps('WhatsApp stuck', 'Authenticated but not ready after several restarts. Open PA Control to reconnect.');
      return;
    }
    watchdogRestarts++;
    console.warn(`WhatsApp authenticated but not ready after ${READY_TIMEOUT_MS / 1000}s — restarting`, {
      attempt: watchdogRestarts,
    });
    void reconnectWhatsApp().catch(() => undefined);
  }, READY_TIMEOUT_MS);
}

async function notifyOps(title: string, body: string) {
  await pushToDevices('whatsapp', { title: `📵 ${title}`, body, critical: true });
}

/** Exponential backoff (5s → 5min) so a flapping session doesn't spin. */
function scheduleReconnect() {
  if (shuttingDown || reconnectTimer || manualReconnect) return;
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
  clearReadyWatchdog();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  await Promise.race([
    drainInbox(),
    new Promise((r) => setTimeout(r, 15_000)),
  ]);
  await whatsapp.destroy().catch(() => undefined);
}

/** Current pairing QR as a PNG data URL, or null when no scan is needed. */
export async function getWhatsAppQr(): Promise<string | null> {
  if (!qrPending || !latestQr) return null;
  return QRCode.toDataURL(latestQr, { margin: 1, width: 320 });
}

/** Send a plain text message as the business (used for human replies from the control apps). */
export async function sendWhatsAppText(chatId: string, text: string): Promise<void> {
  if (!ready) throw new Error('WhatsApp is not connected');
  await whatsapp.sendMessage(chatId, text);
}

export function getWhatsAppStatus() {
  return {
    ready,
    authenticated,
    qrPending,
    reconnecting: Boolean(manualReconnect || reconnectTimer),
    reconnectAttempts,
    lastDisconnectReason,
    lastReconnectAt,
  };
}

/**
 * Admin-triggered restart: tear down the browser and re-initialize with the
 * saved LocalAuth session. Useful when the client is stuck (e.g. authenticated
 * but never `ready`). Concurrent calls share the same in-flight restart.
 */
export function reconnectWhatsApp(): Promise<void> {
  if (shuttingDown) return Promise.reject(new Error('Server is shutting down'));
  if (manualReconnect) return manualReconnect;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
  ready = false;
  authenticated = false;
  clearReadyWatchdog();
  lastReconnectAt = new Date().toISOString();
  clearBotIdCache();
  console.warn('WhatsApp manual reconnect requested');

  manualReconnect = (async () => {
    await whatsapp.destroy().catch((err) => {
      console.warn('WhatsApp destroy before reconnect failed', err);
    });
    await whatsapp.initialize();
  })()
    .then(
      () => {
        manualReconnect = null;
      },
      (err) => {
        manualReconnect = null;
        console.error('WhatsApp manual reconnect failed', err);
        scheduleReconnect();
      }
    );

  return manualReconnect;
}

export function startWhatsApp() {
  whatsapp.on('qr', (qr) => {
    ready = false;
    qrPending = true;
    clearReadyWatchdog();
    if (latestQr === null) {
      void notifyOps('WhatsApp needs a QR scan', 'The session expired. Open PA Control → Home to scan the code.');
    }
    latestQr = qr;
    console.log('Scan this QR with WhatsApp Business → Linked devices');
    qrcode.generate(qr, { small: true });
  });

  whatsapp.on('ready', () => {
    ready = true;
    qrPending = false;
    latestQr = null;
    clearReadyWatchdog();
    watchdogRestarts = 0;
    if (alertedDown) {
      alertedDown = false;
      void pushToDevices('whatsapp', { title: '✅ WhatsApp connected', body: 'The bot is back online.' });
    }
    lastDisconnectReason = null;
    reconnectAttempts = 0;
    clearBotIdCache();
    console.log('WhatsApp client is ready');
  });

  whatsapp.on('authenticated', () => {
    authenticated = true;
    qrPending = false;
    latestQr = null;
    armReadyWatchdog();
    clearBotIdCache();
    console.log('WhatsApp authenticated');
  });

  whatsapp.on('auth_failure', (msg) => {
    authenticated = false;
    ready = false;
    clearReadyWatchdog();
    console.error('WhatsApp auth failed', msg);
    alertedDown = true;
    void notifyOps('WhatsApp auth failed', String(msg || 'Re-link the device from PA Control.'));
  });

  whatsapp.on('disconnected', (reason) => {
    ready = false;
    lastDisconnectReason = String(reason);
    clearBotIdCache();
    clearReadyWatchdog();
    console.warn('WhatsApp disconnected', reason);
    if (!alertedDown) {
      alertedDown = true;
      void notifyOps('WhatsApp disconnected', `${String(reason)} — reconnecting automatically.`);
    }
    scheduleReconnect();
  });

  whatsapp.on('message', handleIncomingMessage);

  return whatsapp.initialize();
}
