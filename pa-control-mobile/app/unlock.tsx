import { useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native'
import { Redirect, router } from 'expo-router'
import { defaultApiUrl } from '../src/api/paAdmin'
import { useAuth } from '../src/auth/AuthContext'
import { colors, spacing } from '../src/theme'
import {
  BrandMark,
  Btn,
  ErrorText,
  Eyebrow,
  Input,
  Muted,
  Screen,
  Title,
} from '../src/ui/Ui'

export default function UnlockScreen() {
  const { unlocked, unlock } = useAuth()
  const [baseUrl, setBaseUrl] = useState(defaultApiUrl())
  const [secret, setSecret] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (unlocked) return <Redirect href="/(tabs)" />

  async function onSubmit() {
    setError('')
    setLoading(true)
    try {
      await unlock(secret, baseUrl)
      router.replace('/(tabs)')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unlock failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Screen style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          <View style={styles.hero}>
            <BrandMark large subtitle="Control Center" />
            <Eyebrow>Admin access</Eyebrow>
            <Title style={{ marginBottom: spacing.sm }}>Unlock session</Title>
            <Muted style={{ marginBottom: spacing.lg }}>
              Use the same PA_ADMIN_SECRET as the server.
            </Muted>
          </View>

          <ErrorText>{error}</ErrorText>

          <Muted style={styles.fieldLabel}>API base URL</Muted>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            value={baseUrl}
            onChangeText={setBaseUrl}
            placeholder="https://pa.repod.online"
          />
          <Muted style={styles.fieldLabel}>Admin secret</Muted>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            value={secret}
            onChangeText={setSecret}
            placeholder="PA_ADMIN_SECRET"
            onSubmitEditing={() => void onSubmit()}
          />
          <Btn
            label={loading ? 'Checking…' : 'Unlock'}
            disabled={loading || !secret.trim()}
            onPress={() => void onSubmit()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  screen: {
    paddingTop: spacing.lg,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: spacing.lg,
  },
  hero: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    marginBottom: 4,
    color: colors.muted,
  },
})
