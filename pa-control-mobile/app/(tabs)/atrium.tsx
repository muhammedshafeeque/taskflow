import { StyleSheet, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { defaultAtriumUrl } from '../../src/api/paAdmin'
import { colors, spacing } from '../../src/theme'
import { PageHeader, Screen } from '../../src/ui/Ui'

export default function AtriumScreen() {
  const url = defaultAtriumUrl()
  return (
    <Screen style={styles.screen}>
      <View style={styles.headerPad}>
        <PageHeader title="Atrium" subtitle={url} />
      </View>
      <View style={styles.webWrap}>
        <WebView
          source={{ uri: url }}
          style={styles.web}
          startInLoadingState
          setSupportMultipleWindows={false}
        />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  screen: {
    paddingTop: spacing.sm,
    paddingBottom: 0,
    paddingHorizontal: 0,
  },
  headerPad: {
    paddingHorizontal: spacing.md,
  },
  webWrap: {
    flex: 1,
    overflow: 'hidden',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  web: { flex: 1, backgroundColor: colors.bg },
})
