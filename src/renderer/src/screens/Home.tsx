import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { ArrowCounterClockwise, GearSix, PencilSimple, PlusCircle } from '@phosphor-icons/react'
import { Avatar } from '../components/Avatar'
import { Modal } from '../components/Modal'
import { formatCode } from '../lib/format'
import { isMac } from '../lib/native'
import { cancelJoin, createRoom, joinByCode, lastRoom } from '../net/connection'
import { useApp } from '../store/app'
import { ProfileEditor } from './ProfileEditor'
import './home.css'
import './room.css'

export function Home() {
  const profile = useApp((s) => s.profile)
  const conn = useApp((s) => s.conn)
  const code = useApp((s) => s.code)
  const error = useApp((s) => s.homeError)
  const version = useApp((s) => s.appVersion)
  const update = useApp((s) => s.update)
  const [digits, setDigits] = useState('')
  const [editProfile, setEditProfile] = useState(false)
  const [after, setAfter] = useState<(() => void) | null>(null)
  const recent = lastRoom()
  const needName = !profile.name.trim()
  const busy = conn === 'connecting'

  /** Без имени сначала спрашиваем имя, потом делаем то, что хотели. */
  const withName = (fn: () => void) => {
    if (!needName) return fn()
    setAfter(() => fn)
    setEditProfile(true)
  }
  const join = (c = digits) => c.length === 6 && withName(() => void joinByCode(c))

  return (
    <div className={`home ${isMac ? 'is-mac' : ''}`}>
      <div className="home__drag" />
      <HeroBoard />

      <main className="home__main">
        <h1 className="home__title">Намёк</h1>
        <p className="home__lede">Капитан даёт одно слово и число. Команда ищет на поле, что он имел в виду.</p>

        <button className="home__me" onClick={() => setEditProfile(true)}>
          <Avatar name={profile.name || '?'} color={profile.color} src={profile.avatar} size={36} />
          <span className="home__me-name">{profile.name.trim() || 'Как тебя зовут?'}</span>
          <PencilSimple size={15} className="home__me-edit" />
        </button>

        <div className="home__actions">
          <button className="btn btn--primary btn--lg" onClick={() => withName(() => void createRoom())} disabled={busy}>
            Создать комнату
          </button>

          <div className="home__join">
            <span className="home__join-label">или войти по коду</span>
            <div className="home__join-row">
              <CodeInput value={digits} onChange={setDigits} onSubmit={() => join()} disabled={busy} />
              <button className="btn btn--lg" onClick={() => join()} disabled={busy || digits.length !== 6}>
                Войти
              </button>
            </div>
            {recent && !busy && (
              <button className="home__recent" onClick={() => join(recent)}>
                <ArrowCounterClockwise size={15} /> Вернуться в комнату <span className="num">{formatCode(recent)}</span>
              </button>
            )}
            <AnimatePresence mode="wait">
              {busy ? (
                <motion.div key="busy" className="home__status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <span className="pulse" />
                  {code ? `Ищем комнату ${formatCode(code)}` : 'Создаём комнату'}
                  <button className="link-btn" onClick={cancelJoin}>
                    Отмена
                  </button>
                </motion.div>
              ) : error ? (
                <motion.p key="err" className="form-error" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  {error}
                </motion.p>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      </main>

      <footer className="home__foot">
        <button className="home__link" onClick={() => useApp.setState({ propose: { where: 'home' } })}>
          <PlusCircle size={16} /> Предложить слово в словарь
        </button>
        <button className="home__link" onClick={() => useApp.setState({ notes: { seen: null, all: true } })} title="Что нового">
          Намёк <span className="num">{version}</span>
        </button>
        {update.state === 'ready' && <span className="home__update">Обновление {update.version} поставится после перезапуска</span>}
        {update.state === 'available' && <span className="home__update">Вышла версия {update.version}</span>}
      </footer>

      <button className="icon-btn home__settings" onClick={() => useApp.setState({ settingsOpen: true })} aria-label="Настройки">
        <GearSix size={22} />
      </button>

      <Modal
        open={editProfile}
        title="Профиль"
        onClose={() => {
          setEditProfile(false)
          setAfter(null)
        }}
      >
        <ProfileEditor autoFocus />
        <button
          className="btn btn--primary"
          disabled={!profile.name.trim()}
          onClick={() => {
            setEditProfile(false)
            after?.()
            setAfter(null)
          }}
        >
          {after ? 'Готово, дальше' : 'Готово'}
        </button>
      </Modal>
    </div>
  )
}

function CodeInput({ value, onChange, onSubmit, disabled }: { value: string; onChange(v: string): void; onSubmit(): void; disabled?: boolean }) {
  // Одно настоящее поле под шестью ячейками: быстрый ввод и вставка «490 379» не теряют цифры.
  const [focused, setFocused] = useState(false)
  return (
    <label className={`code ${focused ? 'is-focused' : ''}`}>
      <input
        className="code__input"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        value={value}
        disabled={disabled}
        aria-label="Код комнаты из шести цифр"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
      />
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className={`code__cell num ${i === 3 ? 'is-gap' : ''} ${focused && i === Math.min(value.length, 5) ? 'is-active' : ''}`} aria-hidden="true">
          {value[i] ?? ''}
        </span>
      ))}
    </label>
  )
}

/** Кусок поля справа: слова открываются по одному, как в партии. */
const HERO = [
  ['КЛЮЧ', 'teal'], ['ВОЛНА', null], ['МАЯК', 'amber'], ['ОРГАН', null],
  ['ЗАМОК', null], ['ПЕРО', 'amber'], ['КИТ', null], ['ТЕНЬ', 'neutral'],
  ['КОРОНА', 'amber'], ['ЛУК', null], ['ЭХО', 'teal'], ['ЯКОРЬ', null],
] as const

function HeroBoard() {
  const reduce = useReducedMotion()
  return (
    <div className="home__art" aria-hidden="true">
      <div className="home__clue">
        <span className="home__clue-word">СВЕТ</span>
        <span className="home__clue-count num">3</span>
      </div>
      <div className="home__grid">
        {HERO.map(([w, c], i) => (
          <motion.div
            key={w}
            className={`tile tile--hero ${c ? `tile--${c} is-revealed` : ''}`}
            initial={reduce ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 + i * 0.04, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="tile__word">{w}</span>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
