import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { ArrowRight, Circle, Crown, HourglassMedium, Triangle, X } from '@phosphor-icons/react'
import type { Clue, Color, Team } from '../../../engine/index.ts'
import type { CardView, GameView, PlayerView, RoomView } from '../../../protocol/index.ts'
import { Avatar } from '../components/Avatar'
import { clock, plural } from '../lib/format'
import { captainOf, countLabel, guessersOf, me as meOf, TEAM_GEN, TEAM_NAME } from '../lib/teams'
import { send } from '../net/connection'
import { useApp } from '../store/app'

type Role = 'captain' | 'guesser' | 'spectator'

export function Board({ view, you }: { view: RoomView; you: string | null }) {
  const g = view.game!
  const mine = meOf(view, you)
  const role: Role = !mine?.team ? 'spectator' : mine.captain ? 'captain' : 'guesser'
  const myTurn = !!mine?.team && mine.team === g.turn && g.phase !== 'over'
  const canGuess = myTurn && role === 'guesser' && g.phase === 'guess'

  return (
    <div className={`board-screen ${role === 'captain' ? 'is-captain' : ''}`}>
      <TeamRail view={view} team="amber" />
      <div className="board-center">
        <Status view={view} mine={mine} role={role} />
        <Grid g={g} you={you} canGuess={canGuess} captain={role === 'captain'} players={view.players} />
        <ActionBar g={g} role={role} myTurn={myTurn} />
      </div>
      <TeamRail view={view} team="teal" />
      <AnimatePresence>{view.stage === 'over' && <GameOver view={view} you={you} />}</AnimatePresence>
    </div>
  )
}

// ——— строка состояния: чей ход и что делать мне ———

function Status({ view, mine, role }: { view: RoomView; mine: PlayerView | null; role: Role }) {
  const g = view.game!
  const turn = g.turn
  const cap = captainOf(view, turn)
  const clue = g.phase === 'guess' ? g.clues.at(-1) : null
  const mineTurn = mine?.team === turn

  let main: string
  let sub: string | null = null
  if (g.phase === 'over') {
    main = `Победа ${TEAM_GEN[g.winner!]}`
    sub = g.endReason === 'trap' ? 'Соперники открыли чёрное слово' : 'Все слова команды открыты'
  } else if (g.phase === 'clue') {
    if (mineTurn && role === 'captain') {
      main = 'Твой намёк'
      sub = 'Одно слово и число: сколько слов на поле к нему относятся'
    } else {
      main = `${TEAM_NAME[turn]} ждут намёк`
      sub = `${cap?.name ?? 'Капитан'} думает над намёком${mineTurn ? '. Подсказывать капитану нельзя' : ''}`
    }
  } else {
    const left = g.guessesLeft === -1 ? 'без ограничения попыток' : `${g.guessesLeft} ${plural(g.guessesLeft, 'попытка', 'попытки', 'попыток')}`
    if (mineTurn && role === 'guesser') {
      main = 'Ваша очередь угадывать'
      sub = `Нажми слово, чтобы отметить, и «Открыть», когда команда согласна. Ещё ${left}`
    } else if (mineTurn && role === 'captain') {
      main = 'Команда угадывает'
      sub = `Молчи и не подавай виду. У них ${left}`
    } else {
      main = `${TEAM_NAME[turn]} угадывают`
      sub = `У них ${left}`
    }
  }

  return (
    <div className={`status team-${g.phase === 'over' ? g.winner : turn}`}>
      <div className="status__text">
        <h2 className="status__main">{main}</h2>
        {sub && <p className="status__sub">{sub}</p>}
      </div>
      {clue && (
        <div className="status__clue" aria-label={`Намёк: ${clue.word}, ${countLabel(clue.count)}`}>
          <span className="status__clue-word">{clue.word}</span>
          <span className="status__clue-count num">{countLabel(clue.count)}</span>
        </div>
      )}
      <Countdown deadline={g.deadline} serverNow={view.serverNow} />
    </div>
  )
}

