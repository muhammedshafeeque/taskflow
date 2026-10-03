export const colors = {
  bg: '#090C13',
  bgElevated: '#0E121B',
  panel: '#121722',
  panel2: '#19202E',
  panel3: '#212A3C',
  border: '#222B3C',
  borderStrong: '#303B52',
  text: '#EDF1F8',
  textDim: '#B3BCCE',
  muted: '#7A859B',
  accent: '#6C8CFF',
  accent2: '#9A6BFF',
  accentSoft: 'rgba(108,140,255,0.14)',
  accentBorder: 'rgba(108,140,255,0.38)',
  ok: '#34D399',
  okSoft: 'rgba(52,211,153,0.13)',
  okBorder: 'rgba(52,211,153,0.35)',
  warn: '#FBBF24',
  warnSoft: 'rgba(251,191,36,0.13)',
  warnBorder: 'rgba(251,191,36,0.35)',
  danger: '#F87171',
  dangerSoft: 'rgba(248,113,113,0.13)',
  dangerBorder: 'rgba(248,113,113,0.38)',
  info: '#38BDF8',
  infoSoft: 'rgba(56,189,248,0.13)',
  infoBorder: 'rgba(56,189,248,0.35)',
  input: '#0C1019',
  overlay: 'rgba(3,5,10,0.72)',
}

export const gradients = {
  brand: ['#6C8CFF', '#9A6BFF'] as const,
  hero: ['#1A2240', '#121722'] as const,
  danger: ['#F87171', '#E0477A'] as const,
  ok: ['#34D399', '#14B8A6'] as const,
  warn: ['#FBBF24', '#F97316'] as const,
}

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'info'

export const toneColors: Record<Tone, { fg: string; bg: string; border: string }> = {
  neutral: { fg: colors.textDim, bg: colors.panel2, border: colors.border },
  ok: { fg: colors.ok, bg: colors.okSoft, border: colors.okBorder },
  warn: { fg: colors.warn, bg: colors.warnSoft, border: colors.warnBorder },
  danger: { fg: colors.danger, bg: colors.dangerSoft, border: colors.dangerBorder },
  accent: { fg: colors.accent, bg: colors.accentSoft, border: colors.accentBorder },
  info: { fg: colors.info, bg: colors.infoSoft, border: colors.infoBorder },
}

export const spacing = {
  xxs: 4,
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
}

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  pill: 999,
}

export const fonts = {
  regular: 'IBMPlexSans_400Regular',
  medium: 'IBMPlexSans_500Medium',
  semiBold: 'IBMPlexSans_600SemiBold',
  bold: 'IBMPlexSans_700Bold',
}

export const typography = {
  eyebrow: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
    color: colors.muted,
  },
  display: {
    fontFamily: fonts.bold,
    fontSize: 30,
    color: colors.text,
    lineHeight: 36,
    letterSpacing: -0.4,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 24,
    color: colors.text,
    lineHeight: 30,
    letterSpacing: -0.2,
  },
  section: {
    fontFamily: fonts.semiBold,
    fontSize: 16,
    color: colors.text,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  tiny: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.muted,
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: colors.textDim,
  },
}
