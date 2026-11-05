import { cancelUpload, dismissUpload, isVisibleUpload, useUploads, type TrackedUpload } from '../../lib/uploadTracker';

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusText(u: TrackedUpload): string {
  if (u.status === 'error') return u.error ?? 'Upload failed';
  if (u.status === 'processing') return 'Processing…';
  return `${formatSize(u.size * u.fraction)} of ${formatSize(u.size)} · ${Math.round(u.fraction * 100)}%`;
}

function UploadProgressRow({ upload }: { upload: TrackedUpload }) {
  const failed = upload.status === 'error';
  const percent = Math.round(upload.fraction * 100);
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-medium text-[color:var(--text-primary)]" title={upload.name}>
          {upload.name}
        </span>
        {upload.status !== 'processing' && (
          <button
            type="button"
            onClick={() => (failed ? dismissUpload(upload.id) : cancelUpload(upload.id))}
            className="shrink-0 text-[11px] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
          >
            {failed ? 'Dismiss' : 'Cancel'}
          </button>
        )}
      </div>
      {!failed && (
        <div
          role="progressbar"
          aria-label={`Uploading ${upload.name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="mt-1 h-1.5 overflow-hidden rounded-full bg-[color:var(--bg-page)]"
        >
          <div
            className={`h-full rounded-full bg-[color:var(--accent)] transition-[width] duration-200 ${upload.status === 'processing' ? 'animate-pulse' : ''}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      <p className={`mt-1 text-[11px] ${failed ? 'text-red-600 dark:text-red-400' : 'text-[color:var(--text-muted)]'}`}>
        {statusText(upload)}
      </p>
    </div>
  );
}

/** Bars for one component's own uploads, e.g. inside the comment box. */
export function UploadProgressList({ uploads }: { uploads: TrackedUpload[] }) {
  const visible = uploads.filter(isVisibleUpload);
  if (visible.length === 0) return null;
  return (
    <div className="space-y-2 border-t border-[color:var(--border-subtle)] px-4 py-2">
      {visible.map((u) => (
        <UploadProgressRow key={u.id} upload={u} />
      ))}
    </div>
  );
}

/** Mounted once at the app root: outlives page changes, so uploads stay visible while you navigate. */
export function UploadProgressTray() {
  const visible = useUploads().filter(isVisibleUpload);
  if (visible.length === 0) return null;
  return (
    <div
      aria-label="File uploads"
      role="region"
      className="fixed bottom-4 right-4 z-[70] max-h-[50vh] w-80 max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-3 shadow-xl"
    >
      {visible.map((u) => (
        <UploadProgressRow key={u.id} upload={u} />
      ))}
    </div>
  );
}
