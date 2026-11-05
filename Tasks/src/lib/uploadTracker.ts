import { useSyncExternalStore } from 'react';

/** Smaller files finish too fast for a bar to be anything but a flicker. */
export const PROGRESS_MIN_BYTES = 1024 * 1024;

const ERROR_DISMISS_MS = 8000;

export interface TrackedUpload {
  id: number;
  name: string;
  size: number;
  /** 0–1 share of the bytes sent. */
  fraction: number;
  /** `processing`: all bytes sent, waiting for the server to check and store them. */
  status: 'uploading' | 'processing' | 'error';
  error?: string;
  /** Set when one component shows this upload inline; unset ones appear in the global tray. */
  scope?: string;
}

export interface UploadHandle {
  signal: AbortSignal;
  progress: (fraction: number) => void;
  processing: () => void;
  done: () => void;
  fail: (message: string) => void;
}

let uploads: TrackedUpload[] = [];
let nextId = 1;
const controllers = new Map<number, AbortController>();
const listeners = new Set<() => void>();

function setUploads(next: TrackedUpload[]) {
  uploads = next;
  listeners.forEach((l) => l());
}

function patch(id: number, changes: Partial<TrackedUpload>) {
  setUploads(uploads.map((u) => (u.id === id ? { ...u, ...changes } : u)));
}

export function dismissUpload(id: number) {
  controllers.delete(id);
  setUploads(uploads.filter((u) => u.id !== id));
}

export function cancelUpload(id: number) {
  controllers.get(id)?.abort();
}

export function cancelScope(scope: string) {
  uploads.filter((u) => u.scope === scope).forEach((u) => cancelUpload(u.id));
}

export function startUpload(file: File, scope?: string): UploadHandle {
  const id = nextId++;
  const controller = new AbortController();
  controllers.set(id, controller);
  setUploads([...uploads, { id, name: file.name, size: file.size, fraction: 0, status: 'uploading', scope }]);
  return {
    signal: controller.signal,
    progress: (fraction) => patch(id, { fraction, status: 'uploading' }),
    processing: () => patch(id, { fraction: 1, status: 'processing' }),
    done: () => dismissUpload(id),
    fail: (message) => {
      // A scoped host shows the error itself; the tray is the only place for the rest.
      if (scope) {
        dismissUpload(id);
        return;
      }
      controllers.delete(id);
      patch(id, { status: 'error', error: message });
      setTimeout(() => dismissUpload(id), ERROR_DISMISS_MS);
    },
  };
}

/** Failures always show, even for small files: several callers ignore a failed result. */
export function isVisibleUpload(u: TrackedUpload) {
  return u.status === 'error' || u.size >= PROGRESS_MIN_BYTES;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Every upload in the scope (or every tray upload when omitted), including small ones. */
export function useUploads(scope?: string) {
  return useSyncExternalStore(subscribe, () => uploads).filter((u) => u.scope === scope);
}
