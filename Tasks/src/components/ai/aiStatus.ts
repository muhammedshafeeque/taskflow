import { useEffect, useState } from 'react';
import { aiApi, type AiStatus } from '../../lib/api';

let statusCache: Promise<AiStatus | null> | null = null;

/** AI availability is server config — fetch once per page load. */
export function useAiStatus(token: string | null | undefined): AiStatus | null {
  const [status, setStatus] = useState<AiStatus | null>(null);
  useEffect(() => {
    if (!token) return;
    statusCache ??= aiApi.status(token).then((r) => (r.success && r.data ? r.data : null));
    let alive = true;
    statusCache.then((s) => alive && setStatus(s));
    return () => {
      alive = false;
    };
  }, [token]);
  return status;
}
