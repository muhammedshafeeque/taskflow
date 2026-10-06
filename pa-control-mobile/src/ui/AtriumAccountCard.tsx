import { useEffect, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { atriumBaseUrl, connectAtrium, disconnectAtrium, loadAtriumAuth } from '../api/atrium'
import { defaultAtriumUrl } from '../api/paAdmin'
import { colors, fonts, radius, spacing } from '../theme'
import { useToast } from './Toast'
import { Btn, Card } from './Ui'

/** Connect "My work", Agenda and Pipeline to your own Atrium account with a personal API token. */
export function AtriumAccountCard() {
  const toast = useToast()
  const [connected, setConnected] = useState(false)
  const [url, setUrl] = useState(defaultAtriumUrl())
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void loadAtriumAuth().then((a) => {
      setConnected(a.connected)
      setUrl(a.baseUrl)
    })
  }, [])

  async function connect() {
    setBusy(true)
    try {
      const me = await connectAtrium(token, url)
      setConnected(true)
      setToken('')
      toast.success(`Connected as ${me.name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not connect')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card style={{ gap: spacing.sm }}>
      {connected ? (
        <>
          <Text style={styles.text}>Connected to {atriumBaseUrl().replace(/^https?:\/\//, '')}</Text>
          <Btn
            label="Disconnect"
            variant="secondary"
            compact
            onPress={() => void disconnectAtrium().then(() => setConnected(false))}
          />
        </>
      ) : (
        <>
          <Text style={styles.text}>
            In Atrium open Profile → API tokens, create a token, and paste it here. My work, Agenda and Pipeline then use your own permissions.
          </Text>
          <TextInput style={styles.input} value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} placeholder="https://atrium.yourcompany.com" placeholderTextColor={colors.muted} />
          <TextInput
            style={styles.input}
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            placeholder="atr_…"
            placeholderTextColor={colors.muted}
          />
          <Btn label="Connect" icon="link" compact loading={busy} disabled={!token.trim()} onPress={() => void connect()} />
        </>
      )}
    </Card>
  )
}

const styles = StyleSheet.create({
  text: { fontFamily: fonts.regular, color: colors.textDim, fontSize: 13, lineHeight: 18 },
  input: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
})
