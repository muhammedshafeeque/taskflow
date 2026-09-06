import { Redirect } from 'expo-router'
import { useAuth } from '../src/auth/AuthContext'
import { Loading } from '../src/ui/Ui'

export default function Index() {
  const { ready, unlocked } = useAuth()
  if (!ready) return <Loading />
  if (!unlocked) return <Redirect href="/unlock" />
  return <Redirect href="/(tabs)" />
}
