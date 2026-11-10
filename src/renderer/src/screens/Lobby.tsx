import { useEffect, useState, type DragEvent, type ReactNode } from 'react'
import { Crown, Eye, Shuffle, UserMinus, X } from '@phosphor-icons/react'
import type { Team } from '../../../engine/index.ts'
import type { PlayerView, RoomSettings, RoomView, WordSource } from '../../../protocol/index.ts'
import { Avatar } from '../components/Avatar'
import { Modal } from '../components/Modal'
import { plural } from '../lib/format'
import { captainOf, guessersOf, me as meOf, TEAM_NAME, TEAMS } from '../lib/teams'
import { send } from '../net/connection'
import { useApp } from '../store/app'

type Seat = { team: Team | null; captain: boolean }

export function Lobby({ view, you }: { view: RoomView; you: string | null }) {
  const isHost = view.hostId === you
  const mine = meOf(view, you)
  const spectators = view.players.filter((p) => p.team === null)
  const [dragging, setDragging] = useState<string | null>(null)

  /** Себя пересаживает любой, других — только хост. */
  const seat = (id: string, s: Seat) => {
    if (id === you) send({ t: 'seat', ...s })
    else if (isHost) send({ t: 'move', id, ...s })
  }
  const dropProps = (s: Seat) => ({
    onDragOver: (e: DragEvent) => {
      if (dragging) e.preventDefault()
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      const id = e.dataTransfer.getData('text/plain')
      if (id) seat(id, s)
      setDragging(null)
    },
  })
  const chip = (p: PlayerView, big = false) => (
    <PlayerChip key={p.id} p={p} you={you} host={view.hostId} big={big} draggable={isHost || p.id === you} onDrag={setDragging} kick={isHost && p.id !== you ? () => send({ t: 'kick', id: p.id }) : undefined} />
  )

  return (
    <div className="lobby">
      {TEAMS.map((team) => {
        const cap = captainOf(view, team)
        const guessers = guessersOf(view, team)
        const iAmCap = mine?.team === team && mine.captain
        const iAmGuesser = mine?.team === team && !mine.captain
        return (
          <section key={team} className={`lobby__team team-${team} ${dragging ? 'is-dropping' : ''}`} aria-label={TEAM_NAME[team]}>
            <h2 className="lobby__team-name">{TEAM_NAME[team]}</h2>

            <div className="lobby__slot lobby__slot--captain" {...dropProps({ team, captain: true })}>
              <span className="lobby__slot-label">
                <Crown size={15} weight="fill" /> Капитан
              </span>
              {cap ? chip(cap, true) : <span className="lobby__empty">Пока никого</span>}
              {!iAmCap && (
                <button className="btn btn--sm lobby__sit" onClick={() => send({ t: 'seat', team, captain: true })}>
                  {cap ? 'Стать капитаном' : 'Быть капитаном'}
                </button>
              )}
            </div>

            <div className="lobby__slot" {...dropProps({ team, captain: false })}>
              <span className="lobby__slot-label">Отгадчики</span>
              <div className="lobby__list">
                {guessers.map((p) => chip(p))}
                {guessers.length === 0 && <span className="lobby__empty">Нужен хотя бы один</span>}
              </div>
              {!iAmGuesser && (
                <button className="btn btn--sm lobby__sit" onClick={() => send({ t: 'seat', team, captain: false })}>
                  Отгадывать здесь
                </button>
              )}
            </div>
          </section>
        )
      })}

      <section className="lobby__middle">
        <div className="lobby__start">
          {isHost ? (
            <>
              <button className="btn btn--primary btn--lg" disabled={!!view.blocker} onClick={() => send({ t: 'start' })}>
                Начать партию
              </button>
              <p className="lobby__hint">{view.blocker ?? 'Все на местах'}</p>
              <button className="btn btn--sm btn--ghost" onClick={() => send({ t: 'shuffle' })}>
                <Shuffle size={16} /> Перемешать команды
              </button>
            </>
          ) : (
            <>
              <p className="lobby__wait">Ждём, когда хост начнёт</p>
              <p className="lobby__hint">{view.blocker ?? 'Все на местах'}</p>
            </>
          )}
        </div>

        <div className="lobby__spectators" {...dropProps({ team: null, captain: false })}>
          <span className="lobby__slot-label">
            <Eye size={15} /> Без команды
          </span>
          <div className="lobby__list">
            {spectators.map((p) => chip(p))}
            {spectators.length === 0 && <span className="lobby__empty">Все разобраны</span>}
          </div>
          {mine?.team && (
            <button className="btn btn--sm btn--ghost lobby__sit" onClick={() => send({ t: 'seat', team: null, captain: false })}>
              Просто смотреть
            </button>
          )}
        </div>

        <RoomSettingsPanel view={view} isHost={isHost} />
      </section>
    </div>
  )
}

