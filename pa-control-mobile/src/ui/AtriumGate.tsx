import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { loadAtriumAuth } from '../api/atrium'
import { EmptyState, Loading } from './Ui'

/** Renders children only once an Atrium personal token is connected. */
export function AtriumGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'connected' | 'missing'>('loading')
  useEffect(() => {
    void loadAtriumAuth().then((a) => setState(a.connected ? 'connected' : 'missing'))
  }, [])
  if (state === 'loading') return <Loading />
  if (state === 'missing') {
    return (
      <EmptyState
        icon="key-outline"
        title="Connect your Atrium account"
        message="Create a personal API token in Atrium → Profile → API tokens, then paste it in Settings."
        action="Open settings"
        onAction={() => router.push('/(tabs)/settings')}
      />
    )
  }
  return <>{children}</>
}
