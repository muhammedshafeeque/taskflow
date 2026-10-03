import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type ScrollViewProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { haptic } from '../lib/haptics'
import { hueFor, initials } from '../lib/format'
import {
  colors,
  fonts,
  gradients,
  radius,
  spacing,
  toneColors,
  typography,
  type Tone,
} from '../theme'

export type IconName = React.ComponentProps<typeof Ionicons>['name']

/* --------------------------------- layout --------------------------------- */

export function Screen({
  children,
  style,
  edges = 'top',
}: {
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
  edges?: 'top' | 'none'
}) {
  const insets = useSafeAreaInsets()
  return (
    <View
      style={[
        styles.screen,
        edges === 'top' && { paddingTop: insets.top + spacing.xs },
        style,
      ]}
    >
      {children}
    </View>
  )
}

/** Scrollable screen body with pull-to-refresh that tracks the promise. */
export function ScreenScroll({
  children,
  onRefresh,
  contentStyle,
  ...rest
}: {
  children: React.ReactNode
  onRefresh?: () => Promise<unknown> | void
  contentStyle?: StyleProp<ViewStyle>
} & Omit<ScrollViewProps, 'refreshControl' | 'contentContainerStyle'>) {
  const [refreshing, setRefreshing] = useState(false)
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.panel}
            onRefresh={async () => {
              setRefreshing(true)
              try {
                await onRefresh()
              } finally {
                setRefreshing(false)
              }
            }}
          />
        ) : undefined
      }
      contentContainerStyle={[{ paddingBottom: 110, paddingHorizontal: spacing.md }, contentStyle]}
      {...rest}
    >
      {children}
    </ScrollView>
  )
}

export function Header({
  title,
  subtitle,
  eyebrow,
  right,
  back,
  style,
}: {
  title: string
  subtitle?: string
  eyebrow?: string
  right?: React.ReactNode
  back?: boolean
  style?: StyleProp<ViewStyle>
}) {
  return (
    <View style={[styles.header, style]}>
      {back ? (
        <IconButton
          icon="chevron-back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/more'))}
          style={{ marginRight: spacing.xs }}
        />
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.headerSub} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.headerRight}>{right}</View> : null}
    </View>
  )
}

/** Back-compat alias used by older screens. */
export function PageHeader(props: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return <Header {...props} />
}

export function Section({
  title,
  action,
  onAction,
  children,
  style,
}: {
  title: string
  action?: string
  onAction?: () => void
  children?: React.ReactNode
  style?: StyleProp<ViewStyle>
}) {
  return (
    <View style={[{ marginTop: spacing.lg }, style]}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {action && onAction ? (
          <Pressable
            hitSlop={8}
            onPress={() => {
              haptic.tap()
              onAction()
            }}
          >
            <Text style={styles.sectionAction}>{action}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  )
}

export function Card({
  children,
  style,
  onPress,
  tone,
  padded = true,
}: {
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
  onPress?: () => void
  tone?: Tone
  padded?: boolean
}) {
  const toneStyle = tone ? { borderColor: toneColors[tone].border } : null
  const body = (
    <View style={[styles.card, !padded && { padding: 0 }, toneStyle, style]}>{children}</View>
  )
  if (!onPress) return body
  return (
    <Pressable
      onPress={() => {
        haptic.tap()
        onPress()
      }}
      style={({ pressed }) => [pressed && { opacity: 0.86, transform: [{ scale: 0.99 }] }]}
    >
      {body}
    </Pressable>
  )
}

export const Panel = Card

export function GradientCard({
  children,
  style,
  colorsPair = gradients.hero,
}: {
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
  colorsPair?: readonly [string, string]
}) {
  return (
    <LinearGradient
      colors={colorsPair}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.gradientCard, style]}
    >
      {children}
    </LinearGradient>
  )
}

export function Row({
  children,
  style,
}: {
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
}) {
  return <View style={[styles.row, style]}>{children}</View>
}

export function Wrap({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.wrap, style]}>{children}</View>
}

export function Divider() {
  return <View style={styles.divider} />
}

/* ---------------------------------- text ---------------------------------- */

export function Title({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.title, style]}>{children}</Text>
}

export function Muted({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.muted, style]}>{children}</Text>
}

export function Eyebrow({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.eyebrow, style]}>{children}</Text>
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.label}>{children}</Text>
}

export function BodyText({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.body, style]}>{children}</Text>
}

export function Mono({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.mono, style]}>{children}</Text>
}

export function ErrorText({ children }: { children?: string }) {
  if (!children) return null
  return (
    <Banner tone="danger" icon="alert-circle">
      {children}
    </Banner>
  )
}

