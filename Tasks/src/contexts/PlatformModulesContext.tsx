import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { coreApi } from '../lib/api';
import { useAuth } from './AuthContext';
import {
  isModuleEnabled,
  type EnabledModulesMap,
  type ModuleId,
} from '../utils/moduleAccess';

interface PlatformModulesContextValue {
  enabledModules: EnabledModulesMap | null;
  loading: boolean;
  refresh: () => Promise<void>;
  isEnabled: (moduleId: ModuleId) => boolean;
}

const PlatformModulesContext = createContext<PlatformModulesContextValue | null>(null);

export function PlatformModulesProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [enabledModules, setEnabledModules] = useState<EnabledModulesMap | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) {
      setEnabledModules(null);
      return;
    }
    setLoading(true);
    try {
      const res = await coreApi.getModules(token);
      if (res.success && res.data) {
        setEnabledModules(res.data as EnabledModulesMap);
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isEnabled = useCallback(
    (moduleId: ModuleId) => isModuleEnabled(moduleId, enabledModules),
    [enabledModules]
  );

  const value = useMemo(
    () => ({ enabledModules, loading, refresh, isEnabled }),
    [enabledModules, loading, refresh, isEnabled]
  );

  return (
    <PlatformModulesContext.Provider value={value}>{children}</PlatformModulesContext.Provider>
  );
}

export function usePlatformModules() {
  const ctx = useContext(PlatformModulesContext);
  if (!ctx) {
    return {
      enabledModules: null as EnabledModulesMap | null,
      loading: false,
      refresh: async () => undefined,
      isEnabled: (moduleId: ModuleId) => isModuleEnabled(moduleId, null),
    };
  }
  return ctx;
}
