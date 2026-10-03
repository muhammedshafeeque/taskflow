import { useState } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg'
import { colors } from '../theme'

/** Area sparkline; values are auto-scaled to the box. */
export function Sparkline({
  values,
  height = 44,
  color = colors.accent,
}: {
  values: number[]
  height?: number
  color?: string
}) {
  const [w, setW] = useState(0)
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)
  const pts = values.filter((v) => Number.isFinite(v))
  let line = ''
  let area = ''
  if (w > 0 && pts.length > 1) {
    const max = Math.max(...pts)
    const min = Math.min(...pts)
    const span = max - min || 1
    const step = w / (pts.length - 1)
    const coords = pts.map((v, i) => [i * step, height - 3 - ((v - min) / span) * (height - 8)] as const)
    line = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
    area = `${line} L${w},${height} L0,${height} Z`
  }
  const id = `g${color.replace('#', '')}`
  return (
    <View style={{ height }} onLayout={onLayout}>
      {w > 0 && line ? (
        <Svg width={w} height={height}>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0.32} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d={area} fill={`url(#${id})`} />
          <Path d={line} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      ) : null}
    </View>
  )
}

/** Status strip (uptime heartbeat): one bar per sample, green ok / red fail. */
export function HeartbeatBar({
  samples,
  height = 22,
  slots = 30,
}: {
  samples: Array<{ ok: boolean }>
  height?: number
  slots?: number
}) {
  const [w, setW] = useState(0)
  const padded: Array<{ ok: boolean } | null> = [
    ...Array.from({ length: Math.max(0, slots - samples.length) }, () => null),
    ...samples.slice(-slots),
  ]
  const gap = 3
  const bw = w > 0 ? (w - gap * (slots - 1)) / slots : 0
  return (
    <View style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 ? (
        <Svg width={w} height={height}>
          {padded.map((s, i) => (
            <Rect
              key={i}
              x={i * (bw + gap)}
              y={0}
              width={bw}
              height={height}
              rx={2}
              fill={s === null ? colors.panel3 : s.ok ? colors.ok : colors.danger}
              opacity={s === null ? 1 : 0.9}
            />
          ))}
        </Svg>
      ) : null}
    </View>
  )
}

/** Simple vertical bar chart for counts. */
export function MiniBars({
  values,
  height = 48,
  color = colors.accent,
}: {
  values: number[]
  height?: number
  color?: string
}) {
  const [w, setW] = useState(0)
  const max = Math.max(1, ...values)
  const gap = 3
  const bw = w > 0 && values.length ? (w - gap * (values.length - 1)) / values.length : 0
  return (
    <View style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 ? (
        <Svg width={w} height={height}>
          {values.map((v, i) => {
            const h = Math.max(2, (v / max) * height)
            return (
              <Rect key={i} x={i * (bw + gap)} y={height - h} width={bw} height={h} rx={2} fill={color} opacity={v ? 0.9 : 0.25} />
            )
          })}
        </Svg>
      ) : null}
    </View>
  )
}

/** Bucket timestamps into N equal windows ending now. */
export function bucketize(timestamps: Array<string | undefined>, buckets = 24, spanMs = 24 * 3600_000): number[] {
  const out = new Array<number>(buckets).fill(0)
  const end = Date.now()
  const start = end - spanMs
  const size = spanMs / buckets
  for (const ts of timestamps) {
    if (!ts) continue
    const t = new Date(ts).getTime()
    if (!Number.isFinite(t) || t < start || t > end) continue
    out[Math.min(buckets - 1, Math.floor((t - start) / size))] += 1
  }
  return out
}
