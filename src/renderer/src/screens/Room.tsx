import { useEffect, useRef } from 'react'
import { Copy, GearSix, PlusCircle, SignOut, WifiSlash } from '@phosphor-icons/react'
import { sound } from '../audio/sound'
import { formatCode } from '../lib/format'
import { isMac, native } from '../lib/native'
import { me, TEAM_GEN } from '../lib/teams'
import { leaveRoom } from '../net/connection'
import { useApp } from '../store/app'
import { Board } from './Board'
import { Lobby } from './Lobby'
import './room.css'

export function Room() {
  const view = useApp((s) => s.view)
  const you = useApp((s) => s.you)
  const conn = useApp((s) => s.conn)
  useRoomSounds()
  if (!view) return null
  const turn = view.stage !== 'lobby' && view.game ? view.game.turn : null

  return (
    <div className={`room ${isMac ? 'is-mac' : ''}`} data-turn={view.stage === 'play' ? turn ?? undefined : undefined}>
      <header className="topbar">
        <div className="topbar__left">
          <button
            className="topbar__code"
            title="Скопировать код"
            onClick={() => {
              void navigator.clipboard.writeText(view.code)
              useApp.getState().toast('Код скопирован')
            }}
          >
            Комната <span className="num">{formatCode(view.code)}</span>
            <Copy size={15} />
          </button>
          {(view.score.amber > 0 || view.score.teal > 0) && (
            <span className="topbar__score num" title="Счёт серии">
              <span className="t-amber">{view.score.amber}</span>
              <span className="topbar__colon">:</span>
              <span className="t-teal">{view.score.teal}</span>
            </span>
          )}
          {conn === 'reconnecting' && (
            <span className="topbar__conn">
              <WifiSlash size={15} /> Переподключаемся
            </span>
          )}
        </div>
        <div className="topbar__right">
          <button className="topbar__btn" onClick={() => useApp.setState({ propose: { where: 'room' } })}>
            <PlusCircle size={17} /> Предложить слово
          </button>
          <button className="icon-btn" onClick={() => useApp.setState({ settingsOpen: true })} aria-label="Настройки">
            <GearSix size={20} />
          </button>
          <button
            className="icon-btn"
            aria-label="Выйти из комнаты"
            title="Выйти из комнаты"
            onClick={() => {
              const playing = view.stage === 'play' && me(view, you)?.team
              if (!playing || confirm('Выйти посреди партии? Твоя команда останется без тебя.')) leaveRoom()
            }}
          >
            <SignOut size={20} />
          </button>
        </div>
      </header>
      {view.stage === 'lobby' ? <Lobby view={view} you={you} /> : <Board view={view} you={you} />}
      <span className="visually-hidden" aria-live="polite">
        {turn ? `Ход ${TEAM_GEN[turn]}` : ''}
      </span>
    </div>
  )
}

/** Звуки и мигание значка по событиям комнаты. */
function useRoomSounds() {
  const events = useApp((s) => s.events)
  const seen = useRef(events.seq)
  useEffect(() => {
    if (events.seq === seen.current) return
    seen.current = events.seq
    const { view, you, settings } = useApp.getState()
    const mine = me(view, you)
    for (const e of events.list) {
      switch (e.e) {
        case 'start':
          sound.play('level', { volume: 0.5 })
          break
        case 'clue':
          sound.play('chime', { volume: 0.6 })
          if (mine?.team === e.team && !mine.captain) native?.flash(true)
          break
        case 'reveal':
          if (e.color === 'trap') sound.play('leave', { volume: 0.8, rate: 0.7 })
          else if (e.color === 'neutral') sound.play('tick', { volume: 0.6 })
          else sound.play('select', { volume: 0.55, rate: e.color === 'amber' ? 1 : 1.12 })
          break
        case 'turn':
          if (settings.turnSound && mine?.team === e.team && mine.captain) {
            sound.play('turn', { volume: 0.6, delay: 0.25 })
            native?.flash(true)
          }
          break
        case 'over':
          sound.play('win', { volume: mine?.team === e.winner ? 0.7 : 0.35, delay: 0.3 })
          break
        case 'join':
          if (e.id !== you) sound.play('join', { volume: 0.3 })
          break
        case 'leave':
          break
      }
    }
  }, [events])
}
