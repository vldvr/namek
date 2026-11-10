import type { Clue, Color, Team } from '../engine/index.ts'
import type { RoomSettings } from './messages.ts'

export interface PlayerView {
  id: string
  name: string
  color: string
  team: Team | null
  captain: boolean
  online: boolean
}

export interface CardView {
  word: string
  /** Цвет виден капитанам, всем открытым словам и всем после конца партии. */
  color: Color | null
  revealed: boolean
}

export interface GameView {
  cards: CardView[]
  starting: Team
  turn: Team
  phase: 'clue' | 'guess' | 'over'
  clues: Clue[]
  /** -1 — без лимита. */
  guessesLeft: number
  remaining: Record<Team, number>
  winner: Team | null
  endReason: 'cleared' | 'trap' | null
  /** Метки команды, которая сейчас угадывает: индекс → id игроков. */
  marks: Record<number, string[]>
  /** Когда истечёт таймер текущей фазы (мс эпохи сервера), null — без таймера. */
  deadline: number | null
}

export interface RoomView {
  code: string
  hostId: string
  stage: 'lobby' | 'play' | 'over'
  players: PlayerView[]
  settings: RoomSettings
  /** Сколько своих слов загружено в комнату. */
  customWords: number
  game: GameView | null
  /** Счёт серии в этой комнате. */
  score: Record<Team, number>
  /** Почему нельзя начать (для подсказки хосту), null — можно. */
  blocker: string | null
  serverNow: number
}