function PlayerChip({ p, you, host, big, draggable, onDrag, kick }: { p: PlayerView; you: string | null; host: string; big?: boolean; draggable: boolean; onDrag(id: string | null): void; kick?: () => void }) {
  const avatars = useApp((s) => s.avatars)
  return (
    <div
      className={`pchip ${big ? 'pchip--big' : ''} ${p.online ? '' : 'is-offline'} ${p.id === you ? 'is-me' : ''}`}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', p.id)
        e.dataTransfer.effectAllowed = 'move'
        onDrag(p.id)
      }}
      onDragEnd={() => onDrag(null)}
      title={p.online ? undefined : 'Нет связи'}
    >
      <Avatar name={p.name} color={p.color} src={avatars[p.id]} size={big ? 34 : 26} dim={!p.online} />
      <span className="pchip__name">{p.name}</span>
      {p.id === you && <span className="pchip__tag">ты</span>}
      {p.id === host && <span className="pchip__tag">хост</span>}
      {kick && (
        <button className="pchip__kick" aria-label={`Убрать ${p.name} из комнаты`} title="Убрать из комнаты" onClick={() => confirm(`Убрать ${p.name} из комнаты? Вернуться по этому коду он не сможет.`) && kick()}>
          <UserMinus size={14} />
        </button>
      )}
    </div>
  )
}

const SOURCES: { id: WordSource; label: string }[] = [
  { id: 'common', label: 'Общий словарь' },
  { id: 'custom', label: 'Только свои' },
  { id: 'mix', label: 'Вперемешку' },
]
const TIMES = [0, 60, 90, 120, 180]
const timeLabel = (s: number) => (s === 0 ? 'Нет' : s % 60 ? `${s / 60} мин`.replace('.', ',') : `${s / 60} мин`)

function RoomSettingsPanel({ view, isHost }: { view: RoomView; isHost: boolean }) {
  const s = view.settings
  const [wordsOpen, setWordsOpen] = useState(false)
  const set = (patch: Partial<RoomSettings>) => send({ t: 'settings', settings: { ...s, ...patch } })

  return (
    <div className="lobby__settings">
      <Row label="Слова">
        <Segmented value={s.source} options={SOURCES} onChange={(source) => set({ source })} disabled={!isHost} />
      </Row>
      {s.source !== 'common' && (
        <Row label="Свои слова">
          <span className="lobby__count">
            {view.customWords ? `${view.customWords} ${plural(view.customWords, 'слово', 'слова', 'слов')}` : 'Ещё нет'}
          </span>
          {isHost && (
            <button className="btn btn--sm" onClick={() => setWordsOpen(true)}>
              {view.customWords ? 'Изменить' : 'Добавить'}
            </button>
          )}
        </Row>
      )}
      <Row label="Время на намёк">
        <Segmented value={s.clueSeconds} options={TIMES.map((t) => ({ id: t, label: timeLabel(t) }))} onChange={(clueSeconds) => set({ clueSeconds })} disabled={!isHost} />
      </Row>
      <Row label="Время на угадывание">
        <Segmented value={s.guessSeconds} options={TIMES.map((t) => ({ id: t, label: timeLabel(t) }))} onChange={(guessSeconds) => set({ guessSeconds })} disabled={!isHost} />
      </Row>
      {!isHost && <p className="lobby__hint">Настройки меняет хост</p>}
      <CustomWordsModal open={wordsOpen} onClose={() => setWordsOpen(false)} count={view.customWords} />
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="srow">
      <span className="srow__label">{label}</span>
      <div className="srow__value">{children}</div>
    </div>
  )
}

function Segmented<T extends string | number>({ value, options, onChange, disabled }: { value: T; options: { id: T; label: string }[]; onChange(v: T): void; disabled?: boolean }) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button key={String(o.id)} aria-pressed={o.id === value} disabled={disabled} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Список хоста: по слову на строку или через запятую. Сервер сам уберёт дубли и мусор. */
function CustomWordsModal({ open, onClose, count }: { open: boolean; onClose(): void; count: number }) {
  const [text, setText] = useState('')
  useEffect(() => {
    if (open) setText('')
  }, [open])
  const parsed = text
    .split(/[\n,;]+/)
    .map((w) => w.trim())
    .filter(Boolean)
  const unique = new Set(parsed.map((w) => w.toLocaleUpperCase('ru-RU').replace(/Ё/g, 'Е')))
  return (
    <Modal open={open} title="Свои слова" onClose={onClose} width={520}>
      <p className="modal__lede">
        По слову на строку или через запятую. Слова живут только в этой комнате{count ? `, новый список заменит ${count} текущих` : ''}.
      </p>
      <textarea className="input words-area" value={text} autoFocus onChange={(e) => setText(e.target.value)} placeholder={'дача\nшашлык\nВася с третьего этажа'} />
      <div className="words-foot">
        <span className={unique.size >= 25 ? '' : 'is-short'}>
          {unique.size} {plural(unique.size, 'слово', 'слова', 'слов')}
          {unique.size < 25 && ' · для «только свои» нужно 25'}
        </span>
        <div className="words-foot__actions">
          {count > 0 && (
            <button
              className="btn btn--sm btn--ghost"
              onClick={() => {
                send({ t: 'words', words: [] })
                onClose()
              }}
            >
              <X size={14} /> Очистить
            </button>
          )}
          <button
            className="btn btn--primary"
            disabled={unique.size === 0}
            onClick={() => {
              send({ t: 'words', words: parsed.slice(0, 400) })
              onClose()
            }}
          >
            Загрузить
          </button>
        </div>
      </div>
    </Modal>
  )
}
