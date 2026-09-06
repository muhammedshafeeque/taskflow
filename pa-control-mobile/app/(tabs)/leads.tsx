import { useCallback, useState } from 'react'
import { FlatList, StyleSheet, Text } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { type WhatsappLead, paAdmin } from '../../src/api/paAdmin'
import { colors, fonts, spacing } from '../../src/theme'
import {
  Badge,
  EmptyState,
  ErrorText,
  Loading,
  PageHeader,
  Panel,
  Screen,
} from '../../src/ui/Ui'

export default function LeadsScreen() {
  const [rows, setRows] = useState<WhatsappLead[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setError('')
    try {
      setRows(await paAdmin.listLeads())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leads')
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  if (loading) return <Loading />

  return (
    <Screen style={{ paddingTop: spacing.sm }}>
      <PageHeader
        title="Leads"
        subtitle="Local WhatsApp leads (synced to CRM when ingest is configured)"
      />
      <ErrorText>{error}</ErrorText>
      <FlatList
        data={rows}
        keyExtractor={(item) => item._id}
        contentContainerStyle={{ paddingBottom: 40, gap: spacing.sm }}
        ListEmptyComponent={<EmptyState message="No leads yet" />}
        renderItem={({ item }) => (
          <Panel>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.meta}>
              {item.contactName || item.contactPhone || item.chatId}
            </Text>
            {item.crmLeadId ? (
              <Badge label={`CRM ${item.crmLeadId}`} tone="accent" />
            ) : null}
            <Text style={styles.body}>{item.summary}</Text>
          </Panel>
        )}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  title: {
    fontFamily: fonts.semiBold,
    color: colors.text,
    fontSize: 15,
  },
  meta: {
    fontFamily: fonts.regular,
    color: colors.muted,
    fontSize: 13,
  },
  body: {
    fontFamily: fonts.regular,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
})
