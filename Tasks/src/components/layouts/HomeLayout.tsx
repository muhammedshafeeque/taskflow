import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../contexts/NotificationsContext';
import { SunIcon, MoonIcon, BellIcon, LogOutIcon } from '../icons/NavigationIcons';
import { APP_VERSION } from '../../appVersion';
import { APP_NAME } from '../../brand';
import { useAppDisplayName } from '../../hooks/useAppDisplayName';
import AtriumLogo from '../AtriumLogo';
import ConfirmModal from '../ConfirmModal';
import NotificationToast from '../NotificationToast';
import SuccessToast from '../SuccessToast';
import { toAppPath } from '../../lib/navigationUrl';

export default function HomeLayout() {
  const { user, logout } = useAuth();
  const displayName = useAppDisplayName();
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

  const initials = (user?.name?.trim().charAt(0) || user?.email?.charAt(0) || '?').toUpperCase();

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-[color:var(--bg-page)] text-[color:var(--text-primary)]">
      <header className="hub-topbar z-30 shrink-0 border-b border-[color:var(--border-subtle)]/80 bg-[color:var(--bg-page)]/95 backdrop-blur-md">
        <div className="flex h-12 w-full items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Link
            to="/"
            className="flex min-w-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/40"
            title={`${APP_NAME} home`}
            aria-label={`${APP_NAME} home`}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white shadow-sm">
              <AtriumLogo variant="mark" className="h-6 w-6" useSvg={false} />
            </span>
            <span className="truncate text-[15px] font-semibold tracking-tight text-[color:var(--text-primary)]">
              {APP_NAME}
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((o) => !o)}
                aria-label="Notifications"
                className="hub-icon-btn relative"
              >
                <BellIcon className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-sm bg-[color:var(--color-blocked)]" />
                )}
              </button>
              {notifOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setNotifOpen(false)} />
                  <div className="absolute right-0 z-20 mt-2 w-80 overflow-hidden rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-lg">
                    <div className="flex justify-between border-b border-[color:var(--border-subtle)] px-4 py-3">
                      <span className="text-xs font-semibold">Notifications</span>
                      <button
                        type="button"
                        onClick={() => markAllRead()}
                        className="text-[11px] text-[color:var(--accent)]"
                      >
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
                                className="block px-4 py-3 text-xs hover:bg-[color:var(--bg-surface)]"
                              >
                                <div className="font-medium">{n.title}</div>
                                {n.body && (
                                  <div className="mt-0.5 line-clamp-2 text-[color:var(--text-muted)]">{n.body}</div>
                                )}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="border-t border-[color:var(--border-subtle)] px-4 py-2">
                      <Link
                        to="/inbox"
                        className="text-[11px] text-[color:var(--accent)]"
                        onClick={() => setNotifOpen(false)}
                      >
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
              className="hub-icon-btn"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
            </button>

            <Link
              to="/profile"
              className="hidden items-center gap-2 rounded-md px-1.5 py-1 text-[color:var(--text-primary)] transition hover:bg-[color:var(--bg-elevated)] md:inline-flex"
              title="Profile"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[color:var(--bg-elevated)] text-[11px] font-semibold">
                {initials}
              </span>
              <span className="max-w-[8rem] truncate text-[12px] font-medium">{user?.name}</span>
            </Link>

            <button
              type="button"
              onClick={() => setLogoutConfirmOpen(true)}
              className="hub-icon-btn"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOutIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>

      <footer className="sr-only">
        {displayName} · v{APP_VERSION}
      </footer>

      <div className="pointer-events-none fixed top-4 right-4 z-50">
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
      <div className="pointer-events-none fixed bottom-4 left-4 z-50">
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
        <div className="pointer-events-auto fixed top-16 right-4 z-50">
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