function Countdown({ deadline, serverNow }: { deadline: number | null; serverNow: number }) {
  // Часы клиента и сервера могут расходиться: считаем от смещения, полученного вместе с видом.
  const offset = useRef(0)
  useEffect(() => {
    offset.current = serverNow - Date.now()
  }, [serverNow])
  const [, tick] = useState(0)
  useEffect(() => {
    if (!deadline) return
    const t = setInterval(() => tick((x) => x + 1), 250)
    return () => clearInterval(t)
  }, [deadline])
  if (!deadline) return null
  const left = deadline - (Date.now() + offset.current)
  return (
    <div className={`countdown num ${left < 15_000 ? 'is-low' : ''}`}>
      <HourglassMedium size={18} /> {clock(left)}
    </div>
  )
}

// ——— поле ———

const GLYPH: Record<Color, typeof Circle | null> = { amber: Triangle, teal: Circle, trap: X, neutral: null }

function Grid({ g, you, canGuess, captain, players }: { g: GameView; you: string | null; canGuess: boolean; captain: boolean; players: PlayerView[] }) {
  const confirmReveal = useApp((s) => s.settings.confirmReveal)
  const patterns = useApp((s) => s.settings.patterns)
  const avatars = useApp((s) => s.avatars)
  const reduce = useReducedMotion()
  const myMarks = Object.entries(g.marks)
    .filter(([, ids]) => you && ids.includes(you))
    .map(([i]) => Number(i))

  const onTile = (i: number, c: CardView) => {
    if (!canGuess || c.revealed) return
    if (!confirmReveal) return send({ t: 'reveal', index: i })
    send({ t: 'mark', index: i })
  }

  return (
    <div className={`grid ${patterns ? 'has-patterns' : ''} ${canGuess ? 'is-active' : ''}`} role="grid" aria-label="Поле">
      {g.cards.map((c, i) => {
        const marked = g.marks[i] ?? []
        const mineMarked = myMarks.includes(i)
        const Glyph = c.color ? GLYPH[c.color] : null
        const keyTint = captain && !c.revealed && g.phase !== 'over'
        const shownColor = c.revealed || g.phase === 'over' ? c.color : keyTint ? c.color : null
        return (
          <motion.div
            key={i}
            role="gridcell"
            tabIndex={canGuess && !c.revealed ? 0 : -1}
            aria-label={`${c.word}${c.revealed ? `, открыто: ${colorName(c.color)}` : keyTint ? `, ${colorName(c.color)}` : ''}`}
            className={[
              'tile',
              shownColor ? `tile--${shownColor}` : '',
              c.revealed ? 'is-revealed' : '',
              keyTint ? 'is-key' : '',
              g.phase === 'over' && !c.revealed ? 'is-unrevealed' : '',
              mineMarked ? 'is-mine' : '',
              marked.length ? 'is-marked' : '',
              canGuess && !c.revealed ? 'is-clickable' : '',
            ].join(' ')}
            onClick={() => onTile(i, c)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onTile(i, c)
              }
            }}
            initial={false}
            animate={c.revealed && !reduce ? { rotateX: [90, 0] } : {}}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            <FitWord word={c.word} />
            {Glyph && (shownColor || c.revealed) && <Glyph className="tile__glyph" size={14} weight={c.color === 'trap' ? 'bold' : 'fill'} aria-hidden="true" />}
            {marked.length > 0 && !c.revealed && (
              <div className="tile__marks" aria-label={`Отметили: ${marked.map((id) => players.find((p) => p.id === id)?.name).join(', ')}`}>
                {marked.slice(0, 5).map((id) => {
                  const p = players.find((x) => x.id === id)
                  return p ? <Avatar key={id} name={p.name} color={p.color} src={avatars[id]} size={20} /> : null
                })}
              </div>
            )}
            {mineMarked && canGuess && !c.revealed && (
              <button
                className="tile__open"
                onClick={(e) => {
                  e.stopPropagation()
                  send({ t: 'reveal', index: i })
                }}
              >
                Открыть
              </button>
            )}
          </motion.div>
        )
      })}
    </div>
  )
}

