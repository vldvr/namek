import { describe, expect, it } from 'vitest'
import { Room, ROOM_LIMITS, type Clock, type Link } from './room.ts'
import { openWords } from './words.ts'
import { seededRandomInt } from '../src/engine/index.ts'
import { PROTOCOL_VERSION, type RoomView, type ServerMessage } from '../src/protocol/index.ts'

const WORDS = Array.from({ length: 60 }, (_, i) => `СЛОВО${String.fromCharCode(1040 + (i % 32))}${String.fromCharCode(1040 + Math.floor(i / 32))}`)

class FakeClock implements Clock {
  t = 1_000_000
  timers: { at: number; fn: () => void; id: number }[] = []
  private id = 0
  now = () => this.t
  setTimeout = (fn: () => void, ms: number) => {
    const id = ++this.id
    this.timers.push({ at: this.t + ms, fn, id })
    return id
  }
  clearTimeout = (h: unknown) => {
    this.timers = this.timers.filter((x) => x.id !== h)
  }
  advance(ms: number) {
    this.t += ms
    for (;;) {
      const due = this.timers.filter((x) => x.at <= this.t).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      this.timers = this.timers.filter((x) => x !== due)
      due.fn()
    }
  }
}

class Client {
  inbox: ServerMessage[] = []
  closed = false
  id = ''
  link: Link = {
    send: (m) => this.inbox.push(structuredClone(m)),
    close: () => (this.closed = true),
  }
  session
  constructor(public room: Room, public token: string, name = token) {
    this.session = room.attach(this.link)
    this.send({ t: 'hello', v: PROTOCOL_VERSION, name, color: '#aabbcc', avatar: null, token, appVersion: '0.1.0' })
    const w = this.inbox.find((m) => m.t === 'welcome')
    if (w && w.t === 'welcome') this.id = w.you
  }
  send(m: unknown) {
    this.session.receive(m)
  }
  get view(): RoomView {
    for (let i = this.inbox.length - 1; i >= 0; i--) {
      const m = this.inbox[i]!
      if (m.t === 'view' || m.t === 'welcome') return m.view
    }
    throw new Error('no view')
  }
  get lastError() {
    return [...this.inbox].reverse().find((m) => m.t === 'error')
  }
}

function setup(seed = 7) {
  const clock = new FakeClock()
  const room = new Room({ code: '123456', commonWords: () => WORDS, clock, rnd: seededRandomInt(seed) })
  const tk = (s: string) => `${s}-token-0123456789`
  const host = new Client(room, tk('host'))
  const a2 = new Client(room, tk('a2'))
  const t1 = new Client(room, tk('t1'))
  const t2 = new Client(room, tk('t2'))
  host.send({ t: 'seat', team: 'amber', captain: true })
  a2.send({ t: 'seat', team: 'amber', captain: false })
  t1.send({ t: 'seat', team: 'teal', captain: true })
  t2.send({ t: 'seat', team: 'teal', captain: false })
  return { clock, room, host, a2, t1, t2, tk }
}

function started(seed = 7) {
  const s = setup(seed)
  s.host.send({ t: 'start' })
  expect(s.host.view.stage).toBe('play')
  return s
}

