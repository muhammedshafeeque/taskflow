import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { io, Socket } from 'socket.io-client';
import { WS_URL } from '../lib/api';

export interface PushNotificationPayload {
  title: string;
  body?: string;
  url?: string;
  data?: Record<string, unknown>;
}

interface NotificationsContextValue {
  /** Increments when a new inbox message is received (use as dependency to refetch inbox). */
  inboxVersion: number;
  /** Latest new message payload (from inbox:new event). */
  latestInboxMessage: Record<string, unknown> | null;
  /** Latest push notification (from notification:push event). */
  latestPushNotification: PushNotificationPayload | null;
  /** Dismiss the inbox toast. */
  dismissInboxToast: () => void;
  /** Dismiss the push toast. */
  dismissPushToast: () => void;
  /** Subscribe to project:refresh for a project. Returns unsubscribe. */
  subscribeProject: (projectId: string, onRefresh: () => void) => () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({
  children,
  token,
}: {
  children: ReactNode;
  token: string | null;
}) {
  const [inboxVersion, setInboxVersion] = useState(0);
  const [latestInboxMessage, setLatestInboxMessage] = useState<Record<string, unknown> | null>(null);
  const [latestPushNotification, setLatestPushNotification] = useState<PushNotificationPayload | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const projectCallbacksRef = useRef<Map<string, () => void>>(new Map());

  const dismissInboxToast = useCallback(() => {
    setLatestInboxMessage(null);
  }, []);

  const dismissPushToast = useCallback(() => {
    setLatestPushNotification(null);
  }, []);

  const subscribeProject = useCallback((projectId: string, onRefresh: () => void) => {
    projectCallbacksRef.current.set(projectId, onRefresh);
    const socket = socketRef.current;
    if (socket?.connected) socket.emit('subscribe:project', projectId);
    return () => {
      projectCallbacksRef.current.delete(projectId);
      if (socketRef.current?.connected) socketRef.current.emit('unsubscribe:project', projectId);
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    const socket: Socket = io(WS_URL, {
      auth: { token },
      path: '/socket.io',
    });
    socketRef.current = socket;
    socket.on('inbox:new', (payload: Record<string, unknown>) => {
      setLatestInboxMessage(payload);
      setInboxVersion((v) => v + 1);
    });
    socket.on('notification:push', (payload: PushNotificationPayload) => {
      setLatestPushNotification(payload);
    });
    socket.on('project:refresh', (payload: { projectId?: string }) => {
      const pid = payload?.projectId;
      if (pid && typeof pid === 'string') {
        const cb = projectCallbacksRef.current.get(pid);
        if (cb) cb();
      }
    });
    socket.on('connect', () => {
      for (const projectId of projectCallbacksRef.current.keys()) {
        socket.emit('subscribe:project', projectId);
      }
    });
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      inboxVersion,
      latestInboxMessage,
      latestPushNotification,
      dismissInboxToast,
      dismissPushToast,
      subscribeProject,
    }),
    [inboxVersion, latestInboxMessage, latestPushNotification, dismissInboxToast, dismissPushToast, subscribeProject]
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  return (
    ctx ?? {
      inboxVersion: 0,
      latestInboxMessage: null,
      latestPushNotification: null,
      dismissInboxToast: () => {},
      dismissPushToast: () => {},
      subscribeProject: () => () => {},
    }
  );
}
