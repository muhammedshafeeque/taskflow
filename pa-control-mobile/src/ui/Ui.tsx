import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { colors, fonts, radius, spacing, typography } from '../theme'

export function Screen({
  children,
  style,
}: {
  children: React.ReactNode
  style?: ViewStyle
}) {
  return <View style={[styles.screen, style]}>{children}</View>
}

export function Title({
  children,
  style,
}: {
  children: React.ReactNode
  style?: StyleProp<TextStyle>
}) {
  return <Text style={[styles.title, style]}>{children}</Text>
}

export function Muted({
  children,
  style,
}: {
  children: React.ReactNode
  style?: StyleProp<TextStyle>
}) {
  return <Text style={[styles.muted, style]}>{children}</Text>
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <Text style={styles.eyebrow}>{children}</Text>
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.section}>{children}</Text>
}

export function BodyText({
  children,
  style,
}: {
  children: React.ReactNode
  style?: StyleProp<TextStyle>
}) {
  return <Text style={[styles.body, style]}>{children}</Text>
}

export function ErrorText({ children }: { children?: string }) {
  if (!children) return null
  return <Text style={styles.error}>{children}</Text>
}

export function SuccessText({ children }: { children?: string }) {
  if (!children) return null
  return <Text style={styles.success}>{children}</Text>
}

export function BrandMark({
  subtitle,
  large,
}: {
  subtitle?: string
  large?: boolean
}) {
  return (
    <View style={[styles.brandRow, large && { marginBottom: spacing.lg }]}>
      <View style={[styles.brandMark, large && styles.brandMarkLarge]}>
        <Text style={[styles.brandMarkText, large && { fontSize: 16 }]}>PA</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.brandName, large && { fontSize: 22 }]}>Ivorix</Text>
        {subtitle ? <Text style={styles.brandSub}>{subtitle}</Text> : null}
      </View>
    </View>
  )
}

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string
  subtitle?: string
  right?: React.ReactNode
}) {
  return (
    <View style={styles.pageHeader}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  )
}

export function Panel({
  children,
  style,
}: {
  children: React.ReactNode
  style?: ViewStyle
}) {
  return <View style={[styles.panel, style]}>{children}</View>
}

export function Row({
  children,
  style,
}: {
  children: React.ReactNode
  style?: ViewStyle
}) {
  return <View style={[styles.row, style]}>{children}</View>
}

export function Input(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.muted}
      {...props}
      style={[styles.input, props.style]}
    />
  )
}

export function Btn({
  label,
  onPress,
  variant = 'primary',
  disabled,
  compact,
}: {
  label: string
  onPress: () => void
  variant?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
  compact?: boolean
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        compact && styles.btnCompact,
        variant === 'ghost' && styles.btnGhost,
        variant === 'danger' && styles.btnDanger,
        (disabled || pressed) && { opacity: 0.55 },
      ]}
    >
      <Text
        style={[
          styles.btnText,
          compact && { fontSize: 12 },
          variant === 'ghost' && { color: colors.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

export function Chip({
  label,
  active,
  onPress,
  disabled,
}: {
  label: string
  active?: boolean
  onPress?: () => void
  disabled?: boolean
}) {
  return (
    <Pressable
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        (disabled || pressed) && onPress ? { opacity: 0.6 } : null,
      ]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: T; label: string }>
  value: T
  onChange: (id: T) => void
}) {
  return (
    <View style={styles.segmented}>
      {options.map((opt) => (
        <Pressable
          key={opt.id}
          onPress={() => onChange(opt.id)}
          style={[
            styles.segment,
            value === opt.id && styles.segmentActive,
          ]}
        >
          <Text
            style={[
              styles.segmentText,
              value === opt.id && styles.segmentTextActive,
            ]}
          >
            {opt.label}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}

export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string
  tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'accent'
}) {
  const toneStyle =
    tone === 'ok'
      ? styles.badgeOk
      : tone === 'warn'
        ? styles.badgeWarn
        : tone === 'danger'
          ? styles.badgeDanger
          : tone === 'accent'
            ? styles.badgeAccent
            : styles.badgeNeutral
  const textStyle =
    tone === 'ok'
      ? { color: colors.ok }
      : tone === 'warn'
        ? { color: colors.warn }
        : tone === 'danger'
          ? { color: colors.danger }
          : tone === 'accent'
            ? { color: colors.accent }
            : { color: colors.muted }
  return (
    <View style={[styles.badge, toneStyle]}>
      <Text style={[styles.badgeText, textStyle]}>{label}</Text>
    </View>
  )
}

export function ListRow({
  title,
  subtitle,
  meta,
  onPress,
  trailing,
}: {
  title: string
  subtitle?: string
  meta?: string
  onPress?: () => void
  trailing?: React.ReactNode
}) {
  const content = (
    <Panel style={styles.listRowPanel}>
      <View style={styles.listRowMain}>
        <Text style={styles.listRowTitle} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.listRowSub} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
        {meta ? <Text style={styles.listRowMeta}>{meta}</Text> : null}
      </View>
      {trailing}
    </Panel>
  )
  if (!onPress) return content
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.85 }}>
      {content}
    </Pressable>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  )
}

