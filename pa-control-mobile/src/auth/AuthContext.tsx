import * as LocalAuthentication from 'expo-local-authentication'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AppState, Platform } from 'react-native'
import {
  clearAuth,
  defaultApiUrl,
  loadAuthFromStore,
  paAdmin,
  setAuth,
} from '../api/paAdmin'
import { getPrefs, loadPrefs } from '../lib/prefs'

type AuthState = {
  ready: boolean
  unlocked: boolean
  /** True while the biometric gate is covering the app. */
  bioLocked: boolean
  baseUrl: string
  unlock: (secret: string, baseUrl: string) => Promise<void>
  lock: () => Promise<void>
  bioUnlock: () => Promise<boolean>
}

const AuthContext = createContext<AuthState | null>(null)

export async function biometricsAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false
  try {
    const [hw, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ])
    return hw && enrolled
  } catch {
    return false
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [bioLocked, setBioLocked] = useState(false)
  const [baseUrl, setBaseUrl] = useState(defaultApiUrl())
  const backgroundedAt = useRef<number | null>(null)

  useEffect(() => {
    void (async () => {
      const [stored, prefs] = await Promise.all([loadAuthFromStore(), loadPrefs()])
      setBaseUrl(stored.baseUrl)
      if (stored.secret) {
        try {
          await paAdmin.status()
          setUnlocked(true)
          if (prefs.biometricLock && (await biometricsAvailable())) setBioLocked(true)
        } catch (err) {
          // Only drop credentials on an explicit auth rejection; keep them when offline.
          const msg = err instanceof Error ? err.message : ''
          if (/unauthor|401|secret required/i.test(msg)) {
            await clearAuth()
            setUnlocked(false)
          } else {
            setUnlocked(true)
            if (prefs.biometricLock && (await biometricsAvailable())) setBioLocked(true)
          }
        }
      }
      setReady(true)
    })()
  }, [])

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') {
        backgroundedAt.current = Date.now()
      } else if (s === 'active' && backgroundedAt.current) {
        const prefs = getPrefs()
        const away = Date.now() - backgroundedAt.current
        backgroundedAt.current = null
        if (unlocked && prefs.biometricLock && away >= prefs.relockMinutes * 60_000) {
          void biometricsAvailable().then((ok) => ok && setBioLocked(true))
        }
      }
    })
    return () => sub.remove()
  }, [unlocked])

  const unlock = useCallback(async (secret: string, apiBase: string) => {
    await setAuth(secret, apiBase)
    try {
      await paAdmin.status()
    } catch (err) {
      await clearAuth()
      throw err
    }
    setBaseUrl(apiBase.trim().replace(/\/$/, '') || defaultApiUrl())
    setUnlocked(true)
  }, [])

  const lock = useCallback(async () => {
    await clearAuth()
    setUnlocked(false)
    setBioLocked(false)
    setBaseUrl(defaultApiUrl())
  }, [])

  const bioUnlock = useCallback(async () => {
    try {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock PA Control',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      })
      if (res.success) setBioLocked(false)
      return res.success
    } catch {
      return false
    }
  }, [])

  const value = useMemo(
    () => ({ ready, unlocked, bioLocked, baseUrl, unlock, lock, bioUnlock }),
    [ready, unlocked, bioLocked, baseUrl, unlock, lock, bioUnlock]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
