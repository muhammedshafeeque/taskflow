import { useEffect, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import type { QuietHours } from '../api/paAdmin'
import { colors, fonts, radius, spacing } from '../theme'
import { Btn, Card, ToggleRow } from './Ui'

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

const DEFAULTS: QuietHours = {
  enabled: false,
  start: '22:00',
  end: '08:00',
  timezone: 'Asia/Kolkata',
  awayMessage: '',
}

/** Edit the bot's quiet-hours window. Messages in the window are stored, not answered. */
export function QuietHoursCard({
  value,
  disabled,
  onSave,
}: {
  value?: QuietHours
  disabled?: boolean
  onSave: (next: Partial<QuietHours>) => Promise<void>
}) {
  const current = { ...DEFAULTS, ...(value ?? {}) }
  const [draft, setDraft] = useState(current)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setDraft({ ...DEFAULTS, ...(value ?? {}) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.enabled, value?.start, value?.end, value?.timezone, value?.awayMessage])

  const dirty =
    draft.start !== current.start ||
    draft.end !== current.end ||
    draft.timezone !== current.timezone ||
    draft.awayMessage !== current.awayMessage

  async function save(patch: Partial<QuietHours>) {
    if (patch.start !== undefined && !HHMM.test(patch.start)) return setError('Start must be HH:MM (24h), e.g. 22:00')
    if (patch.end !== undefined && !HHMM.test(patch.end)) return setError('End must be HH:MM (24h), e.g. 08:00')
    setError('')
    setSaving(true)
    try {
      await onSave(patch)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <ToggleRow
        icon="moon"
        tone="info"
        title="Quiet hours"
        subtitle={
          current.enabled
            ? `Bot rests ${current.start}–${current.end} (${current.timezone})`
            : 'Bot answers around the clock'
        }
        value={current.enabled}
        disabled={disabled || saving}
        onChange={(enabled) => void save({ enabled })}
      />
      {current.enabled ? (
        <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
          <View style={styles.row}>
            <Field label="From" value={draft.start} onChange={(start) => setDraft((d) => ({ ...d, start }))} placeholder="22:00" />
            <Field label="To" value={draft.end} onChange={(end) => setDraft((d) => ({ ...d, end }))} placeholder="08:00" />
          </View>
          <Field label="Timezone" value={draft.timezone} onChange={(timezone) => setDraft((d) => ({ ...d, timezone }))} placeholder="Asia/Kolkata" />
          <Field
            label="Away message (optional, sent once per night)"
            value={draft.awayMessage}
            onChange={(awayMessage) => setDraft((d) => ({ ...d, awayMessage }))}
            placeholder="Thanks! We're offline now and will reply in the morning."
            multiline
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Btn
            label="Save quiet hours"
            icon="checkmark"
            compact
            disabled={!dirty || saving}
            loading={saving}
            onPress={() => void save({ start: draft.start, end: draft.end, timezone: draft.timezone.trim(), awayMessage: draft.awayMessage })}
          />
        </View>
      ) : null}
    </Card>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  multiline?: boolean
}) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={[styles.input, multiline && { minHeight: 64, textAlignVertical: 'top' }]}
        multiline={multiline}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  label: { fontFamily: fonts.medium, color: colors.textDim, fontSize: 12 },
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
  error: { fontFamily: fonts.regular, color: colors.danger, fontSize: 12 },
})
