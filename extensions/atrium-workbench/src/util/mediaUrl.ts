/** Resolve `/api/uploads/...` (and similar) to absolute URLs with JWT for auth-gated files. */
export function resolveMediaUrl(apiBaseUrl: string, accessToken: string | undefined, url: string): string {
  if (!url) return url;
  const base = (apiBaseUrl || '').replace(/\/$/, '');
  let absolute = url;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    absolute = url;
  } else if (url.startsWith('/api/')) {
    absolute = `${base}${url}`;
  } else if (url.startsWith('/uploads/')) {
    absolute = `${base}/api${url}`;
  } else if (url.startsWith('/')) {
    absolute = `${base}${url}`;
  } else {
    return url;
  }

  if (!absolute.includes('/api/uploads/')) return absolute;
  if (!accessToken) return absolute;
  try {
    const u = new URL(absolute);
    if (!u.searchParams.has('token')) u.searchParams.set('token', accessToken);
    return u.toString();
  } catch {
    return absolute;
  }
}

export function isImageMime(mime?: string, nameOrUrl?: string): boolean {
  if (mime?.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(nameOrUrl || '');
}

export function isVideoMime(mime?: string, nameOrUrl?: string): boolean {
  if (mime?.startsWith('video/')) return true;
  return /\.(mp4|webm|ogg|mov)(\?|$)/i.test(nameOrUrl || '');
}

export function isPdfMime(mime?: string, nameOrUrl?: string): boolean {
  if (mime === 'application/pdf') return true;
  return /\.pdf(\?|$)/i.test(nameOrUrl || '');
}
