export const colors = {
  bg: '#0f1216',
  panel: '#171b21',
  panel2: '#1e242c',
  border: '#2a313b',
  text: '#e8ecef',
  muted: '#8b95a1',
  accent: '#3d8bfd',
  ok: '#3ecf8e',
  warn: '#e6a23c',
  danger: '#e05c5c',
  input: '#0f1216',
  accentSoft: '#152033',
}

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
}

export const radius = {
  sm: 8,
  md: 10,
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
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
    color: colors.muted,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 22,
    color: colors.text,
    lineHeight: 28,
  },
  section: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
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
}
