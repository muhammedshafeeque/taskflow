import Constants from 'expo-constants'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { pushApi } from '../../src/api/paAdmin'
import { biometricsAvailable, useAuth } from '../../src/auth/AuthContext'
import {
  ensurePermission,
  pollAndNotify,
  registerRemotePush,
  setBackgroundPolling,
} from '../../src/lib/notifications'
import { getPrefs, savePrefs, subscribePrefs, type AlertKindPref, type Prefs } from '../../src/lib/prefs'
import { colors, fonts, spacing } from '../../src/theme'
import { useToast } from '../../src/ui/Toast'
import {
  Banner,
  Btn,
  Card,
  Chip,
  Header,
  KeyValue,
  Screen,
  ScreenScroll,
  Section,
  ToggleRow,
  Wrap,
} from '../../src/ui/Ui'

const KINDS: Array<{ id: AlertKindPref; label: string }> = [
  { id: 'uptime', label: 'Outages' },
  { id: 'error', label: 'Errors' },
  { id: 'delivery', label: 'Rule alerts' },
]

export default function SettingsScreen() {
  const toast = useToast()
  const { baseUrl, lock } = useAuth()
  const [prefs, setPrefs] = useState<Prefs>(getPrefs())
  const [bioOk, setBioOk] = useState(false)
  const [pushStatus, setPushStatus] = useState<string>('')
  const [pushToken, setPushToken] = useState('')

  useEffect(() => subscribePrefs(setPrefs), [])
  useEffect(() => {
    void biometricsAvailable().then(setBioOk)
  }, [])

  async function update(patch: Partial<Prefs>) {
    await savePrefs(patch)
  }

  async function connectPush() {
    setPushStatus('Registering…')
    const r = await registerRemotePush()
    if (r.ok) {
      setPushToken(r.token)
      setPushStatus('Remote push active')
      toast.success('Remote push registered')
    } else {
      setPushStatus(r.reason)
    }
  }

  return (
    <Screen>
      <Header title="Settings" back />
      <ScreenScroll>
        <Section title="Notifications" style={{ marginTop: 0 }}>
          <Card>
            <ToggleRow
              icon="notifications"
              title="Alert notifications"
              subtitle="Push + background polling for Atrium monitor alerts"
              value={prefs.notifications}
              onChange={async (v) => {
                if (v && !(await ensurePermission())) {
                  toast.error('Notification permission denied in system settings')
                  return
                }
                await update({ notifications: v })
                await setBackgroundPolling(v)
                if (v) void connectPush()
              }}
            />
            <ToggleRow
              icon="flame"
              tone="danger"
              title="Critical only"
              subtitle="Only outages and error spikes"
              value={prefs.criticalOnly}
              onChange={(v) => void update({ criticalOnly: v })}
            />
            <Text style={styles.label}>Notify me about</Text>
            <Wrap>
              {KINDS.map((k) => (
                <Chip
                  key={k.id}
                  label={k.label}
                  active={prefs.notifyKinds.includes(k.id)}
                  onPress={() =>
                    void update({
                      notifyKinds: prefs.notifyKinds.includes(k.id)
                        ? prefs.notifyKinds.filter((x) => x !== k.id)
                        : [...prefs.notifyKinds, k.id],
                    })
                  }
                />
              ))}
            </Wrap>
            <Text style={styles.label}>In-app refresh interval</Text>
            <Wrap>
              {[30, 60, 120, 300].map((s) => (
                <Chip
                  key={s}
                  label={s < 60 ? `${s}s` : `${s / 60}m`}
                  active={prefs.pollSeconds === s}
                  onPress={() => void update({ pollSeconds: s })}
                />
              ))}
            </Wrap>
          </Card>
          <Card style={{ marginTop: spacing.sm }}>
            <Text style={styles.cardTitle}>Remote push</Text>
            <Text style={styles.sub}>
              Server-side push from PA reaches you even when the app is closed. Background polling (every ~15 min) is
              the fallback.
            </Text>
            {pushStatus ? <Banner tone={pushToken ? 'ok' : 'warn'} inset>{pushStatus}</Banner> : null}
            <View style={styles.btnRow}>
              <Btn label="Register device" icon="phone-portrait" compact variant="secondary" onPress={() => void connectPush()} />
              <Btn
                label="Test push"
                icon="paper-plane"
                compact
                variant="secondary"
                onPress={() =>
                  void pushApi
                    .test(pushToken || undefined)
                    .then((r) => toast.success(r.sent ? `Delivered to ${r.sent} device(s)` : 'No registered devices'))
                    .catch((err: unknown) => toast.error(err instanceof Error ? err.message : 'Push failed'))
                }
              />
              <Btn
                label="Check now"
                icon="refresh"
                compact
                variant="secondary"
                onPress={() =>
                  void pollAndNotify({ notify: true })
                    .then((a) => toast.success(a.length ? `${a.length} new alert(s)` : 'No new alerts'))
                    .catch((err: unknown) => toast.error(err instanceof Error ? err.message : 'Check failed'))
                }
              />
            </View>
          </Card>
        </Section>

        <Section title="Security">
          <Card>
            <ToggleRow
              icon="finger-print"
              tone="ok"
              title="Biometric lock"
              subtitle={bioOk ? 'Require fingerprint / face to open' : 'No biometrics enrolled on this device'}
              value={prefs.biometricLock}
              disabled={!bioOk}
              onChange={(v) => void update({ biometricLock: v })}
            />
            {prefs.biometricLock ? (
              <>
                <Text style={styles.label}>Re-lock after background</Text>
                <Wrap>
                  {[0, 1, 5, 15, 60].map((m) => (
                    <Chip
                      key={m}
                      label={m === 0 ? 'Immediately' : m < 60 ? `${m} min` : '1 hour'}
                      active={prefs.relockMinutes === m}
                      onPress={() => void update({ relockMinutes: m })}
                    />
                  ))}
                </Wrap>
              </>
            ) : null}
          </Card>
        </Section>

        <Section title="Experience">
          <Card>
            <ToggleRow
              icon="hand-left"
              tone="info"
              title="Haptic feedback"
              subtitle="Vibrations on taps and actions"
              value={prefs.haptics}
              onChange={(v) => void update({ haptics: v })}
            />
          </Card>
        </Section>

        <Section title="Connection">
          <Card>
            <KeyValue k="PA API" v={baseUrl} />
            <KeyValue k="App version" v={Constants.expoConfig?.version} />
            <KeyValue k="Push project" v={(Constants.expoConfig?.extra as { eas?: { projectId?: string } })?.eas?.projectId} mono />
          </Card>
          <Btn
            label="Sign out"
            icon="log-out"
            variant="danger"
            block
            style={{ marginTop: spacing.md }}
            onPress={() => {
              if (pushToken) void pushApi.unregister(pushToken).catch(() => {})
              void lock().then(() => router.replace('/unlock'))
            }}
          />
        </Section>
      </ScreenScroll>
    </Screen>
  )
}

const styles = StyleSheet.create({
  label: {
    fontFamily: fonts.semiBold,
    color: colors.textDim,
    fontSize: 13,
    marginTop: spacing.xs,
  },
  cardTitle: { fontFamily: fonts.semiBold, color: colors.text, fontSize: 15 },
  sub: { fontFamily: fonts.regular, color: colors.muted, fontSize: 13, lineHeight: 18 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
})
