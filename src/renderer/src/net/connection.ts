import { GameSession, type Profile, type SessionHandlers } from '../../../client/session.ts'
import type { ClientMessage, RejectReason } from '../../../protocol/index.ts'
import { formatCode } from '../lib/format'
import { playerToken } from '../lib/id'
import { native } from '../lib/native'
import { loadRaw, save } from '../lib/storage'
import { useApp } from '../store/app'
import { BusyError, connect, NotFoundError } from './server'

let session: GameSession | null = null
/** Куда переподключаться: код комнаты, где мы сидим. */
let target: string | null = null
let reconnecting = false
let eventSeq = 0

const set = useApp.setState

async function profile(): Promise<Profile> {
  const p = useApp.getState().profile
  return {
    name: p.name.trim() || 'Игрок',
    color: p.color,
    avatar: p.avatar,
    token: await playerToken(p.token),
    appVersion: useApp.getState().appVersion,
  }
}

// Профиль поменяли прямо в комнате: отправляем, когда закончили печатать.
let profileTimer: ReturnType<typeof setTimeout> | null = null
useApp.subscribe((s, prev) => {
  if (s.profile === prev.profile || !session || s.screen !== 'room') return
  const a = s.profile
  const b = prev.profile
  if (a.name === b.name && a.color === b.color && a.avatar === b.avatar) return
  if (profileTimer) clearTimeout(profileTimer)
  profileTimer = setTimeout(() => {
    const p = useApp.getState().profile
    if (!session || !p.name.trim()) return
    session.updateProfile({ name: p.name.trim(), color: p.color, avatar: p.avatar })
  }, 700)
})

const REJECTS: Record<RejectReason, string> = {
  version: 'У сервера другая версия игры. Обнови приложение.',
  full: 'В комнате нет мест.',
  kicked: 'Хост убрал тебя из комнаты.',
  closed: 'Комната закрыта.',
}

/** Коды ошибок сервера → что сказать игроку. Молчим о тех, что интерфейс и так не допускает. */
export const ERRORS: Record<string, string> = {
  clue_on_board: 'Нельзя называть слово с поля или его часть',
  bad_clue: 'Намёк — одно слово, без пробелов и цифр',
  bad_count: 'Число — от 0 до 9 или ∞',
  captain_taken: 'У команды уже есть капитан',
  captain_locked: 'Капитан видел ключ — до конца партии он капитан',
  in_game: 'Посреди партии менять команду нельзя',
  cannot_start: 'Пока нельзя начать',
  not_enough_words: 'Слов не хватает на поле',
  not_host: 'Это может только хост',
  server: 'Сервер споткнулся, попробуй ещё раз',
}

function handlers(): SessionHandlers {
  return {
    onWelcome(you, view, avatars) {
      reconnecting = false
      target = view.code
      save('lastRoom', { code: view.code, at: Date.now() })
      set({ you, view, avatars, conn: 'online', screen: 'room', code: view.code, homeError: null })
    },
    onView(view, events) {
      set({ view, ...(events.length ? { events: { seq: ++eventSeq, list: events } } : {}) })
    },
    onAvatar(id, avatar) {
      const avatars = { ...useApp.getState().avatars }
      if (avatar) avatars[id] = avatar
      else delete avatars[id]
      set({ avatars })
    },
    onReject(reason) {
      if (reason === 'kicked') save('lastRoom', null)
      backHome(REJECTS[reason])
    },
    onError(code) {
      const text = ERRORS[code]
      if (text) useApp.getState().toast(text, 'error')
    },
    onDrop() {
      void reconnect()
    },
  }
}

function backHome(error: string | null) {
  session?.close()
  session = null
  target = null
  reconnecting = false
  set({ screen: 'home', code: null, conn: 'idle', you: null, view: null, avatars: {}, homeError: error })
  native?.flash(false)
}

async function open(t: { create: true } | { code: string }) {
  const me = await profile()
  if (!session) session = new GameSession(me, handlers())
  else session.setProfile(me)
  const { transport, first } = await connect(t, session.hello())
  session.attach(transport, first)
}

async function reconnect() {
  if (reconnecting || !target) return
  reconnecting = true
  set({ conn: 'reconnecting' })
  const delays = [300, 1000, 2000, 4000, 7000, 12_000, 20_000, 30_000, 30_000, 30_000]
  for (const d of delays) {
    await new Promise((r) => setTimeout(r, d))
    if (!reconnecting || !target) return
    try {
      await open({ code: target })
      return
    } catch (err) {
      if (err instanceof NotFoundError) {
        save('lastRoom', null)
        return backHome('Комната закрылась.')
      }
    }
  }
  backHome('Связь с сервером потеряна. Попробуй войти ещё раз.')
}

function fail(err: unknown, code: string | null) {
  set({
    code: null,
    conn: 'idle',
    homeError:
      err instanceof NotFoundError
        ? `Комнаты ${formatCode(code ?? '')} нет. Проверь код.`
        : err instanceof BusyError
          ? 'Сервер просит подождать минуту.'
          : 'Сервер игры не отвечает. Проверь интернет.',
  })
}

export async function createRoom() {
  set({ conn: 'connecting', homeError: null })
  try {
    await open({ create: true })
  } catch (err) {
    session = null
    fail(err, null)
  }
}

export async function joinByCode(code: string) {
  set({ code, conn: 'connecting', homeError: null })
  try {
    await open({ code })
  } catch (err) {
    session = null
    if (err instanceof NotFoundError && loadRaw<{ code: string }>('lastRoom')?.code === code) save('lastRoom', null)
    fail(err, code)
  }
}

/** Комната, в которой игрок был последним (за последние полчаса). */
export function lastRoom(): string | null {
  const r = loadRaw<{ code: string; at: number }>('lastRoom')
  return r && Date.now() - r.at < 30 * 60_000 ? r.code : null
}

export function cancelJoin() {
  target = null
  session?.close()
  session = null
  set({ code: null, conn: 'idle' })
}

export function send(msg: ClientMessage) {
  session?.send(msg)
}

export function leaveRoom() {
  session?.send({ t: 'leave' })
  save('lastRoom', null)
  backHome(null)
}

export function latency(): number | null {
  return session?.latency ?? null
}

