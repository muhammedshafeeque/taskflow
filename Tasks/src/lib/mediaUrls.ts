const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export function resolveMediaUrl(url: string): string {
  const base = API_BASE.replace(/\/api\/?$/, '') || 'http://localhost:5000';
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/api/')) return `${base}${url}`;
  if (url.startsWith('/uploads/')) return `${base}/api${url}`;
  if (url.startsWith('/')) return `${base}${url}`;
  return url;
}
