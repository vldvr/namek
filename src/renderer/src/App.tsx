import { useEffect } from 'react'
import { MotionConfig } from 'motion/react'
import { releasesSince } from './changelog'
import { Toasts } from './components/Toasts'
import { native } from './lib/native'
import { loadRaw, save } from './lib/storage'
import { Home } from './screens/Home'
import { ProposeModal } from './screens/ProposeModal'
import { Room } from './screens/Room'
import { SettingsModal } from './screens/SettingsModal'
import { WhatsNew } from './screens/WhatsNew'
import { useApp } from './store/app'

export function App() {
  const screen = useApp((s) => s.screen)
  const appVersion = useApp((s) => s.appVersion)
  const reduceMotion = useApp((s) => s.settings.reduceMotion)

  useEffect(() => {
    if (!native) {
      useApp.setState({ appVersion: __APP_VERSION__ })
      return
    }
    void native.info().then((i) => useApp.setState({ appVersion: i.version }))
    return native.update.onState((update) => useApp.setState({ update }))
  }, [])

  // После обновления показываем, что изменилось. Новому игроку показывать нечего.
  useEffect(() => {
    if (appVersion === '0.0.0') return
    const seen = loadRaw<string>('seenVersion')
    if (seen === null && !useApp.getState().profile.name) return save('seenVersion', appVersion)
    if (releasesSince(seen, appVersion).length) useApp.setState({ notes: { seen, all: false } })
    else if (seen !== appVersion) save('seenVersion', appVersion)
  }, [appVersion])

  useEffect(() => {
    const onFocus = () => native?.flash(false)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  return (
    <MotionConfig reducedMotion={reduceMotion ? 'always' : 'user'}>
      {screen === 'home' ? <Home /> : <Room />}
      <Toasts />
      <WhatsNew />
      <SettingsModal />
      <ProposeModal />
      <div className="grain" aria-hidden="true" />
    </MotionConfig>
  )
}
