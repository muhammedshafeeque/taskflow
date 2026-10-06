import { useCallback, useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { atrium, type Deal, type Pipeline } from '../src/api/atrium'
import { compact } from '../src/lib/format'
import { colors, fonts, spacing } from '../src/theme'
import { AtriumGate } from '../src/ui/AtriumGate'
import { useToast } from '../src/ui/Toast'
import { Card, Chip, EmptyState, Header, Screen, ScreenScroll, Section, Segmented, Wrap } from '../src/ui/Ui'

function PipelineInner() {
  const toast = useToast()
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [deals, setDeals] = useState<Deal[] | null>(null)
  const [pipelineId, setPipelineId] = useState('')
  const [moving, setMoving] = useState<Deal | null>(null)

  const load = useCallback(async () => {
    try {
      const [p, d] = await Promise.all([atrium.pipelines(), atrium.deals()])
      setPipelines(p)
      setDeals(d)
      setPipelineId((cur) => cur || (p.find((x) => x.isDefault) ?? p[0])?._id || '')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load pipeline')
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const pipeline = pipelines.find((p) => p._id === pipelineId)
  const stages = useMemo(() => [...(pipeline?.stages ?? [])].filter((s) => !s.isLost).sort((a, b) => a.order - b.order), [pipeline])
  const inPipeline = (deals ?? []).filter((d) => d.pipelineId === pipelineId)
  const total = inPipeline.reduce((s, d) => s + (d.value ?? 0), 0)
  const weighted = inPipeline.reduce((s, d) => s + (d.value ?? 0) * ((stages.find((st) => st._id === d.stageId)?.probability ?? 0) / 100), 0)

  async function move(deal: Deal, stageId: string) {
    try {
      await atrium.moveDeal(deal._id, stageId)
      setMoving(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Move failed')
    }
  }

  return (
    <ScreenScroll onRefresh={load}>
      {pipelines.length > 1 ? (
        <Segmented options={pipelines.map((p) => ({ id: p._id, label: p.name }))} value={pipelineId} onChange={setPipelineId} />
      ) : null}
      <Text style={styles.summary}>
        {inPipeline.length} open deals · {compact(total)} total · {compact(Math.round(weighted))} weighted
      </Text>
      {deals && !inPipeline.length ? <EmptyState icon="briefcase-outline" title="No open deals" message="Deals you can see in Atrium show up here." /> : null}
      {stages.map((st) => {
        const list = inPipeline.filter((d) => d.stageId === st._id)
        if (!list.length) return null
        return (
          <Section key={st._id} title={`${st.name} · ${list.length} · ${st.probability}%`}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              {list.map((d) => (
                <Card key={d._id} style={styles.deal} onPress={() => setMoving(moving?._id === d._id ? null : d)}>
                  <Text style={styles.title} numberOfLines={2}>
                    {d.title}
                  </Text>
                  <Text style={styles.value}>
                    {d.currency} {compact(d.value)}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {d.customerOrgId?.name ?? '—'}
                    {d.expectedCloseDate ? ` · ${new Date(d.expectedCloseDate).toLocaleDateString()}` : ''}
                  </Text>
                </Card>
              ))}
            </ScrollView>
            {moving && list.some((d) => d._id === moving._id) ? (
              <View style={{ marginTop: spacing.sm }}>
                <Text style={styles.meta}>Move “{moving.title}” to</Text>
                <Wrap>
                  {(pipeline?.stages ?? [])
                    .filter((s) => s._id !== moving.stageId)
                    .sort((a, b) => a.order - b.order)
                    .map((s) => (
                      <Chip key={s._id} label={s.name} tone={s.isWon ? 'ok' : s.isLost ? 'danger' : undefined} onPress={() => void move(moving, s._id)} />
                    ))}
                </Wrap>
              </View>
            ) : null}
          </Section>
        )
      })}
    </ScreenScroll>
  )
}

export default function PipelineScreen() {
  return (
    <Screen>
      <Header title="Pipeline" subtitle="Open CRM deals by stage" back />
      <AtriumGate>
        <PipelineInner />
      </AtriumGate>
    </Screen>
  )
}

const styles = StyleSheet.create({
  summary: { fontFamily: fonts.medium, color: colors.textDim, fontSize: 13, marginTop: spacing.sm },
  deal: { width: 220, gap: 4 },
  title: { fontFamily: fonts.semiBold, color: colors.text, fontSize: 14 },
  value: { fontFamily: fonts.bold, color: colors.ok, fontSize: 15 },
  meta: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12 },
})