export function SuccessText({ children }: { children?: string }) {
  if (!children) return null
  return (
    <Banner tone="ok" icon="checkmark-circle">
      {children}
    </Banner>
  )
}

export function Banner({
  children,
  tone = 'info',
  icon = 'information-circle',
  action,
  onAction,
  inset,
}: {
  children: React.ReactNode
  tone?: Tone
  icon?: IconName
  action?: string
  onAction?: () => void
  /** Drop the horizontal page margin when rendered inside a card. */
  inset?: boolean
}) {
  const t = toneColors[tone]
  return (
    <View style={[styles.banner, inset && { marginHorizontal: 0 }, { backgroundColor: t.bg, borderColor: t.border }]}>
      <Ionicons name={icon} size={18} color={t.fg} />
      <Text style={[styles.bannerText, { color: t.fg }]}>{children}</Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={[styles.bannerAction, { color: t.fg }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

/* --------------------------------- brand ---------------------------------- */

export function BrandMark({ subtitle, large }: { subtitle?: string; large?: boolean }) {
  const size = large ? 56 : 38
  return (
    <View style={[styles.brandRow, large && { marginBottom: spacing.lg }]}>
      <LinearGradient
        colors={gradients.brand}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ width: size, height: size, borderRadius: large ? 18 : 12, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={[styles.brandMarkText, large && { fontSize: 19 }]}>PA</Text>
      </LinearGradient>
      <View style={{ flex: 1 }}>
        <Text style={[styles.brandName, large && { fontSize: 24 }]}>Ivorix</Text>
        {subtitle ? <Text style={styles.brandSub}>{subtitle}</Text> : null}
      </View>
    </View>
  )
}

export function Avatar({ name, size = 40, icon }: { name: string; size?: number; icon?: IconName }) {
  const hue = hueFor(name || '?')
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2.6,
        backgroundColor: `${hue}22`,
        borderWidth: 1,
        borderColor: `${hue}55`,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {icon ? (
        <Ionicons name={icon} size={size * 0.48} color={hue} />
      ) : (
        <Text style={{ fontFamily: fonts.bold, color: hue, fontSize: size * 0.36 }}>{initials(name)}</Text>
      )}
    </View>
  )
}

export function IconTile({ icon, tone = 'accent', size = 40 }: { icon: IconName; tone?: Tone; size?: number }) {
  const t = toneColors[tone]
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 3,
        backgroundColor: t.bg,
        borderWidth: 1,
        borderColor: t.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={icon} size={size * 0.5} color={t.fg} />
    </View>
  )
}

/* -------------------------------- controls -------------------------------- */

export function Input(props: TextInputProps & { label?: string }) {
  const [focused, setFocused] = useState(false)
  const { label, style, ...rest } = props
  return (
    <View style={{ marginBottom: spacing.sm }}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.muted}
        selectionColor={colors.accent}
        {...rest}
        onFocus={(e) => {
          setFocused(true)
          rest.onFocus?.(e)
        }}
        onBlur={(e) => {
          setFocused(false)
          rest.onBlur?.(e)
        }}
        style={[
          styles.input,
          focused && { borderColor: colors.accent },
          rest.multiline && { minHeight: 88, textAlignVertical: 'top' },
          style,
        ]}
      />
    </View>
  )
}

export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search',
  onSubmit,
}: {
  value: string
  onChangeText: (s: string) => void
  placeholder?: string
  onSubmit?: () => void
}) {
  return (
    <View style={styles.search}>
      <Ionicons name="search" size={17} color={colors.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        selectionColor={colors.accent}
        returnKeyType="search"
        onSubmitEditing={onSubmit}
        style={styles.searchInput}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {value ? (
        <Pressable hitSlop={8} onPress={() => onChangeText('')}>
          <Ionicons name="close-circle" size={17} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  )
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'

export function Btn({
  label,
  onPress,
  variant = 'primary',
  disabled,
  compact,
  icon,
  loading,
  block,
  style,
}: {
  label: string
  onPress: () => void
  variant?: BtnVariant
  disabled?: boolean
  compact?: boolean
  icon?: IconName
  loading?: boolean
  block?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const fg =
    variant === 'primary' || variant === 'danger' || variant === 'success'
      ? '#fff'
      : variant === 'ghost'
        ? colors.textDim
        : colors.text
  const inner = (
    <View style={[styles.btnInner, compact && styles.btnInnerCompact]}>
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : icon ? (
        <Ionicons name={icon} size={compact ? 15 : 17} color={fg} />
      ) : null}
      <Text style={[styles.btnText, compact && { fontSize: 13 }, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
  const grad =
    variant === 'primary'
      ? gradients.brand
      : variant === 'danger'
        ? gradients.danger
        : variant === 'success'
          ? gradients.ok
          : null
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={() => {
        haptic.tap()
        onPress()
      }}
      style={({ pressed }) => [
        styles.btn,
        block && { alignSelf: 'stretch' },
        variant === 'secondary' && styles.btnSecondary,
        variant === 'ghost' && styles.btnGhost,
        (disabled || loading) && { opacity: 0.5 },
        pressed && { transform: [{ scale: 0.97 }], opacity: 0.9 },
        style,
      ]}
    >
      {grad ? (
        <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.btnGrad}>
          {inner}
        </LinearGradient>
      ) : (
        inner
      )}
    </Pressable>
  )
}

export function IconButton({
  icon,
  onPress,
  tone,
  badge,
  style,
  size = 40,
  disabled,
}: {
  icon: IconName
  onPress: () => void
  tone?: Tone
  badge?: number
  style?: StyleProp<ViewStyle>
  size?: number
  disabled?: boolean
}) {
  const t = tone ? toneColors[tone] : null
  return (
    <Pressable
      hitSlop={6}
      disabled={disabled}
      onPress={() => {
        haptic.tap()
        onPress()
      }}
      style={({ pressed }) => [
        styles.iconBtn,
        { width: size, height: size, borderRadius: size / 2.8 },
        t && { backgroundColor: t.bg, borderColor: t.border },
        (pressed || disabled) && { opacity: 0.6 },
        style,
      ]}
    >
      <Ionicons name={icon} size={size * 0.48} color={t ? t.fg : colors.text} />
      {badge ? (
        <View style={styles.iconBadge}>
          <Text style={styles.iconBadgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

export function Chip({
  label,
  active,
  onPress,
  disabled,
  icon,
  tone,
  count,
}: {
  label: string
  active?: boolean
  onPress?: () => void
  disabled?: boolean
  icon?: IconName
  tone?: Tone
  count?: number
}) {
  const t = toneColors[tone || 'accent']
  return (
    <Pressable
      disabled={disabled || !onPress}
      onPress={() => {
        haptic.tap()
        onPress?.()
      }}
      style={({ pressed }) => [
        styles.chip,
        active && { borderColor: t.border, backgroundColor: t.bg },
        (disabled || pressed) && onPress ? { opacity: 0.6 } : null,
      ]}
    >
      {icon ? <Ionicons name={icon} size={14} color={active ? t.fg : colors.textDim} /> : null}
      <Text style={[styles.chipText, active && { color: t.fg }]}>{label}</Text>
      {count !== undefined ? (
        <View style={[styles.chipCount, active && { backgroundColor: t.border }]}>
          <Text style={[styles.chipCountText, active && { color: '#fff' }]}>{count}</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

export function ChipScroll({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingRight: spacing.md }}
      style={{ marginBottom: spacing.sm, flexGrow: 0 }}
    >
      {children}
    </ScrollView>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: Array<{ id: T; label: string; count?: number }>
  value: T
  onChange: (id: T) => void
  style?: StyleProp<ViewStyle>
}) {
  return (
    <View style={[styles.segmented, style]}>
      {options.map((opt) => {
        const active = value === opt.id
        return (
          <Pressable
            key={opt.id}
            onPress={() => {
              haptic.tap()
              onChange(opt.id)
            }}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1}>
              {opt.label}
              {opt.count ? ` · ${opt.count}` : ''}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function ToggleRow({
  title,
  subtitle,
  value,
  onChange,
  disabled,
  icon,
  tone,
}: {
  title: string
  subtitle?: string
  value: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  icon?: IconName
  tone?: Tone
}) {
  return (
    <View style={styles.toggleRow}>
      {icon ? <IconTile icon={icon} tone={tone || 'accent'} size={36} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={(v) => {
          haptic.tap()
          onChange(v)
        }}
        trackColor={{ false: colors.panel3, true: colors.accent }}
        thumbColor="#fff"
        ios_backgroundColor={colors.panel3}
      />
    </View>
  )
}

/* -------------------------------- display --------------------------------- */

export function Badge({ label, tone = 'neutral', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const t = toneColors[tone]
  return (
    <View style={[styles.badge, { backgroundColor: t.bg, borderColor: t.border }]}>
      {icon ? <Ionicons name={icon} size={11} color={t.fg} /> : null}
      <Text style={[styles.badgeText, { color: t.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}

export function StatusDot({ tone = 'ok', pulse, size = 8 }: { tone?: Tone; pulse?: boolean; size?: number }) {
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!pulse) return
    const loop = Animated.loop(
      Animated.timing(v, { toValue: 1, duration: 1600, easing: Easing.out(Easing.ease), useNativeDriver: true })
    )
    loop.start()
    return () => loop.stop()
  }, [pulse, v])
  const c = toneColors[tone].fg
  return (
    <View style={{ width: size * 2.2, height: size * 2.2, alignItems: 'center', justifyContent: 'center' }}>
      {pulse ? (
        <Animated.View
          style={{
            position: 'absolute',
            width: size * 2.2,
            height: size * 2.2,
            borderRadius: size * 1.1,
            backgroundColor: c,
            opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
            transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
          }}
        />
      ) : null}
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c }} />
    </View>
  )
}

export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = 'accent',
  onPress,
  style,
}: {
  label: string
  value: string | number
  hint?: string
  icon?: IconName
  tone?: Tone
  onPress?: () => void
  style?: StyleProp<ViewStyle>
}) {
  const t = toneColors[tone]
  return (
    <Card onPress={onPress} style={[styles.stat, style]}>
      <View style={styles.statTop}>
        <Text style={styles.statLabel} numberOfLines={1}>
          {label}
        </Text>
        {icon ? <Ionicons name={icon} size={16} color={t.fg} /> : null}
      </View>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {hint ? (
        <Text style={[styles.statHint, { color: tone === 'neutral' ? colors.muted : t.fg }]} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </Card>
  )
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <View style={styles.statGrid}>{children}</View>
}

export function ListRow({
  title,
  subtitle,
  meta,
  onPress,
  onLongPress,
  trailing,
  leading,
  style,
}: {
  title: string
  subtitle?: string
  meta?: string
  onPress?: () => void
  onLongPress?: () => void
  trailing?: React.ReactNode
  leading?: React.ReactNode
  style?: StyleProp<ViewStyle>
}) {
  const content = (
    <View style={[styles.listRow, style]}>
      {leading}
      <View style={styles.listRowMain}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSub} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
        {meta ? <Text style={styles.rowMeta}>{meta}</Text> : null}
      </View>
      {trailing}
      {onPress && !trailing ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}
    </View>
  )
  if (!onPress && !onLongPress) return content
  return (
    <Pressable
      onPress={
        onPress
          ? () => {
              haptic.tap()
              onPress()
            }
          : undefined
      }
      onLongPress={
        onLongPress
          ? () => {
              haptic.impact()
              onLongPress()
            }
          : undefined
      }
      style={({ pressed }) => pressed && { opacity: 0.8 }}
    >
      {content}
    </Pressable>
  )
}

export function NavRow({
  icon,
  tone = 'accent',
  title,
  subtitle,
  onPress,
  badge,
}: {
  icon: IconName
  tone?: Tone
  title: string
  subtitle?: string
  onPress: () => void
  badge?: string | number
}) {
  return (
    <ListRow
      leading={<IconTile icon={icon} tone={tone} />}
      title={title}
      subtitle={subtitle}
      onPress={onPress}
      trailing={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {badge !== undefined && badge !== 0 && badge !== '' ? <Badge label={String(badge)} tone={tone} /> : null}
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </View>
      }
    />
  )
}

export function EmptyState({
  message,
  title,
  icon = 'file-tray-outline',
  action,
  onAction,
}: {
  message: string
  title?: string
  icon?: IconName
  action?: string
  onAction?: () => void
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={26} color={colors.muted} />
      </View>
      {title ? <Text style={styles.emptyTitle}>{title}</Text> : null}
      <Text style={styles.emptyText}>{message}</Text>
      {action && onAction ? (
        <Btn label={action} variant="secondary" compact onPress={onAction} style={{ marginTop: spacing.sm }} />
      ) : null}
    </View>
  )
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.accent} />
      {label ? <Text style={[styles.muted, { marginTop: spacing.sm }]}>{label}</Text> : null}
    </View>
  )
}

export function Skeleton({ height = 64, style }: { height?: number; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0.4)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [v])
  return <Animated.View style={[styles.skeleton, { height, opacity: v }, style]} />
}

export function SkeletonList({ count = 5, height = 68 }: { count?: number; height?: number }) {
  return (
    <View style={{ gap: spacing.sm, paddingHorizontal: spacing.md }}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} height={height} />
      ))}
    </View>
  )
}

export function KeyValue({ k, v, mono }: { k: string; v?: string | number | null; mono?: boolean }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvKey}>{k}</Text>
      <Text style={[styles.kvVal, mono && typography.mono]} numberOfLines={2} selectable>
        {v === undefined || v === null || v === '' ? '—' : String(v)}
      </Text>
    </View>
  )
}

export function ProgressBar({ value, tone = 'accent' }: { value: number; tone?: Tone }) {
  const pctW = Math.max(0, Math.min(1, value)) * 100
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${pctW}%`, backgroundColor: toneColors[tone].fg }]} />
    </View>
  )
}

/* ---------------------------------- sheet --------------------------------- */

export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  visible: boolean
  onClose: () => void
  title?: string
  subtitle?: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <View style={styles.sheetGrip} />
          {title ? (
            <View style={styles.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle} numberOfLines={2}>
                  {title}
                </Text>
                {subtitle ? <Text style={styles.headerSub}>{subtitle}</Text> : null}
              </View>
              <IconButton icon="close" onPress={onClose} size={34} />
            </View>
          ) : null}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: spacing.md }}
          >
            {children}
          </ScrollView>
          {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

/* --------------------------------- styles --------------------------------- */

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
  },
  headerTitle: {
    ...typography.title,
  },
  headerSub: {
    fontFamily: fonts.regular,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    ...typography.eyebrow,
    fontSize: 12,
  },
  sectionAction: {
    fontFamily: fonts.semiBold,
    color: colors.accent,
    fontSize: 13,
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  gradientCard: {
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    gap: spacing.sm,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
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
  },
  eyebrow: {
    ...typography.eyebrow,
    marginBottom: 4,
  },
  label: {
    fontFamily: fonts.semiBold,
    color: colors.textDim,
    fontSize: 13,
    marginTop: spacing.xs,
  },
  body: typography.body,
  mono: typography.mono,
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  bannerText: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 18,
  },
  bannerAction: {
    fontFamily: fonts.bold,
    fontSize: 13,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  brandMarkText: {
    fontFamily: fonts.bold,
    color: '#fff',
    fontSize: 14,
    letterSpacing: 0.5,
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
  fieldLabel: {
    fontFamily: fonts.semiBold,
    color: colors.textDim,
    fontSize: 12,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.input,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 15,
    paddingVertical: 11,
  },
  btn: {
    borderRadius: radius.md,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  btnGrad: {
    borderRadius: radius.md,
  },
  btnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  btnInnerCompact: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  btnSecondary: {
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  btnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnText: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
  },
  iconBtn: {
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  iconBadgeText: {
    color: '#fff',
    fontFamily: fonts.bold,
    fontSize: 10,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: colors.panel,
  },
  chipText: {
    fontFamily: fonts.medium,
    color: colors.textDim,
    fontSize: 13,
  },
  chipCount: {
    backgroundColor: colors.panel3,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    minWidth: 20,
    alignItems: 'center',
  },
  chipCountText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.textDim,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 4,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: radius.sm,
  },
  segmentActive: {
    backgroundColor: colors.panel3,
  },
  segmentText: {
    fontFamily: fonts.semiBold,
    color: colors.muted,
    fontSize: 13,
  },
  segmentTextActive: {
    color: colors.text,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 4,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderWidth: 1,
  },
  badgeText: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    letterSpacing: 0.2,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  stat: {
    flexGrow: 1,
    flexBasis: '46%',
    gap: 4,
    paddingVertical: 14,
  },
  statTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statLabel: {
    fontFamily: fonts.medium,
    color: colors.muted,
    fontSize: 12,
    flex: 1,
  },
  statValue: {
    fontFamily: fonts.bold,
    color: colors.text,
    fontSize: 26,
    letterSpacing: -0.5,
  },
  statHint: {
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  listRowMain: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  rowTitle: {
    fontFamily: fonts.semiBold,
    color: colors.text,
    fontSize: 15,
  },
  rowSub: {
    fontFamily: fonts.regular,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  rowMeta: {
    fontFamily: fonts.medium,
    color: colors.muted,
    fontSize: 11,
    marginTop: 1,
  },
  empty: {
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: 6,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  emptyTitle: {
    fontFamily: fonts.semiBold,
    color: colors.text,
    fontSize: 16,
  },
  emptyText: {
    fontFamily: fonts.regular,
    color: colors.muted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  skeleton: {
    backgroundColor: colors.panel2,
    borderRadius: radius.lg,
  },
  kv: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 6,
  },
  kvKey: {
    fontFamily: fonts.medium,
    color: colors.muted,
    fontSize: 13,
  },
  kvVal: {
    fontFamily: fonts.medium,
    color: colors.text,
    fontSize: 13,
    flexShrink: 1,
    textAlign: 'right',
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.panel3,
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '90%',
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  sheetGrip: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.sm,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sheetTitle: {
    fontFamily: fonts.bold,
    color: colors.text,
    fontSize: 20,
  },
  sheetFooter: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
})
