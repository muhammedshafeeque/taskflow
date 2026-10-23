import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from './config/env';
import { toAppRelativeUrl } from './utils/notificationUrl';
import { ProjectMember } from './modules/projects/projectMember.model';
import { MonitorProject } from './modules/monitor/monitor.models';
import { OrganizationMember } from './modules/organizations/organizationMember.model';
import { User } from './modules/auth/user.model';
import {
  assertAccessTokenClaims,
  type JwtAuthClaims,
} from './middleware/assertAccessToken';
import { ApiError } from './utils/ApiError';

let io: Server | null = null;

async function canSubscribeProject(userId: string, projectId: string): Promise<boolean> {
  const user = await User.findById(userId).select('role').lean();
  if (user?.role === 'admin') return true;
  const member = await ProjectMember.exists({ project: projectId, user: userId });
  return Boolean(member);
}

async function canSubscribeMonitor(userId: string, projectId: string): Promise<boolean> {
  const user = await User.findById(userId).select('role').lean();
  if (user?.role === 'admin') return true;
  const project = await MonitorProject.findById(projectId).select('taskflowOrganizationId').lean();
  if (!project?.taskflowOrganizationId) return false;
  const member = await OrganizationMember.exists({
    organization: project.taskflowOrganizationId,
    user: userId,
    status: 'active',
  });
  return Boolean(member);
}

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
        if (socketAllowedOrigins.includes(origin)) return cb(null, true);
        if (socketAllowedOrigins.length === 0 && env.nodeEnv !== 'production') return cb(null, true);
        return cb(new Error(`Socket CORS blocked for origin: ${origin}`));
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    path: '/socket.io',
  });

  io.use((socket: Socket, next) => {
    // Prefer handshake.auth — never accept JWT from query (logs/Referer).
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      const decoded = jwt.verify(token, env.jwtSecret) as JwtAuthClaims;
      assertAccessTokenClaims(decoded);
      if (decoded.userType === 'customer') return next(new Error('Staff access required'));
      (socket as Socket & { userId: string }).userId = decoded.sub!;
      next();
    } catch (err) {
      if (err instanceof ApiError) return next(new Error(err.message));
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = (socket as Socket & { userId?: string }).userId;
    if (userId) socket.join(userId);

    socket.on('subscribe:project', (projectId: string) => {
      if (!projectId || typeof projectId !== 'string' || !userId) return;
      void canSubscribeProject(userId, projectId).then((ok) => {
        if (ok) socket.join(`project:${projectId}`);
      });
    });

    socket.on('unsubscribe:project', (projectId: string) => {
      if (projectId && typeof projectId === 'string') {
        socket.leave(`project:${projectId}`);
      }
    });

    socket.on('subscribe:monitor', (payload: { projectId?: string; environmentId?: string }) => {
      const projectId = payload?.projectId;
      if (!projectId || typeof projectId !== 'string' || !userId) return;
      void canSubscribeMonitor(userId, projectId).then((ok) => {
        if (!ok) return;
        socket.join(`monitor:${projectId}`);
        if (payload.environmentId) socket.join(`monitor:${projectId}:${payload.environmentId}`);
      });
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

export function notifyMonitorEvent(
  projectId: string,
  environmentId: string,
  channel: string,
  payload: unknown
): void {
  if (!io) return;
  const msg = { channel, payload, projectId, environmentId };
  io.to(`monitor:${projectId}`).emit('monitor:event', msg);
  if (environmentId) io.to(`monitor:${projectId}:${environmentId}`).emit('monitor:event', msg);
}

export function notifyPush(
  userId: string,
  payload: { title: string; body?: string; url?: string }
): void {
  if (io) {
    io.to(userId).emit('push:notify', {
      ...payload,
      url: payload.url ? toAppRelativeUrl(payload.url) : undefined,
    });
  }
}
