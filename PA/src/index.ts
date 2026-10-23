import cors from 'cors';
import express from 'express';
import dotenv from 'dotenv';
import { adminRouter } from './Admin/routes';
import { agentDeviceRouter } from './Agent/deviceRoutes';
import { verifyGroqModels } from './Ai/models';
import { connectDB } from './Config/db';
import mongoose from 'mongoose';
import { startWhatsApp, stopWhatsApp } from './Whatsap';
import { startMonitorAlertWatcher, stopMonitorAlertWatcher } from './Admin/monitorAdmin';
import { resumeBroadcasts } from './Admin/broadcasts';

dotenv.config();

if (!process.env.GROQ_API_KEY?.trim()) {
  console.error('GROQ_API_KEY is missing. Set it in PA/.env (see .env.example).');
  process.exit(1);
}

if (!process.env.MONGODB_URI?.trim()) {
  console.error('MONGODB_URI is missing. Set it in PA/.env (see .env.example).');
  process.exit(1);
}

const app = express();
// Voice control center posts base64 audio/TTS payloads (default 100kb is too small → 413)
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

const corsOrigins = new Set<string>();
const addOrigin = (u?: string) => {
  const v = (u || '').trim().replace(/\/$/, '');
  if (v) corsOrigins.add(v);
};
addOrigin(process.env.CONTROL_CENTER_ORIGIN || 'http://localhost:5174');
for (const extra of (process.env.CONTROL_CENTER_ORIGIN_ALLOWLIST || '').split(',')) {
  addOrigin(extra);
}
// Local defaults only outside production
if (process.env.NODE_ENV !== 'production') {
  addOrigin('http://127.0.0.1:5174');
  addOrigin('http://localhost:5173');
  addOrigin('http://127.0.0.1:5173');
}
app.use(
  cors({
    origin: [...corsOrigins],
    allowedHeaders: [
      'Content-Type',
      'x-pa-admin-secret',
      'Authorization',
      'x-agent-device-token',
    ],
  })
);

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/admin', adminRouter);
app.use('/api/agent/device', agentDeviceRouter);

async function main() {
  await Promise.all([connectDB(), verifyGroqModels()]);
  await startWhatsApp();
  startMonitorAlertWatcher();
  resumeBroadcasts();

  const port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, () => {
    console.log(`PA server on port ${port}`);
  });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) process.exit(1); // second Ctrl+C forces exit
    stopping = true;
    console.log(`${signal} — shutting down gracefully`);
    server.close();
    stopMonitorAlertWatcher();
    await stopWhatsApp();
    await mongoose.disconnect().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
