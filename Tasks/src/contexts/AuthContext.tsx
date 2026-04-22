import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { authApi, type AuthUser } from '../lib/api';

const ACCESS_KEY = 'pm_access_token';
const REFRESH_KEY = 'pm_refresh_token';
const USER_KEY = 'pm_user';

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string; userType?: string }>;
  microsoftSso: (code: string, redirectUri?: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  updateUser: (user: AuthUser) => void;
  setAccessToken: (accessToken: string) => void;
  refreshUser: () => Promise<{ ok: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const s = localStorage.getItem(USER_KEY);
      return s ? (JSON.parse(s) as AuthUser) : null;
    } catch {
      return null;
    }
  });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(ACCESS_KEY));
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
  }, []);

  useEffect(() => {
    const handler = () => logout();
    window.addEventListener('auth:unauthorized', handler);
    return () => window.removeEventListener('auth:unauthorized', handler);
  }, [logout]);

  const updateUser = useCallback((next: AuthUser) => {
    setUser(next);
    localStorage.setItem(USER_KEY, JSON.stringify(next));
  }, []);

  const setAccessToken = useCallback((accessToken: string) => {
    setToken(accessToken);
    localStorage.setItem(ACCESS_KEY, accessToken);
  }, []);

  const refreshUser = useCallback(async () => {
    const accessToken = localStorage.getItem(ACCESS_KEY);
    if (!accessToken) return { ok: false, error: 'Not authenticated' };
    const res = await authApi.me(accessToken);
    if (!res.success || !res.data) {
      return { ok: false, error: (res as { message?: string }).message ?? 'Failed to refresh user' };
    }
    updateUser(res.data.user);
    return { ok: true };
  }, [updateUser]);

  useEffect(() => {
    let mounted = true;
    if (!token) {
      setLoading(false);
    } else {
      refreshUser().finally(() => {
        if (mounted) setLoading(false);
      });
    }
    return () => { mounted = false; };
  }, [refreshUser]); // runs when the component mounts or refreshUser is re-created

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await authApi.login(email, password);
      if (!res.success || !res.data) {
        return { ok: false, error: (res as { message?: string }).message ?? 'Login failed' };
      }
      setUser(res.data.user);
      setToken(res.data.tokens.accessToken);
      localStorage.setItem(ACCESS_KEY, res.data.tokens.accessToken);
      localStorage.setItem(REFRESH_KEY, res.data.tokens.refreshToken);
      localStorage.setItem(USER_KEY, JSON.stringify(res.data.user));
      return { ok: true, userType: res.data.user.userType };
    },
    []
  );

  const microsoftSso = useCallback(async (code: string, redirectUri?: string) => {
    const res = await authApi.microsoftSso(code, redirectUri);
    if (!res.success || !res.data) {
      return { ok: false, error: (res as { message?: string }).message ?? 'SSO login failed' };
    }
    setUser(res.data.user);
    setToken(res.data.tokens.accessToken);
    localStorage.setItem(ACCESS_KEY, res.data.tokens.accessToken);
    localStorage.setItem(REFRESH_KEY, res.data.tokens.refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(res.data.user));
    return { ok: true };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      loading,
      login,
      microsoftSso,
      logout,
      updateUser,
      setAccessToken,
      refreshUser,
    }),
    [user, token, loading, login, microsoftSso, logout, updateUser, setAccessToken, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
