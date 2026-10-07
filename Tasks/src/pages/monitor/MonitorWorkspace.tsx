import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { monitorApi, type MonitorApp, type MonitorEnvironment, type MonitorProjectRecord } from '../../lib/api';
import { LoadingCard } from '../../components/moduleKit';

export type MonitorFilters = {
  environmentId: string;
  appId: string;
  release: string;
  q: string;
  from: string;
  to: string;
};

type Ctx = {
  projectId: string;
  project: MonitorProjectRecord | null;
  envs: MonitorEnvironment[];
  apps: MonitorApp[];
  filters: MonitorFilters;
  setFilters: (next: MonitorFilters) => void;
  loadSetup: () => void;
  qparams: Record<string, string | undefined>;
};

const MonitorWorkspaceContext = createContext<Ctx | null>(null);

export function useMonitorWorkspace() {
  const ctx = useContext(MonitorWorkspaceContext);
  if (!ctx) throw new Error('useMonitorWorkspace must be used under MonitorWorkspace');
  return ctx;
}

export default function MonitorWorkspace({ children }: { children?: ReactNode }) {
  const { monitorProjectId = '' } = useParams();
  const { token } = useAuth();
  const [project, setProject] = useState<MonitorProjectRecord | null>(null);
  const [envs, setEnvs] = useState<MonitorEnvironment[]>([]);
  const [apps, setApps] = useState<MonitorApp[]>([]);
  const [ready, setReady] = useState(false);
  const [filters, setFilters] = useState<MonitorFilters>({
    environmentId: '',
    appId: '',
    release: '',
    q: '',
    from: '',
    to: '',
  });

  const loadSetup = useCallback(() => {
    if (!token || !monitorProjectId) return;
    monitorApi.listEnvironments(monitorProjectId, token).then((r) => {
      if (r.success && r.data) setEnvs(r.data);
    });
    monitorApi.listApps(monitorProjectId, token).then((r) => {
      if (r.success && r.data) setApps(r.data);
    });
  }, [token, monitorProjectId]);

  useEffect(() => {
    if (!token || !monitorProjectId) return;
    setReady(false);
    monitorApi.getProject(monitorProjectId, token).then((r) => {
      setReady(true);
      if (r.success && r.data) setProject(r.data);
    });
    loadSetup();
  }, [token, monitorProjectId, loadSetup]);

  const qparams = useMemo(
    () => ({
      environmentId: filters.environmentId || undefined,
      appId: filters.appId || undefined,
      release: filters.release || undefined,
      q: filters.q || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    }),
    [filters]
  );

  const value = useMemo(
    () => ({
      projectId: monitorProjectId,
      project,
      envs,
      apps,
      filters,
      setFilters,
      loadSetup,
      qparams,
    }),
    [monitorProjectId, project, envs, apps, filters, loadSetup, qparams]
  );

  if (!ready && !project) return <LoadingCard label="Opening monitor project…" />;

  return (
    <MonitorWorkspaceContext.Provider value={value}>
      {children ?? <Outlet />}
    </MonitorWorkspaceContext.Provider>
  );
}

export const monitorInputClass =
  'h-9 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-2.5 text-[13px] text-[color:var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan-400/25';

export const MONITOR_API_BASE = (
  (import.meta.env.VITE_MONITOR_BASE_URL as string | undefined) ||
  (import.meta.env.VITE_API_URL as string | undefined) ||
  `${window.location.origin}/api`
).replace(/\/+$/, '');
