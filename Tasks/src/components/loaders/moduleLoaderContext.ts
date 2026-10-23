import { createContext, useContext } from 'react';
import type { ModuleId } from '../../utils/moduleAccess';

/** Set by each module layout so loaders inside it pick that module's scene automatically. */
export const ModuleLoaderContext = createContext<ModuleId | null>(null);

export function useCurrentModule(): ModuleId | null {
  return useContext(ModuleLoaderContext);
}
