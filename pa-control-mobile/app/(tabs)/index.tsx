import { useCallback, useState } from 'react'
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import {
  type AdminStatus,
  type BotSettings,
  paAdmin,
} from '../../src/api/paAdmin'
import { useAuth } from '../../src/auth/AuthContext'
import { colors, fonts, spacing } from '../../src/theme'
import {
  Badge,
  BrandMark,
  Btn,
  Chip,
  ErrorText,
  Loading,
  Muted,
  PageHeader,
  Panel,
  Row,
  Screen,
  SectionLabel,
} from '../../src/ui/Ui'

const STT: Array<BotSettings['sttLanguage']> = ['ml', 'en', 'auto']

export default function DashboardScreen() {
  const { lock } = useAuth()
  const [status, setStatus] = useState<AdminStatus | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      setStatus(await paAdmin.status())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  async function patch(partial: Partial<BotSettings>) {
    setSaving(true)
    setError('')
    try {
      const settings = await paAdmin.patchSettings(partial)
      setStatus((s) => (s ? { ...s, settings } : s))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!status && !error) return <Loading />
  const s = status?.settings

  return (
    <Screen style={{ paddingTop: spacing.sm }}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => void load()}
            tintColor={colors.accent}
          />
        }
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        <BrandMark subtitle="Control Center" />
        <PageHeader
          title="Dashboard"
          subtitle="Bot status, global pause, and voice settings"
          right={
            <Btn
              label="Lock"
              variant="ghost"
              compact
              onPress={() => {
                void lock().then(() => router.replace('/unlock'))
              }}
            />
          }
        />
        <ErrorText>{error}</ErrorText>

        <View style={styles.stats}>
          <Panel style={styles.statCard}>
            <Muted style={styles.statLabel}>WhatsApp</Muted>
            <Badge
              label={status?.whatsapp.ready ? 'Ready' : 'Not ready'}
              tone={status?.whatsapp.ready ? 'ok' : 'warn'}
            />
            <Text style={styles.statMeta}>
              {status?.whatsapp.authenticated
                ? 'Authenticated'
                : 'Waiting auth'}
            </Text>
          </Panel>
          <Panel style={styles.statCard}>
            <Muted style={styles.statLabel}>Conversations</Muted>
            <Text style={styles.statValue}>
              {status?.counts.conversations ?? 0}
            </Text>
            <Text style={styles.statMeta}>
              {status?.counts.paused ?? 0} paused
            </Text>
          </Panel>
          <Panel style={styles.statCard}>
            <Muted style={styles.statLabel}>Local leads</Muted>
            <Text style={styles.statValue}>{status?.counts.leads ?? 0}</Text>
            <Text style={styles.statMeta}>WhatsApp → CRM</Text>
          </Panel>
        </View>

        <Panel>
          <SectionLabel>Controls</SectionLabel>
          <Row>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Pause all auto-replies</Text>
              <Muted style={{ marginBottom: 0 }}>
                Stops the bot for every chat
              </Muted>
            </View>
            <Btn
              label={s?.botPaused ? 'Resume' : 'Pause'}
              variant={s?.botPaused ? 'danger' : 'primary'}
              compact
              disabled={saving || !s}
              onPress={() => void patch({ botPaused: !s?.botPaused })}
            />
          </Row>
          <Row>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Voice assistance</Text>
              <Muted style={{ marginBottom: 0 }}>
                Spoken replies to voice notes
              </Muted>
            </View>
            <Btn
              label={s?.voiceRepliesEnabled ? 'On' : 'Off'}
              variant="ghost"
              compact
              disabled={saving || !s}
              onPress={() =>
                void patch({ voiceRepliesEnabled: !s?.voiceRepliesEnabled })
              }
            />
          </Row>
          <Text style={styles.label}>STT language</Text>
          <View style={styles.chips}>
            {STT.map((lang) => (
              <Chip
                key={lang}
                disabled={saving || !s}
                active={s?.sttLanguage === lang}
                onPress={() => void patch({ sttLanguage: lang })}
                label={
                  lang === 'ml'
                    ? 'Malayalam'
                    : lang === 'en'
                      ? 'English'
                      : 'Auto'
                }
              />
            ))}
          </View>
        </Panel>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 100,
    marginBottom: 0,
  },
  statLabel: { marginBottom: 4 },
  statValue: {
    fontFamily: fonts.bold,
    color: colors.text,
    fontSize: 22,
  },
  statMeta: {
    fontFamily: fonts.regular,
    color: colors.muted,
    fontSize: 12,
  },
  label: {
    fontFamily: fonts.semiBold,
    color: colors.text,
    fontSize: 14,
    marginBottom: 2,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
})
