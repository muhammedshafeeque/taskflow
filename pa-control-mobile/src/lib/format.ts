export function timeAgo(input?: string | number | Date | null): string {
  if (!input) return '—'
  const t = new Date(input).getTime()
  if (!Number.isFinite(t)) return '—'
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 0) return 'just now'
  if (s < 45) return 'just now'
  if (s < 90) return '1m ago'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(t).toLocaleDateString()
}

export function clock(input?: string | number | Date | null): string {
  if (!input) return ''
  const d = new Date(input)
  if (!Number.isFinite(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function compact(n?: number | null): string {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v)) return '0'
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 10_000) return `${Math.round(v / 1000)}k`
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`
  return String(Math.round(v))
}

export function ms(n?: number | null): string {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v) || v <= 0) return '—'
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}s`
  return `${Math.round(v)}ms`
}

export function pct(n?: number | null): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const v = n * 100
  return `${v >= 99.95 ? '100' : v.toFixed(v >= 99 ? 2 : 1)}%`
}

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const AVATAR_HUES = ['#6C8CFF', '#9A6BFF', '#34D399', '#F59E0B', '#F472B6', '#38BDF8', '#F87171', '#A3E635']

export function hueFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_HUES[h % AVATAR_HUES.length]
}

export function humanize(s?: string | null): string {
  if (!s) return '—'
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function phoneFromChatId(chatId: string): string {
  const m = /^(\d{6,15})@/.exec(chatId)
  return m ? m[1] : ''
}
