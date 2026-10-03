import * as WebBrowser from 'expo-web-browser'
import { useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { defaultAtriumUrl } from '../../src/api/paAdmin'
import { colors, spacing } from '../../src/theme'
import { Chip, ChipScroll, Header, IconButton, ProgressBar, Screen, type IconName } from '../../src/ui/Ui'

const SECTIONS: Array<{ path: string; label: string; icon: IconName }> = [
  { path: '/dashboard', label: 'Dashboard', icon: 'grid' },
  { path: '/issues', label: 'Issues', icon: 'git-branch' },
  { path: '/projects', label: 'Projects', icon: 'folder' },
  { path: '/monitor', label: 'Monitor', icon: 'pulse' },
  { path: '/service', label: 'Service desk', icon: 'headset' },
  { path: '/crm', label: 'CRM', icon: 'briefcase' },
  { path: '/inbox', label: 'Inbox', icon: 'mail' },
  { path: '/calendar', label: 'Calendar', icon: 'calendar' },
  { path: '/timesheet', label: 'Timesheet', icon: 'time' },
  { path: '/reports', label: 'Reports', icon: 'bar-chart' },
]

export default function AtriumScreen() {
  const base = defaultAtriumUrl()
  const web = useRef<WebView>(null)
  const [uri, setUri] = useState(`${base}/dashboard`)
  const [current, setCurrent] = useState(uri)
  const [progress, setProgress] = useState(0)
  const [nav, setNav] = useState({ back: false, forward: false })

  const activePath = SECTIONS.find((s) => current.startsWith(`${base}${s.path}`))?.path

  return (
    <Screen>
      <Header
        title="Atrium"
        subtitle={current.replace(/^https?:\/\//, '')}
        back
        right={
          <>
            <IconButton icon="refresh" size={36} onPress={() => web.current?.reload()} />
            <IconButton icon="open-outline" size={36} onPress={() => void WebBrowser.openBrowserAsync(current)} />
          </>
        }
      />
      <View style={{ paddingLeft: spacing.md }}>
        <ChipScroll>
          {SECTIONS.map((s) => (
            <Chip key={s.path} label={s.label} icon={s.icon} active={activePath === s.path} onPress={() => setUri(`${base}${s.path}?t=${Date.now()}`)} />
          ))}
        </ChipScroll>
      </View>
      {progress > 0 && progress < 1 ? <ProgressBar value={progress} /> : <View style={{ height: 6 }} />}
      <View style={styles.webWrap}>
        <WebView
          ref={web}
          source={{ uri }}
          style={styles.web}
          setSupportMultipleWindows={false}
          pullToRefreshEnabled
          allowsBackForwardNavigationGestures
          sharedCookiesEnabled
          onLoadProgress={(e) => setProgress(e.nativeEvent.progress)}
          onNavigationStateChange={(s) => {
            setCurrent(s.url)
            setNav({ back: s.canGoBack, forward: s.canGoForward })
          }}
        />
      </View>
      <View style={styles.toolbar}>
        <IconButton icon="chevron-back" disabled={!nav.back} onPress={() => web.current?.goBack()} size={38} />
        <IconButton icon="chevron-forward" disabled={!nav.forward} onPress={() => web.current?.goForward()} size={38} />
        <IconButton icon="home" onPress={() => setUri(`${base}/dashboard?t=${Date.now()}`)} size={38} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  webWrap: {
    flex: 1,
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  web: { flex: 1, backgroundColor: colors.bg },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.xs,
    backgroundColor: colors.bgElevated,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
})
