import express from 'express';
import passport from 'passport';
import cors from 'cors';
import helmet from 'helmet';
import { apiRoutes } from './routes';
import { errorHandler } from './middleware/errorHandler';
import morgan from 'morgan';
import { env } from './config/env';
import { monitorHttp, monitorLog, monitorTransaction, shouldSkipMonitorHttp } from './shared/monitorClient';

const app = express();

// Behind nginx/a load balancer, set TRUST_PROXY (e.g. 1) so rate limits see the real client IP.
if (process.env.TRUST_PROXY) {
  const v = process.env.TRUST_PROXY;
  app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : v === 'true' ? true : v);
}
app.use(passport.initialize());

// Allow the frontend (different origin in dev) to load uploaded images/videos.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // SPA embeds Atrium; API itself is not framed. Keep defaults permissive for frameAncestors on API responses.
    contentSecurityPolicy: false,
    frameguard: false,
  })
);
const allowedOrigins = Array.from(
  new Set(
    [env.appUrl, process.env.FRONTEND_URL]
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim())
  )
);

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow same-origin / non-browser requests (curl, server-to-server).
      if (!origin) return cb(null, true);
      // Always allow configured frontends; never open CORS when unset in production.
      if (allowedOrigins.includes(origin)) return cb(null, true);
      if (allowedOrigins.length === 0 && env.nodeEnv !== 'production') {
        return cb(null, true);
      }
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Organization-Id', 'X-Monitor-Key'],
  })
);
app.use(
  express.json({
    // Payment and GitHub webhooks verify an HMAC over the exact bytes received.
    verify: (req, _res, buf) => {
      if (/^\/api\/webhooks\/(payments|github)/.test((req as { url?: string }).url ?? '')) {
        (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      }
    },
  })
);
app.use((req, res, next) => {
  if (shouldSkipMonitorHttp(req.originalUrl)) return next();
  const started = Date.now();
  res.on('finish', () => {
    if (res.statusCode === 304) return;
    const durationMs = Date.now() - started;
    const url = req.originalUrl;
    const noisy =
      url.includes('/api/auth/me') ||
      url.includes('/api/core/modules') ||
      url.includes('/api/notifications');
    if (noisy && res.statusCode < 400 && durationMs < 1500) return;
    monitorHttp({
      method: req.method,
      url,
      status: res.statusCode,
      durationMs,
      direction: 'in',
    });
    if (res.statusCode >= 400 || durationMs >= 800) {
      monitorTransaction(`${req.method} ${req.path}`, durationMs, String(res.statusCode));
    }
    if (res.statusCode >= 500) {
      monitorLog(`${req.method} ${url} → ${res.statusCode} (${durationMs}ms)`, 'error');
    }
  });
  next();
});
app.use(morgan('dev'));
app.use('/api', apiRoutes);

app.use(errorHandler);

export default app;
