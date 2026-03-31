import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from './config/env';

let io: Server | null = null;

export function initWebSocket(server: HttpServer): void {
  const socketAllowedOrigins = Array.from(
    new Set(
      [env.appUrl, process.env.FRONTEND_URL]
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v) => v.trim())
    )
  );

  io = new Server(server, {
    cors: {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (socketAllowedOrigins.length === 0) return cb(null, true);
        if (socketAllowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error(`Socket CORS blocked for origin: ${origin}`));
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    path: '/socket.io',
  });

  io.use((socket: Socket, next) => {
    const token =
      (socket.handshake.auth?.token as string) ||
      (socket.handshake.query?.token as string);
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      const decoded = jwt.verify(token, env.jwtSecret) as { sub?: string };
      if (!decoded.sub) return next(new Error('Invalid token'));
      (socket as Socket & { userId: string }).userId = decoded.sub;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = (socket as Socket & { userId?: string }).userId;
    if (userId) socket.join(userId);

    socket.on('subscribe:project', (projectId: string) => {
      if (projectId && typeof projectId === 'string') {
        socket.join(`project:${projectId}`);
      }
    });

    socket.on('unsubscribe:project', (projectId: string) => {
      if (projectId && typeof projectId === 'string') {
        socket.leave(`project:${projectId}`);
      }
    });
  });
}

/** Notify all clients subscribed to a project to refresh (e.g. dashboard, kanban). */
export function notifyProjectRefresh(projectId: string): void {
  if (io) io.to(`project:${projectId}`).emit('project:refresh', { projectId });
}

export function notifyInboxNew(userId: string, message: Record<string, unknown>): void {
  if (io) io.to(userId).emit('inbox:new', message);
}

export function notifyInAppNotification(userId: string, notification: Record<string, unknown>): void {
  if (io) io.to(userId).emit('notification:new', notification);
}

export function notifyPush(
  userId: string,
  payload: { title: string; body?: string; url?: string; data?: Record<string, unknown> }
): void {
  if (io) io.to(userId).emit('notification:push', payload);
}
