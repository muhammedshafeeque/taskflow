import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  clearAuth,
  defaultApiUrl,
  loadAuthFromStore,
  paAdmin,
  setAuth,
} from '../api/paAdmin'

type AuthState = {
  ready: boolean
  unlocked: boolean
  baseUrl: string
  unlock: (secret: string, baseUrl: string) => Promise<void>
  lock: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [baseUrl, setBaseUrl] = useState(defaultApiUrl())

  useEffect(() => {
    void (async () => {
      const stored = await loadAuthFromStore()
      setBaseUrl(stored.baseUrl)
      if (stored.secret) {
        try {
          await paAdmin.status()
          setUnlocked(true)
        } catch {
          await clearAuth()
          setUnlocked(false)
        }
      }
      setReady(true)
    })()
  }, [])

  const unlock = useCallback(async (secret: string, apiBase: string) => {
    await setAuth(secret, apiBase)
    await paAdmin.status()
    setBaseUrl(apiBase.trim().replace(/\/$/, '') || defaultApiUrl())
    setUnlocked(true)
  }, [])

  const lock = useCallback(async () => {
    await clearAuth()
    setUnlocked(false)
    setBaseUrl(defaultApiUrl())
  }, [])

  const value = useMemo(
    () => ({ ready, unlocked, baseUrl, unlock, lock }),
    [ready, unlocked, baseUrl, unlock, lock]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