function colorName(c: Color | null): string {
  return c === 'amber' ? 'янтарное' : c === 'teal' ? 'бирюзовое' : c === 'trap' ? 'чёрное' : c === 'neutral' ? 'нейтральное' : ''
}

/** Слово любой длины влезает в карточку: подбираем кегль по ширине. */
function FitWord({ word }: { word: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [size, setSize] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const box = el?.parentElement
    if (!el || !box) return
    const fit = () => {
      const max = Math.min(26, box.clientHeight * 0.3)
      const avail = box.clientWidth - 20
      el.style.fontSize = `${max}px`
      const w = el.scrollWidth
      setSize(w > avail ? Math.max(10, (max * avail) / w) : max)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(box)
    return () => ro.disconnect()
  }, [word])
  return (
    <span ref={ref} className="tile__word" style={size ? ({ fontSize: size } as CSSProperties) : undefined}>
      {word}
    </span>
  )
}

// ——— панель действий ———

const COUNTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, -1]

function ActionBar({ g, role, myTurn }: { g: GameView; role: Role; myTurn: boolean }) {
  if (g.phase === 'over') return <div className="actionbar" />
  if (myTurn && role === 'captain' && g.phase === 'clue') return <ClueForm g={g} />
  if (myTurn && role === 'guesser' && g.phase === 'guess') {
    const tried = (g.clues.at(-1)?.guesses.length ?? 0) > 0
    return (
      <div className="actionbar">
        <button className="btn btn--lg" disabled={!tried} onClick={() => send({ t: 'pass' })} title={tried ? undefined : 'Сначала откройте хотя бы одно слово'}>
          Закончить ход
        </button>
      </div>
    )
  }
  return <div className="actionbar" />
}

function ClueForm({ g }: { g: GameView }) {
  const [word, setWord] = useState('')
  const [count, setCount] = useState<number | null>(null)
  const norm = word.trim().toLocaleUpperCase('ru-RU').replace(/Ё/g, 'Е')
  // Та же проверка, что на сервере: говорим сразу, а не после отправки.
  let problem: string | null = null
  if (norm && !/^[А-ЯA-Z][А-ЯA-Z-]*$/.test(norm)) problem = 'Одно слово, только буквы'
  else if (norm) {
    const hit = g.cards.find((c) => !c.revealed && (c.word === norm || (norm.length >= 3 && c.word.includes(norm)) || (c.word.length >= 3 && norm.includes(c.word))))
    if (hit) problem = `Слишком близко к слову ${hit.word} на поле`
  }
  const ready = !!norm && !problem && count !== null
  const submit = () => {
    if (!ready) return
    send({ t: 'clue', word: norm, count: count! })
  }
  return (
    <form
      className="actionbar clue-form"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="clue-form__field">
        <input className="input clue-form__input" value={word} autoFocus maxLength={24} spellCheck={false} placeholder="Намёк" onChange={(e) => setWord(e.target.value.replace(/\s/g, ''))} aria-label="Слово-намёк" aria-invalid={!!problem} />
        {problem && <span className="clue-form__problem">{problem}</span>}
      </div>
      <div className="clue-form__counts" role="radiogroup" aria-label="Сколько слов">
        {COUNTS.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={count === n} className="num" onClick={() => setCount(n)} title={n === -1 ? 'Без ограничения: команда угадывает сколько хочет' : n === 0 ? 'Ноль: ни одно слово не относится, угадывать без ограничения' : undefined}>
            {countLabel(n)}
          </button>
        ))}
      </div>
      <button className="btn btn--primary btn--lg" disabled={!ready}>
        Дать намёк <ArrowRight size={18} />
      </button>
    </form>
  )
}

// ——— боковые панели команд ———

