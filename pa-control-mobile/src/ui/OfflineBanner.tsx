import { Ionicons } from '@expo/vector-icons'
import { StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useOffline } from '../lib/offlineCache'
import { colors, fonts } from '../theme'

/** Thin banner shown while screens are rendering cached data. */
export function OfflineBanner() {
  const { offline, since } = useOffline()
  const insets = useSafeAreaInsets()
  if (!offline) return null
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 4 }]}>
      <Ionicons name="cloud-offline" size={14} color={colors.warn} />
      <Text style={styles.text}>
        Offline — showing data from {since ? new Date(since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'earlier'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingBottom: 4,
    backgroundColor: 'rgba(58,42,18,0.95)',
  },
  text: { fontFamily: fonts.medium, color: colors.warn, fontSize: 12 },
})
