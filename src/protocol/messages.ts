import { z } from 'zod'
import type { RoomView } from './view.ts'

/** Меняется при несовместимых правках протокола: сервер не пустит старый клиент. */
export const PROTOCOL_VERSION = 1

export const LIMITS = {
  name: 24,
  avatar: 48_000,
  customWords: 400,
  word: 24,
  minWords: 25,
} as const

const team = z.enum(['amber', 'teal'])
const color = z.string().regex(/^#[0-9a-f]{6}$/i)
const avatar = z.string().max(LIMITS.avatar).startsWith('data:image/').nullable()
const index = z.number().int().min(0).max(24)

export const wordSource = z.enum(['common', 'custom', 'mix'])
export type WordSource = z.infer<typeof wordSource>

export const roomSettings = z.object({
  source: wordSource,
  /** Секунд на подсказку капитану; 0 — без таймера. */
  clueSeconds: z.number().int().min(0).max(600),
  /** Секунд на угадывание; 0 — без таймера. */
  guessSeconds: z.number().int().min(0).max(600),
})
export type RoomSettings = z.infer<typeof roomSettings>
export const DEFAULT_SETTINGS: RoomSettings = { source: 'common', clueSeconds: 0, guessSeconds: 0 }

export const clientMessage = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('hello'),
    v: z.number(),
    name: z.string().min(1).max(LIMITS.name),
    color,
    avatar,
    token: z.string().min(16).max(80),
    appVersion: z.string().max(32),
  }),
  z.object({ t: z.literal('ping'), ts: z.number(), rtt: z.number().nullable() }),
  z.object({ t: z.literal('profile'), name: z.string().min(1).max(LIMITS.name), color, avatar }),
  /** Сесть в команду (капитаном или отгадчиком) или уйти в зрители (team: null). */
  z.object({ t: z.literal('seat'), team: team.nullable(), captain: z.boolean() }),
  // Хост комнаты
  z.object({ t: z.literal('move'), id: z.string().max(40), team: team.nullable(), captain: z.boolean() }),
  z.object({ t: z.literal('shuffle') }),
  z.object({ t: z.literal('settings'), settings: roomSettings }),
  z.object({ t: z.literal('words'), words: z.array(z.string().max(LIMITS.word)).max(LIMITS.customWords) }),
  z.object({ t: z.literal('start') }),
  z.object({ t: z.literal('kick'), id: z.string().max(40) }),
  /** Вернуться в лобби с теми же составами (после партии или прервать текущую). */
  z.object({ t: z.literal('lobby') }),
  // Игра
  z.object({ t: z.literal('clue'), word: z.string().max(LIMITS.word), count: z.number().int().min(-1).max(9) }),
  /** Метка «я за это слово»: видна команде, ничего не открывает. */
  z.object({ t: z.literal('mark'), index }),
  z.object({ t: z.literal('reveal'), index }),
  z.object({ t: z.literal('pass') }),
  z.object({ t: z.literal('leave') }),
])
export type ClientMessage = z.infer<typeof clientMessage>
export type HelloMessage = Extract<ClientMessage, { t: 'hello' }>

export function parseClientMessage(raw: unknown): ClientMessage | null {
  const r = clientMessage.safeParse(raw)
  return r.success ? r.data : null
}

export type RejectReason = 'version' | 'full' | 'kicked' | 'closed'

/** Событие для звука и анимации. Состояние всегда приходит целиком во view. */
export type RoomEvent =
  | { e: 'start' }
  | { e: 'clue'; team: 'amber' | 'teal'; word: string; count: number }
  | { e: 'reveal'; index: number; by: string; color: 'amber' | 'teal' | 'neutral' | 'trap' }
  | { e: 'turn'; team: 'amber' | 'teal'; reason: 'pass' | 'miss' | 'limit' | 'timeout' }
  | { e: 'over'; winner: 'amber' | 'teal'; reason: 'cleared' | 'trap' }
  | { e: 'join'; id: string }
  | { e: 'leave'; id: string }

export type ServerMessage =
  | { t: 'welcome'; you: string; view: RoomView; avatars: Record<string, string> }
  | { t: 'view'; view: RoomView; events?: RoomEvent[] }
  | { t: 'avatar'; id: string; avatar: string | null }
  | { t: 'reject'; reason: RejectReason; serverVersion?: number }
  | { t: 'error'; code: string }
  | { t: 'pong'; ts: number }
