import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { Redirect, router } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { defaultApiUrl } from '../src/api/paAdmin'
import { useAuth } from '../src/auth/AuthContext'
import { haptic } from '../src/lib/haptics'
import { colors, fonts, spacing } from '../src/theme'
import { Banner, BrandMark, Btn, Card, Input, Screen } from '../src/ui/Ui'

const FEATURES: Array<{ icon: React.ComponentProps<typeof Ionicons>['name']; label: string }> = [
  { icon: 'pulse', label: 'Atrium monitor & uptime' },
  { icon: 'notifications', label: 'Real-time alerts & push' },
  { icon: 'chatbubbles', label: 'WhatsApp bot control' },
  { icon: 'sparkles', label: 'Voice ops assistant' },
]

export default function UnlockScreen() {
  const { unlocked, unlock } = useAuth()
  const [baseUrl, setBaseUrl] = useState(defaultApiUrl())
  const [secret, setSecret] = useState('')
  const [show, setShow] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (unlocked) return <Redirect href="/(tabs)" />

  async function onSubmit() {
    setError('')
    setLoading(true)
    try {
      await unlock(secret, baseUrl)
      haptic.success()
      router.replace('/(tabs)')
    } catch (err) {
      haptic.error()
      setError(err instanceof Error ? err.message : 'Unlock failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Screen>
      <LinearGradient colors={['#161F3D', colors.bg]} style={StyleSheet.absoluteFill} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <BrandMark large subtitle="Control Center" />
          <Text style={styles.title}>Run your ops{'\n'}from your pocket.</Text>
          <View style={styles.features}>
            {FEATURES.map((f) => (
              <View key={f.label} style={styles.feature}>
                <Ionicons name={f.icon} size={15} color={colors.accent} />
                <Text style={styles.featureText}>{f.label}</Text>
              </View>
            ))}
          </View>

          <Card style={{ marginTop: spacing.lg }}>
            {error ? (
              <Banner tone="danger" icon="alert-circle" inset>
                {error}
              </Banner>
            ) : null}
            <View>
              <Input
                label="Admin secret or Atrium API token"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!show}
                value={secret}
                onChangeText={setSecret}
                placeholder="PA_ADMIN_SECRET or atr_…"
                onSubmitEditing={() => void onSubmit()}
                style={{ paddingRight: 46 }}
              />
              <Pressable onPress={() => setShow((s) => !s)} style={styles.eye} hitSlop={8}>
                <Ionicons name={show ? 'eye-off' : 'eye'} size={18} color={colors.muted} />
              </Pressable>
            </View>
            {advanced ? (
              <Input
                label="PA API base URL"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                value={baseUrl}
                onChangeText={setBaseUrl}
                placeholder="https://pa.example.com"
              />
            ) : (
              <Pressable onPress={() => setAdvanced(true)}>
                <Text style={styles.link}>Server: {baseUrl.replace(/^https?:\/\//, '')} · Change</Text>
              </Pressable>
            )}
            <Btn label="Unlock" icon="lock-open" block loading={loading} disabled={!secret.trim()} onPress={() => void onSubmit()} />
          </Card>
          <Text style={styles.foot}>Uses the same PA_ADMIN_SECRET as the PA server. Stored in the device keychain.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg },
  title: { fontFamily: fonts.bold, color: colors.text, fontSize: 32, lineHeight: 38, letterSpacing: -0.6 },
  features: { marginTop: spacing.md, gap: 8 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureText: { fontFamily: fonts.medium, color: colors.textDim, fontSize: 14 },
  eye: { position: 'absolute', right: 14, top: 38 },
  link: { fontFamily: fonts.medium, color: colors.accent, fontSize: 13, marginBottom: spacing.sm },
  foot: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: spacing.md },
})
