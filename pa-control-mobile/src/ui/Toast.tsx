import { Ionicons } from '@expo/vector-icons'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { haptic } from '../lib/haptics'
import { colors, fonts, radius, spacing, toneColors, type Tone } from '../theme'

type ToastInput = { message: string; title?: string; tone?: Tone; onPress?: () => void }
type ToastApi = {
  show: (t: ToastInput) => void
  success: (message: string) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const ICONS: Record<Tone, React.ComponentProps<typeof Ionicons>['name']> = {
  ok: 'checkmark-circle',
  danger: 'alert-circle',
  warn: 'warning',
  info: 'information-circle',
  accent: 'notifications',
  neutral: 'ellipse',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets()
  const [toast, setToast] = useState<ToastInput | null>(null)
  const anim = useRef(new Animated.Value(0)).current
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hide = useCallback(() => {
    Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setToast(null))
  }, [anim])

  const show = useCallback(
    (t: ToastInput) => {
      if (timer.current) clearTimeout(timer.current)
      setToast(t)
      if (t.tone === 'danger') haptic.error()
      else if (t.tone === 'ok') haptic.success()
      else if (t.tone === 'warn') haptic.warning()
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 8 }).start()
      timer.current = setTimeout(hide, t.tone === 'danger' ? 4500 : 2800)
    },
    [anim, hide]
  )

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message) => show({ message, tone: 'ok' }),
      error: (message) => show({ message, tone: 'danger' }),
    }),
    [show]
  )

  const tone = toast?.tone || 'info'
  const t = toneColors[tone]

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.wrap,
            {
              top: insets.top + 8,
              opacity: anim,
              transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-30, 0] }) }],
            },
          ]}
        >
          <Pressable
            onPress={() => {
              toast.onPress?.()
              hide()
            }}
            style={[styles.toast, { borderColor: t.border }]}
          >
            <View style={[styles.iconWrap, { backgroundColor: t.bg }]}>
              <Ionicons name={ICONS[tone]} size={18} color={t.fg} />
            </View>
            <View style={{ flex: 1 }}>
              {toast.title ? <Text style={styles.title}>{toast.title}</Text> : null}
              <Text style={styles.msg} numberOfLines={3}>
                {toast.message}
              </Text>
            </View>
          </Pressable>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast outside ToastProvider')
  return ctx
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: 1000,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: fonts.semiBold,
    color: colors.text,
    fontSize: 14,
  },
  msg: {
    fontFamily: fonts.regular,
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
  },
})
