import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from './config/env';

let io: Server | null = null;

export function initWebSocket(server: HttpServer): void {
  io = new Server(server, {
    cors: { origin: env.appUrl || true },
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

export function notifyPush(
  userId: string,
  payload: { title: string; body?: string; url?: string; data?: Record<string, unknown> }
): void {
  if (io) io.to(userId).emit('notification:push', payload);
}
