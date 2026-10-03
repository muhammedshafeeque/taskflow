import * as Haptics from 'expo-haptics'
import { Platform } from 'react-native'
import { getPrefs } from './prefs'

function enabled() {
  return Platform.OS !== 'web' && getPrefs().haptics
}

export const haptic = {
  tap() {
    if (enabled()) void Haptics.selectionAsync().catch(() => {})
  },
  impact() {
    if (enabled()) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
  },
  success() {
    if (enabled()) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
  },
  warning() {
    if (enabled()) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
  },
  error() {
    if (enabled()) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
  },
}
