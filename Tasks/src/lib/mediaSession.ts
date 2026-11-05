import { useSyncExternalStore } from 'react';
import { mediaSessionApi } from './api';

/** Well inside the server's cookie lifetime, so an open tab never loses access. */
export const MEDIA_SESSION_RENEW_MS = 6 * 60 * 60 * 1000;

let ready = false;
const listeners = new Set<() => void>();

function setReady(next: boolean) {
  if (ready === next) return;
  ready = next;
  listeners.forEach((l) => l());
}

/**
 * Sets the cookie that lets <video> and "Open" links read auth-gated uploads.
 * Ready even when this fails, so media shows its normal error instead of never loading.
 */
export async function openMediaSession(token: string): Promise<void> {
  try {
    await mediaSessionApi.open(token);
  } catch {
    /* offline; the next renewal retries */
  }
  setReady(true);
}

export function closeMediaSession(): void {
  setReady(false);
  void mediaSessionApi.close().catch(() => {});
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Hold back <video src> until true: a first request without the cookie fails for good. */
export function useMediaSessionReady(): boolean {
  return useSyncExternalStore(subscribe, () => ready);
}
