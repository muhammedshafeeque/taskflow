import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../contexts/NotificationsContext';
import { SunIcon, MoonIcon, BellIcon, LogOutIcon } from '../icons/NavigationIcons';
import { APP_VERSION } from '../../appVersion';
import { APP_NAME } from '../../brand';
import AtriumLogo from '../AtriumLogo';
import ConfirmModal from '../ConfirmModal';
import NotificationToast from '../NotificationToast';
import SuccessToast from '../SuccessToast';
import { toAppPath } from '../../lib/navigationUrl';

export default function HomeLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const {
    latestInboxMessage,
    latestPushNotification,
    dismissInboxToast,
    dismissPushToast,
    notifications,
    unreadCount,
    markRead,
    markAllRead,
    appToast,
    dismissAppToast,
  } = useNotifications();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'dark';
    const stored = window.localStorage.getItem('taskflow_theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
  const [notifOpen, setNotifOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem('taskflow_theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  function performLogout() {
    setLogoutConfirmOpen(false);
    logout();
    navigate('/login');
  }

  return (
    <div className="min-h-screen flex flex-col bg-[color:var(--bg-page)] text-[color:var(--text-primary)]">
      <header className="shrink-0 flex items-center gap-3 px-4 sm:px-6 lg:px-8 xl:px-10 py-3 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm">
            <AtriumLogo variant="mark" className="h-7 w-7" useSvg={false} />
          </span>
          <span className="font-semibold text-[color:var(--text-primary)] hidden sm:inline tracking-tight">{APP_NAME}</span>
        </div>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <div className="relative">
            <button
              type="button"
              onClick={() => setNotifOpen((o) => !o)}
              aria-label="Notifications"
              className="relative inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)]"
            >
              <BellIcon className="w-3.5 h-3.5" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-2.5 h-2.5 rounded-full bg-[color:var(--color-blocked)] ring-2 ring-[color:var(--bg-surface)]" />
              )}
            </button>
            {notifOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setNotifOpen(false)} />
                <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] shadow-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-[color:var(--border-subtle)] flex justify-between">
                    <span className="text-xs font-semibold">Notifications</span>
                    <button type="button" onClick={() => markAllRead()} className="text-[11px] text-[color:var(--accent)]">
                      Mark all read
                    </button>
                  </div>
                  <div className="max-h-72 overflow-auto">
                    {notifications.length === 0 ? (
                      <p className="px-4 py-6 text-xs text-[color:var(--text-muted)]">No notifications yet.</p>
                    ) : (
                      <ul className="divide-y divide-[color:var(--border-subtle)]">
                        {notifications.slice(0, 15).map((n) => (
                          <li key={n._id}>
                            <Link
                              to={toAppPath(n.link || n.url || '') || '/inbox'}
                              onClick={() => {
                                if (!n.isRead && !n.readAt) markRead(n._id);
                                setNotifOpen(false);
                              }}
                              className="block px-4 py-3 hover:bg-[color:var(--bg-surface)] text-xs"
                            >
                              <div className="font-medium">{n.title}</div>
                              {n.body && <div className="text-[color:var(--text-muted)] mt-0.5 line-clamp-2">{n.body}</div>}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="px-4 py-2 border-t border-[color:var(--border-subtle)]">
                    <Link to="/inbox" className="text-[11px] text-[color:var(--accent)]" onClick={() => setNotifOpen(false)}>
                      Open inbox →
                    </Link>
                  </div>
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            aria-label="Toggle theme"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--border-subtle)] text-[color:var(--text-muted)]"
          >
            {theme === 'dark' ? <SunIcon className="w-3.5 h-3.5" /> : <MoonIcon className="w-3.5 h-3.5" />}
          </button>
          <Link to="/profile" className="text-xs font-medium text-[color:var(--text-primary)] hidden md:inline truncate max-w-[8rem]">
            {user?.name}
          </Link>
          <button
            type="button"
            onClick={() => setLogoutConfirmOpen(true)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--border-subtle)] text-[color:var(--text-muted)]"
            title="Sign out"
          >
            <LogOutIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>
      <main className="flex min-h-0 w-full flex-1 flex-col overflow-auto">
        <Outlet />
      </main>
      <footer className="shrink-0 px-4 py-2 text-center text-[10px] text-[color:var(--text-muted)] border-t border-[color:var(--border-subtle)]">
        {APP_NAME} v{APP_VERSION}
      </footer>

      <div className="fixed top-4 right-4 z-50 pointer-events-none">
        <div className="pointer-events-auto">
          {latestPushNotification && (
            <NotificationToast
              title={latestPushNotification.title}
              body={latestPushNotification.body}
              url={latestPushNotification.url}
              onDismiss={dismissPushToast}
            />
          )}
        </div>
      </div>
      <div className="fixed bottom-4 left-4 z-50 pointer-events-none">
        <div className="pointer-events-auto">
          {appToast && (
            <SuccessToast
              title={appToast.title}
              body={appToast.body}
              url={appToast.url}
              autoDismissMs={appToast.autoDismissMs ?? 5000}
              onDismiss={dismissAppToast}
            />
          )}
        </div>
      </div>
      {latestInboxMessage && (
        <div className="fixed top-16 right-4 z-50 pointer-events-auto">
          <NotificationToast
            title={(latestInboxMessage.title as string) ?? 'New message'}
            body={(latestInboxMessage.body as string) ?? ''}
            url="/inbox"
            onDismiss={dismissInboxToast}
          />
        </div>
      )}
      <ConfirmModal
        open={logoutConfirmOpen}
        title="Sign out?"
        message="You will need to sign in again to continue."
        confirmLabel="Sign out"
        variant="default"
        onConfirm={performLogout}
        onCancel={() => setLogoutConfirmOpen(false)}
      />
    </div>
  );
}
