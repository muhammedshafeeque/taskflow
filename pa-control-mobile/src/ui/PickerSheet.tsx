import { Modal, Pressable, ScrollView, StyleSheet, Text } from 'react-native'
import { colors, fonts, radius, spacing } from '../theme'

/** Bottom sheet with a list of choices (Alert.alert caps at 3 buttons on Android). */
export function PickerSheet<T extends string>({
  title,
  options,
  onPick,
  onClose,
}: {
  title: string
  options: Array<{ id: T; label: string; hint?: string }> | null
  onPick: (id: T) => void
  onClose: () => void
}) {
  return (
    <Modal visible={Boolean(options)} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.title}>{title}</Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {(options ?? []).map((o) => (
              <Pressable key={o.id} onPress={() => onPick(o.id)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
                <Text style={styles.label}>{o.label}</Text>
                {o.hint ? <Text style={styles.hint}>{o.hint}</Text> : null}
              </Pressable>
            ))}
            {options && !options.length ? <Text style={styles.hint}>Nothing to choose from.</Text> : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bgElevated, padding: spacing.lg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, gap: spacing.sm },
  title: { fontFamily: fonts.semiBold, color: colors.text, fontSize: 16, marginBottom: spacing.xs },
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  label: { fontFamily: fonts.medium, color: colors.text, fontSize: 15 },
  hint: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12 },
})
