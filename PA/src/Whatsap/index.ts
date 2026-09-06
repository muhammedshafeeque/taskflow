import qrcode from 'qrcode-terminal';
import { whatsapp } from './client';
import { clearBotIdCache } from './groupMention';
import { handleIncomingMessage } from './handler';

export { whatsapp };

let ready = false;
let authenticated = false;
let lastDisconnectReason: string | null = null;

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
    whatsapp.initialize().catch((err) => {
      console.error('WhatsApp re-initialize failed', err);
    });
  });

  whatsapp.on('message', handleIncomingMessage);

  return whatsapp.initialize();
}