describe('комната', () => {
  it('первый вошедший — хост; без составов начать нельзя', () => {
    const clock = new FakeClock()
    const room = new Room({ code: '111111', commonWords: () => WORDS, clock })
    const h = new Client(room, 'only-host-token-123456')
    expect(h.view.hostId).toBe(h.id)
    expect(h.view.blocker).toMatch(/нет капитана/)
    h.send({ t: 'start' })
    expect(h.lastError).toMatchObject({ code: 'cannot_start' })
  })

  it('чужая версия протокола — отказ', () => {
    const room = new Room({ code: '111111', commonWords: () => WORDS, clock: new FakeClock() })
    const c = new Client(room, 'x')
    const bad = room.attach(c.link)
    bad.receive({ t: 'hello', v: 999, name: 'x', color: '#000000', avatar: null, token: 'zzzzzzzzzzzzzzzzzz', appVersion: '1' })
    expect(c.inbox.at(-1)).toMatchObject({ t: 'reject', reason: 'version' })
  })

  it('ключ видят только капитаны, после конца — все', () => {
    const { host, a2, t1, t2 } = started()
    const hidden = (c: Client) => c.view.game!.cards.filter((x) => x.color === null).length
    expect(hidden(host)).toBe(0)
    expect(hidden(t1)).toBe(0)
    expect(hidden(a2)).toBe(25)
    expect(hidden(t2)).toBe(25)
    // в сырых сообщениям отгадчика нет ни одного цвета, кроме открытых
    const raw = JSON.stringify(a2.inbox)
    expect(raw).not.toMatch(/"color":"trap"/)
  })

  it('полный ход: подсказка, метка, открытие, передача хода', () => {
    const { host, a2, t2 } = started()
    const g = host.view.game!
    expect(g.turn).toBe('amber') // при этом зерне начинают янтарные
    host.send({ t: 'clue', word: 'зверь', count: 1 })
    expect(a2.view.game!.phase).toBe('guess')
    t2.send({ t: 'reveal', index: 0 })
    expect(t2.lastError).toMatchObject({ code: 'not_your_turn' })
    const mine = host.view.game!.cards.findIndex((c) => c.color === 'amber')
    a2.send({ t: 'mark', index: mine })
    expect(host.view.game!.marks[mine]).toEqual([a2.id])
    a2.send({ t: 'reveal', index: mine })
    const neutral = host.view.game!.cards.findIndex((c) => c.color === 'neutral' && !c.revealed)
    a2.send({ t: 'reveal', index: neutral })
    expect(a2.view.game!.turn).toBe('teal')
    expect(a2.view.game!.cards[neutral]!.color).toBe('neutral')
    expect(a2.inbox.some((m) => m.t === 'view' && m.events?.some((e) => e.e === 'turn'))).toBe(true)
  })

  it('провал завершает партию и даёт очко соперникам', () => {
    const { host, a2 } = started()
    host.send({ t: 'clue', word: 'зверь', count: 2 })
    const trap = host.view.game!.cards.findIndex((c) => c.color === 'trap')
    a2.send({ t: 'reveal', index: trap })
    expect(a2.view.stage).toBe('over')
    expect(a2.view.score.teal).toBe(1)
    expect(a2.view.game!.cards.every((c) => c.color !== null)).toBe(true)
    host.send({ t: 'start' })
    expect(host.view.stage).toBe('play')
    expect(host.view.score.teal).toBe(1)
  })

  it('отгадчик не может стать капитаном посреди партии, капитан не уходит из капитанов', () => {
    const { host, a2 } = started()
    a2.send({ t: 'seat', team: 'amber', captain: true })
    expect(a2.lastError).toMatchObject({ code: 'captain_taken' })
    host.send({ t: 'seat', team: 'amber', captain: false })
    expect(host.lastError).toMatchObject({ code: 'captain_locked' })
  })

  it('переподключение по токену сохраняет место', () => {
    const { room, a2, tk } = started()
    a2.session.detach()
    expect(a2.view.players.find((p) => p.id === a2.id)).toBeTruthy()
    const back = new Client(room, tk('a2'))
    expect(back.id).toBe(a2.id)
    expect(back.view.players.find((p) => p.id === a2.id)!.team).toBe('amber')
  })

  it('хост пропал — права переходят через паузу; вернулся раньше — остаются', () => {
    const { room, clock, host, a2, tk } = setup()
    host.session.detach()
    clock.advance(ROOM_LIMITS.hostGraceMs - 1000)
    expect(a2.view.hostId).toBe(host.id)
    const back = new Client(room, tk('host'))
    clock.advance(5000)
    expect(back.view.hostId).toBe(host.id)
    back.session.detach()
    clock.advance(ROOM_LIMITS.hostGraceMs + 1)
    expect(a2.view.hostId).toBe(a2.id)
  })

  it('кик закрывает вход по тому же токену', () => {
    const { room, host, t2, tk } = setup()
    host.send({ t: 'kick', id: t2.id })
    expect(t2.inbox.at(-1)).toMatchObject({ t: 'reject', reason: 'kicked' })
    const again = new Client(room, tk('t2'))
    expect(again.inbox.at(-1)).toMatchObject({ t: 'reject', reason: 'kicked' })
  })

  it('не хост не управляет комнатой', () => {
    const { a2 } = setup()
    a2.send({ t: 'start' })
    expect(a2.lastError).toMatchObject({ code: 'not_host' })
  })

  it('таймер подсказки передаёт ход', () => {
    const { host, clock } = setup()
    host.send({ t: 'settings', settings: { source: 'common', clueSeconds: 30, guessSeconds: 0 } })
    host.send({ t: 'start' })
    const first = host.view.game!.turn
    expect(host.view.game!.deadline).toBe(clock.t + 30_000)
    clock.advance(30_001)
    expect(host.view.game!.turn).not.toBe(first)
  })

  it('свои слова: валидация, дубли, минимум 25', () => {
    const { host } = setup()
    host.send({ t: 'words', words: ['кот', 'Кот', 'КОТ', 'x', 'мем 2026', ...Array.from({ length: 10 }, (_, i) => `слово${i}`)] })
    expect(host.view.customWords).toBe(12)
    host.send({ t: 'settings', settings: { source: 'custom', clueSeconds: 0, guessSeconds: 0 } })
    expect(host.view.blocker).toMatch(/25/)
    host.send({ t: 'settings', settings: { source: 'mix', clueSeconds: 0, guessSeconds: 0 } })
    expect(host.view.blocker).toBeNull()
    host.send({ t: 'start' })
    const ws = host.view.game!.cards.map((c) => c.word)
    expect(ws.filter((w) => w === 'КОТ' || w === 'МЕМ 2026' || w.startsWith('СЛОВО') && /\d/.test(w)).length).toBeGreaterThan(0)
  })

  it('снимок и восстановление', () => {
    const { room, host, a2, tk } = started()
    host.send({ t: 'clue', word: 'зверь', count: 2 })
    const snap = JSON.parse(JSON.stringify(room.snapshot()))
    const clock = new FakeClock()
    const restored = new Room({ code: '123456', commonWords: () => WORDS, clock }, snap)
    const back = new Client(restored, tk('a2'))
    expect(back.id).toBe(a2.id)
    expect(back.view.game!.phase).toBe('guess')
    expect(back.view.hostId).toBe(host.id)
    expect(back.view.game!.cards.filter((c) => c.color === null).length).toBe(25)
  })
})

