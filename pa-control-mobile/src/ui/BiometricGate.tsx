import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useAuth } from '../auth/AuthContext'
import { colors, fonts, gradients, spacing } from '../theme'
import { BrandMark, Btn } from './Ui'

export function BiometricGate() {
  const { bioLocked, bioUnlock, lock } = useAuth()

  useEffect(() => {
    if (bioLocked) void bioUnlock()
  }, [bioLocked, bioUnlock])

  if (!bioLocked) return null
  return (
    <View style={styles.wrap}>
      <LinearGradient colors={['#121A33', colors.bg]} style={StyleSheet.absoluteFill} />
      <View style={styles.center}>
        <BrandMark large subtitle="Control Center" />
        <LinearGradient colors={gradients.brand} style={styles.lockIcon}>
          <Ionicons name="finger-print" size={40} color="#fff" />
        </LinearGradient>
        <Text style={styles.title}>Locked</Text>
        <Text style={styles.sub}>Authenticate to continue</Text>
        <Btn label="Unlock" icon="lock-open" onPress={() => void bioUnlock()} block />
        <Btn label="Sign out" variant="ghost" onPress={() => void lock()} block style={{ marginTop: spacing.sm }} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFill,
    zIndex: 999,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  lockIcon: {
    width: 88,
    height: 88,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontFamily: fonts.bold,
    color: colors.text,
    fontSize: 26,
    textAlign: 'center',
  },
  sub: {
    fontFamily: fonts.regular,
    color: colors.muted,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
})