export function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.accent} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.md,
  },
  title: {
    ...typography.title,
    marginBottom: 2,
  },
  muted: {
    fontFamily: fonts.regular,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  eyebrow: {
    ...typography.eyebrow,
    marginBottom: spacing.xs,
  },
  section: {
    ...typography.section,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  body: typography.body,
  error: {
    fontFamily: fonts.medium,
    color: colors.danger,
    fontSize: 13,
    marginBottom: spacing.sm,
  },
  success: {
    fontFamily: fonts.medium,
    color: colors.ok,
    fontSize: 13,
    marginBottom: spacing.sm,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  brandMark: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMarkLarge: {
    width: 48,
    height: 48,
  },
  brandMarkText: {
    fontFamily: fonts.bold,
    color: colors.accent,
    fontSize: 13,
  },
  brandName: {
    fontFamily: fonts.bold,
    color: colors.text,
    fontSize: 17,
  },
  brandSub: {
    fontFamily: fonts.regular,
    color: colors.muted,
    fontSize: 12,
    marginTop: 1,
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  panel: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  input: {
    backgroundColor: colors.input,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: spacing.sm,
  },
  btn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
  },
  btnCompact: {
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  btnGhost: {
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnDanger: {
    backgroundColor: colors.danger,
  },
  btnText: {
    color: '#fff',
    fontFamily: fonts.semiBold,
    fontSize: 14,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.panel,
  },
  chipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  chipText: {
    fontFamily: fonts.medium,
    color: colors.text,
    fontSize: 13,
  },
  chipTextActive: {
    color: colors.accent,
  },
  segmented: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: spacing.md,
  },
  segment: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.panel2,
  },
  segmentActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  segmentText: {
    fontFamily: fonts.semiBold,
    color: colors.text,
    fontSize: 13,
  },
  segmentTextActive: {
    color: '#fff',
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  badgeNeutral: {
    backgroundColor: colors.panel2,
    borderColor: colors.border,
  },
  badgeOk: {
    backgroundColor: 'rgba(62,207,142,0.12)',
    borderColor: 'rgba(62,207,142,0.35)',
  },
  badgeWarn: {
    backgroundColor: 'rgba(230,162,60,0.12)',
    borderColor: 'rgba(230,162,60,0.35)',
  },
  badgeDanger: {
    backgroundColor: 'rgba(224,92,92,0.12)',
    borderColor: 'rgba(224,92,92,0.35)',
  },
  badgeAccent: {
    backgroundColor: colors.accentSoft,
    borderColor: 'rgba(61,139,253,0.4)',
  },
  badgeText: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  listRowPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  listRowMain: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  listRowTitle: {
    fontFamily: fonts.semiBold,
    color: colors.text,
    fontSize: 15,
  },
  listRowSub: {
    fontFamily: fonts.regular,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  listRowMeta: {
    fontFamily: fonts.regular,
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  empty: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: fonts.regular,
    color: colors.muted,
    fontSize: 14,
    textAlign: 'center',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
})