function TeamRail({ view, team }: { view: RoomView; team: Team }) {
  const g = view.game!
  const avatars = useApp((s) => s.avatars)
  const cap = captainOf(view, team)
  const guessers = guessersOf(view, team)
  const clues = g.clues.filter((c) => c.team === team)
  const active = g.phase !== 'over' && g.turn === team
  return (
    <aside className={`rail team-${team} ${active ? 'is-active' : ''}`} aria-label={TEAM_NAME[team]}>
      <div className="rail__head">
        <h2 className="rail__name">{TEAM_NAME[team]}</h2>
        <span className="rail__left num" title="Осталось открыть">
          {g.remaining[team]}
        </span>
      </div>
      <ul className="rail__people">
        {cap && (
          <li className={cap.online ? '' : 'is-offline'}>
            <Avatar name={cap.name} color={cap.color} src={avatars[cap.id]} size={26} dim={!cap.online} />
            <span>{cap.name}</span>
            <Crown size={14} weight="fill" className="rail__crown" aria-label="капитан" />
          </li>
        )}
        {guessers.map((p) => (
          <li key={p.id} className={p.online ? '' : 'is-offline'}>
            <Avatar name={p.name} color={p.color} src={avatars[p.id]} size={26} dim={!p.online} />
            <span>{p.name}</span>
          </li>
        ))}
      </ul>
      <div className="rail__clues">
        {clues.length === 0 && <p className="rail__empty">Намёков ещё не было</p>}
        {clues
          .slice()
          .reverse()
          .map((c, i) => (
            <ClueRow key={clues.length - i} clue={c} cards={g.cards} />
          ))}
      </div>
    </aside>
  )
}

function ClueRow({ clue, cards }: { clue: Clue; cards: CardView[] }) {
  return (
    <div className="clue-row">
      <div className="clue-row__head">
        <span className="clue-row__word">{clue.word}</span>
        <span className="clue-row__count num">{countLabel(clue.count)}</span>
      </div>
      {clue.guesses.length > 0 && (
        <div className="clue-row__guesses">
          {clue.guesses.map((x) => (
            <span key={x.index} className={`gchip tile--${x.color}`}>
              {cards[x.index]?.word}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ——— конец партии ———

function GameOver({ view, you }: { view: RoomView; you: string | null }) {
  const g = view.game!
  const isHost = view.hostId === you
  const winner = g.winner!
  const mine = meOf(view, you)
  const won = mine?.team === winner
  const [hidden, setHidden] = useState(false)
  if (hidden)
    return (
      <motion.button className={`over-chip team-${winner}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={() => setHidden(false)}>
        Победа {TEAM_GEN[winner]}: показать итог
      </motion.button>
    )
  return (
    <motion.div className="over" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className={`over__card team-${winner}`} initial={{ y: 24, scale: 0.97 }} animate={{ y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 28, delay: 0.5 }}>
        <p className="over__kicker">{mine?.team ? (won ? 'Вы выиграли' : 'Вы проиграли') : 'Партия окончена'}</p>
        <h2 className="over__title">Победа {TEAM_GEN[winner]}</h2>
        <p className="over__reason">{g.endReason === 'trap' ? `${TEAM_NAME[winner === 'amber' ? 'teal' : 'amber']} открыли чёрное слово.` : 'Все слова команды открыты.'}</p>
        <p className="over__score num">
          <span className="t-amber">{view.score.amber}</span> : <span className="t-teal">{view.score.teal}</span>
        </p>
        <div className="over__actions">
          {isHost ? (
            <>
              <button className="btn btn--primary btn--lg" onClick={() => send({ t: 'start' })}>
                Ещё партия
              </button>
              <button className="btn btn--lg" onClick={() => send({ t: 'lobby' })}>
                Поменять команды
              </button>
            </>
          ) : (
            <p className="over__wait">Хост начнёт следующую партию</p>
          )}
        </div>
        <div className="over__links">
          <button className="link-btn" onClick={() => setHidden(true)}>
            Посмотреть поле
          </button>
          <button className="link-btn" onClick={() => useApp.setState({ propose: { where: 'room' } })}>
            Предложить слово
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