describe('словарь', () => {
  it('стартовые слова, предложение, дубли, модерация', () => {
    let t = 1000
    const w = openWords(':memory:', { now: () => t })
    expect(w.seed(['кот', 'Ёж', 'два слова', 'кот'])).toBe(2)
    expect(w.approved().sort()).toEqual(['ЕЖ', 'КОТ'])
    const r = w.propose(['пёс', 'кот', 'abc', 'пес'], ['ip:1'])
    expect(r.map((x) => x.result)).toEqual(['queued', 'exists', 'invalid', 'pending'])
    const q = w.queue()
    expect(q).toHaveLength(1)
    expect(w.takeUnnotified()).toHaveLength(1)
    w.markNotified(q[0]!.id)
    expect(w.takeUnnotified()).toHaveLength(0)
    w.decide(q[0]!.id, true)
    expect(w.approved()).toContain('ПЕС')
    expect(w.propose(['пес'], ['ip:2'])[0]!.result).toBe('exists')
    w.set('кот', false)
    expect(w.approved()).not.toContain('КОТ')
    t += 1
  })

  it('лимит в сутки по любому из ключей', () => {
    let t = 0
    const w = openWords(':memory:', { now: () => t })
    const words = Array.from({ length: 10 }, (_, i) => `слово${'абвгдежзик'[i]}`)
    w.propose(words, ['ip:1', 'p:a'])
    w.propose(words.map((x) => x + 'а'), ['ip:2', 'p:a'])
    const r = w.propose(['новое'], ['ip:3', 'p:a'])
    expect(r[0]!.result).toBe('limit')
    t += 25 * 3600_000
    expect(w.propose(['новое'], ['ip:3', 'p:a'])[0]!.result).toBe('queued')
  })
})
