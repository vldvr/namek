import type { CSSProperties } from 'react'
import { Modal } from '../components/Modal'
import { Switch } from '../components/Switch'
import { sound } from '../audio/sound'
import { native } from '../lib/native'
import { useApp, type Settings } from '../store/app'
import { ProfileEditor } from './ProfileEditor'

const TOGGLES: { key: keyof Settings; title: string; hint: string }[] = [
  { key: 'confirmReveal', title: 'Открывать в два нажатия', hint: 'Первое нажатие отмечает слово для команды, «Открыть» открывает. Без этого слово открывается сразу.' },
  { key: 'patterns', title: 'Узоры на цветах команд', hint: 'Штриховка у янтарных и точки у бирюзовых, если цвета плохо различаются.' },
  { key: 'turnSound', title: 'Звук, когда твой ход', hint: 'Капитан слышит, что пора давать намёк.' },
  { key: 'reduceMotion', title: 'Меньше анимации', hint: 'Слова открываются без переворота.' },
]

export function SettingsModal() {
  const open = useApp((s) => s.settingsOpen)
  const s = useApp((st) => st.settings)
  const set = useApp((st) => st.setSettings)
  const version = useApp((st) => st.appVersion)
  const update = useApp((st) => st.update)
  const inRoom = useApp((st) => st.screen === 'room')
  const close = () => useApp.setState({ settingsOpen: false })

  return (
    <Modal open={open} title="Настройки" onClose={close} width={480}>
      {inRoom && <ProfileEditor />}
      <div className="field">
        <span className="field__label">Громкость</span>
        <div className="row">
          <input
            type="range"
            className="range"
            min={0}
            max={1}
            step={0.05}
            value={s.muted ? 0 : s.volume}
            style={{ '--fill': `${(s.muted ? 0 : s.volume) * 100}%` } as CSSProperties}
            onChange={(e) => set({ volume: Number(e.target.value), muted: false })}
            onPointerUp={() => sound.play('select', { volume: 0.8 })}
            aria-label="Громкость"
          />
          <span className="num">{s.muted ? 0 : Math.round(s.volume * 100)}</span>
        </div>
      </div>
      {TOGGLES.map((t) => (
        <div key={t.key} className="row">
          <div className="row__text">
            <span>{t.title}</span>
            <span className="row__hint">{t.hint}</span>
          </div>
          <Switch checked={!!s[t.key]} onChange={(v) => set({ [t.key]: v } as Partial<Settings>)} label={t.title} />
        </div>
      ))}
      <div className="row">
        <button className="link-btn" onClick={() => useApp.setState({ notes: { seen: null, all: true }, settingsOpen: false })}>
          Что нового в версии <span className="num">{version}</span>
        </button>
        {update.state === 'ready' && (
          <button className="btn btn--sm btn--primary" onClick={() => native?.update.install()}>
            Обновить до {update.version}
          </button>
        )}
      </div>
    </Modal>
  )
}
