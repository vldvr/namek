// Комната «Намёка»: участники, команды и партия. Сервер авторитетен — правила считаются здесь,
// клиенту уходит только его вид (ключ цветов видят лишь капитаны). Транспорт не важен:
// attach(link) подключает любое соединение, тесты гоняют комнату без сети.
import {
  GameError, UNLIMITED, cryptoRandomInt, customWord, giveClue, guess, endTurn, newGame, other,
  remaining, timeout, type GameState, type RandomInt, type Team,
} from '../src/engine/index.ts'
import {
  DEFAULT_SETTINGS, LIMITS, PROTOCOL_VERSION, parseClientMessage,
  type ClientMessage, type GameView, type RoomEvent, type RoomSettings, type RoomView, type ServerMessage,
} from '../src/protocol/index.ts'

export const ROOM_LIMITS = {
  members: 24,
  /** Хост пропал: через столько права переходят другому. */
  hostGraceMs: 20_000,
  /** Никого нет онлайн столько времени — комнату закрываем. */
  emptyTtlMs: 30 * 60_000,
}

export interface Link {
  send(msg: ServerMessage): void
  close(): void
}

export interface Session {
  receive(raw: unknown): void
  detach(): void
}

export interface Clock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(h: unknown): void
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

interface Member {
  id: string
  token: string
  name: string
  color: string
  avatar: string | null
  team: Team | null
  captain: boolean
  link: Link | null
  joinedAt: number
}

export interface RoomDeps {
  code: string
  /** Одобренные слова общего словаря. */
  commonWords: () => string[]
  clock?: Clock
  rnd?: RandomInt
  /** Комната опустела надолго — её можно удалить. */
  onEmpty?: () => void
  log?: (s: string) => void
}

export interface RoomSnapshot {
  v: 1
  code: string
  hostId: string | null
  nextId: number
  members: Omit<Member, 'link'>[]
  banned: string[]
  settings: RoomSettings
  customWords: string[]
  stage: RoomView['stage']
  game: GameState | null
  score: Record<Team, number>
  marks: Record<number, string[]>
  keySeen?: string[]
}

export class Room {
  readonly code: string
  private members = new Map<string, Member>()
  private banned = new Set<string>()
  private hostId: string | null = null
  private nextId = 1
  private settings: RoomSettings = { ...DEFAULT_SETTINGS }
  private customWords: string[] = []
  private stage: RoomView['stage'] = 'lobby'
  private game: GameState | null = null
  private score: Record<Team, number> = { amber: 0, teal: 0 }
  private marks = new Map<number, Set<string>>()
  /** Токены тех, кто в этой партии видел ключ: отгадчиками до конца партии им нельзя. */
  private keySeen = new Set<string>()
  private deadline: number | null = null
  private phaseTimer: unknown = null
  private hostTimer: unknown = null
  private emptyTimer: unknown = null
  private clock: Clock
  private rnd: RandomInt
  private log: (s: string) => void

  private deps: RoomDeps

  constructor(deps: RoomDeps, snap?: RoomSnapshot) {
    this.deps = deps
    this.code = deps.code
    this.clock = deps.clock ?? realClock
    this.rnd = deps.rnd ?? cryptoRandomInt
    this.log = deps.log ?? (() => {})
    if (snap) this.restore(snap)
    this.armEmpty()
  }

  get online(): number {
    let n = 0
    for (const m of this.members.values()) if (m.link) n++
    return n
  }

  get size(): number {
    return this.members.size
  }

  attach(link: Link): Session {
    let me: Member | null = null
    const session: Session = {
      receive: (raw) => {
        const msg = parseClientMessage(raw)
        if (!msg) return link.send({ t: 'error', code: 'bad_message' })
        if (!me) {
          if (msg.t !== 'hello') return
          me = this.hello(link, msg)
          return
        }
        if (me.link !== link) return // соединение уже заменено новым
        this.handle(me, msg, link)
      },
      detach: () => {
        if (me && me.link === link) this.drop(me)
      },
    }
    return session
  }

  // ——— вход и выход ———

  private hello(link: Link, msg: Extract<ClientMessage, { t: 'hello' }>): Member | null {
    if (msg.v !== PROTOCOL_VERSION) {
      link.send({ t: 'reject', reason: 'version', serverVersion: PROTOCOL_VERSION })
      link.close()
      return null
    }
    if (this.banned.has(msg.token)) {
      link.send({ t: 'reject', reason: 'kicked' })
      link.close()
      return null
    }
    let m = [...this.members.values()].find((x) => x.token === msg.token) ?? null
    if (m) {
      // Тот же игрок вернулся (или открыл вторую вкладку): старое соединение закрываем.
      const old = m.link
      m.link = link
      if (old) old.close()
    } else {
      if (this.members.size >= ROOM_LIMITS.members) {
        link.send({ t: 'reject', reason: 'full' })
        link.close()
        return null
      }
      m = {
        id: `p${this.nextId++}`,
        token: msg.token,
        name: msg.name.trim().slice(0, LIMITS.name) || 'Игрок',
        color: msg.color,
        avatar: msg.avatar,
        team: null,
        captain: false,
        link,
        joinedAt: this.clock.now(),
      }
      this.members.set(m.id, m)
    }
    m.name = msg.name.trim() || m.name
    m.color = msg.color
    const avatarChanged = m.avatar !== msg.avatar
    m.avatar = msg.avatar
    if (!this.hostId || !this.members.has(this.hostId)) this.hostId = m.id
    if (this.hostId === m.id && this.hostTimer !== null) {
      this.clock.clearTimeout(this.hostTimer)
      this.hostTimer = null
    }
    if (this.emptyTimer !== null) {
      this.clock.clearTimeout(this.emptyTimer)
      this.emptyTimer = null
    }
    const avatars: Record<string, string> = {}
    for (const x of this.members.values()) if (x.avatar) avatars[x.id] = x.avatar
    link.send({ t: 'welcome', you: m.id, view: this.viewFor(m), avatars })
    if (avatarChanged) this.sendAll({ t: 'avatar', id: m.id, avatar: m.avatar }, m)
    this.broadcast([{ e: 'join', id: m.id }], m)
    return m
  }

  private drop(m: Member) {
    m.link = null
    if (m.id === this.hostId && this.hostTimer === null) {
      this.hostTimer = this.clock.setTimeout(() => {
        this.hostTimer = null
        const cur = this.hostId ? this.members.get(this.hostId) : null
        if (cur?.link) return
        this.passHost()
      }, ROOM_LIMITS.hostGraceMs)
    }
    this.broadcast([{ e: 'leave', id: m.id }])
    this.armEmpty()
  }

  private remove(m: Member) {
    this.members.delete(m.id)
    for (const s of this.marks.values()) s.delete(m.id)
    if (m.id === this.hostId) this.passHost()
    this.sendAll({ t: 'avatar', id: m.id, avatar: null })
    this.broadcast([{ e: 'leave', id: m.id }])
    this.armEmpty()
  }

  private passHost() {
    const next = [...this.members.values()].filter((x) => x.link).sort((a, b) => a.joinedAt - b.joinedAt)[0]
    this.hostId = next?.id ?? [...this.members.keys()][0] ?? null
    this.broadcast()
  }

  private armEmpty() {
    if (this.online > 0 || this.emptyTimer !== null) return
    this.emptyTimer = this.clock.setTimeout(() => {
      this.emptyTimer = null
      if (this.online === 0) this.deps.onEmpty?.()
    }, ROOM_LIMITS.emptyTtlMs)
  }

  /** Сервер выключается: всех предупреждать не нужно, клиенты переподключатся сами. */
  dispose() {
    for (const t of [this.phaseTimer, this.hostTimer, this.emptyTimer]) if (t !== null) this.clock.clearTimeout(t)
    this.phaseTimer = this.hostTimer = this.emptyTimer = null
    for (const m of this.members.values()) {
      const l = m.link
      m.link = null
      l?.close()
    }
  }

  // ——— сообщения ———

  private handle(me: Member, msg: ClientMessage, link: Link) {
    const isHost = me.id === this.hostId
    const fail = (code: string) => link.send({ t: 'error', code })
    try {
      switch (msg.t) {
        case 'hello':
          return
        case 'ping':
          return link.send({ t: 'pong', ts: msg.ts })
        case 'profile': {
          me.name = msg.name.trim() || me.name
          me.color = msg.color
          if (me.avatar !== msg.avatar) {
            me.avatar = msg.avatar
            this.sendAll({ t: 'avatar', id: me.id, avatar: me.avatar })
          }
          return this.broadcast()
        }
        case 'seat': {
          const err = this.seat(me, msg.team, msg.captain, false)
          return err ? fail(err) : this.broadcast()
        }
        case 'move': {
          if (!isHost) return fail('not_host')
          const who = this.members.get(msg.id)
          if (!who) return fail('no_player')
          const err = this.seat(who, msg.team, msg.captain, true)
          return err ? fail(err) : this.broadcast()
        }
        case 'shuffle': {
          if (!isHost) return fail('not_host')
          if (this.stage === 'play') return fail('in_game')
          this.shuffleTeams()
          return this.broadcast()
        }
        case 'settings': {
          if (!isHost) return fail('not_host')
          this.settings = { ...msg.settings }
          if (this.stage === 'play') this.armPhase() // новый таймер вступает с текущей фазы
          return this.broadcast()
        }
        case 'words': {
          if (!isHost) return fail('not_host')
          const seen = new Set<string>()
          for (const w of msg.words) {
            const n = customWord(w)
            if (n) seen.add(n)
          }
          this.customWords = [...seen].slice(0, LIMITS.customWords)
          return this.broadcast()
        }
        case 'start': {
          if (!isHost) return fail('not_host')
          if (this.stage === 'play') return fail('in_game')
          const blocker = this.blocker()
          if (blocker) return fail('cannot_start')
          return this.start()
        }
        case 'lobby': {
          if (!isHost) return fail('not_host')
          this.stage = 'lobby'
          this.game = null
          this.keySeen.clear()
          this.marks.clear()
          this.clearPhase()
          return this.broadcast()
        }
        case 'kick': {
          if (!isHost) return fail('not_host')
          const who = this.members.get(msg.id)
          if (!who || who === me) return fail('no_player')
          this.banned.add(who.token)
          const l = who.link
          who.link = null
          l?.send({ t: 'reject', reason: 'kicked' })
          l?.close()
          return this.remove(who)
        }
        case 'leave': {
          me.link = null
          link.close()
          return this.remove(me)
        }
        case 'clue': {
          const g = this.playing()
          if (!g || !me.captain || me.team !== g.turn) return fail('not_your_turn')
          const c = giveClue(g, me.team, msg.word, msg.count)
          this.marks.clear()
          this.armPhase()
          return this.broadcast([{ e: 'clue', team: c.team, word: c.word, count: c.count }])
        }
        case 'mark': {
          const g = this.playing()
          if (!g || g.phase !== 'guess' || me.captain || me.team !== g.turn) return fail('not_your_turn')
          if (g.cards[msg.index]?.revealed) return fail('already_revealed')
          const s = this.marks.get(msg.index) ?? new Set<string>()
          if (s.has(me.id)) s.delete(me.id)
          else s.add(me.id)
          if (s.size) this.marks.set(msg.index, s)
          else this.marks.delete(msg.index)
          return this.broadcast()
        }
        case 'reveal': {
          const g = this.playing()
          if (!g || g.phase !== 'guess' || me.captain || me.team !== g.turn) return fail('not_your_turn')
          const team = me.team
          const r = guess(g, team, msg.index)
          this.marks.delete(msg.index)
          const events: RoomEvent[] = [{ e: 'reveal', index: msg.index, by: me.id, color: r.color }]
          if (r.winner) events.push(...this.finish())
          else if (r.turnEnded) {
            this.marks.clear()
            this.armPhase()
            events.push({ e: 'turn', team: g.turn, reason: r.color === team ? 'limit' : 'miss' })
          }
          return this.broadcast(events)
        }
        case 'pass': {
          const g = this.playing()
          if (!g || me.captain || me.team !== g.turn) return fail('not_your_turn')
          endTurn(g, me.team)
          this.marks.clear()
          this.armPhase()
          return this.broadcast([{ e: 'turn', team: g.turn, reason: 'pass' }])
        }
      }
    } catch (err) {
      if (err instanceof GameError) return fail(err.code)
      this.log(`room ${this.code}: ${err instanceof Error ? err.stack : err}`)
      fail('server')
    }
  }

  private playing(): GameState | null {
    return this.stage === 'play' && this.game && this.game.phase !== 'over' ? this.game : null
  }

  /** Пересадка. Во время партии: зритель может стать отгадчиком; капитаном — только если места нет. */
  private seat(m: Member, team: Team | null, captain: boolean, byHost: boolean): string | null {
    if (team === null) captain = false
    if (this.stage === 'play') {
      if ((m.captain || this.keySeen.has(m.token)) && !(team === m.team && captain)) return 'captain_locked' // видел ключ
      if (m.team && team !== m.team && !byHost) return 'in_game'
      if (captain && team && this.captainOf(team) && this.captainOf(team) !== m) return 'captain_taken'
    } else if (captain && team) {
      const cur = this.captainOf(team)
      if (cur && cur !== m) cur.captain = false
    }
    m.team = team
    m.captain = captain
    if (this.stage === 'play' && captain) this.keySeen.add(m.token)
    return null
  }

  private captainOf(team: Team): Member | undefined {
    return [...this.members.values()].find((x) => x.team === team && x.captain)
  }

  private shuffleTeams() {
    const ps = [...this.members.values()].filter((m) => m.team !== null || m.link)
    for (let i = ps.length - 1; i > 0; i--) {
      const j = this.rnd(i + 1)
      ;[ps[i], ps[j]] = [ps[j]!, ps[i]!]
    }
    const first: Team = this.rnd(2) ? 'amber' : 'teal'
    ps.forEach((m, i) => {
      m.team = i % 2 === 0 ? first : other(first)
      m.captain = i < 2
    })
  }

  private blocker(): string | null {
    for (const t of ['amber', 'teal'] as const) {
      const team = [...this.members.values()].filter((m) => m.team === t)
      const name = t === 'amber' ? 'янтарных' : 'бирюзовых'
      if (!team.some((m) => m.captain)) return `У ${name} нет капитана`
      if (!team.some((m) => !m.captain)) return `У ${name} нет отгадчика`
    }
    try {
      this.pool()
    } catch {
      return this.settings.source === 'custom' ? 'Нужно хотя бы 25 своих слов' : 'Мало слов в словаре'
    }
    return null
  }

  private pool(): string[] {
    const src = this.settings.source
    const words = src === 'custom' ? this.customWords : src === 'mix' ? [...this.customWords, ...this.deps.commonWords()] : this.deps.commonWords()
    if (new Set(words).size < LIMITS.minWords) throw new GameError('not_enough_words')
    if (src !== 'mix' || this.customWords.length === 0) return words
    // вперемешку: свои слова не тонут в большом словаре — примерно треть поля
    const own = this.customWords.slice()
    const common = this.deps.commonWords().filter((w) => !own.includes(w))
    const pick = (arr: string[], n: number) => {
      const a = arr.slice()
      for (let i = a.length - 1; i > 0; i--) {
        const j = this.rnd(i + 1)
        ;[a[i], a[j]] = [a[j]!, a[i]!]
      }
      return a.slice(0, n)
    }
    const nOwn = Math.min(own.length, 8)
    return [...pick(own, nOwn), ...pick(common, 25 - nOwn)]
  }

  private start() {
    this.game = newGame(this.pool(), this.rnd)
    this.stage = 'play'
    this.keySeen = new Set([...this.members.values()].filter((m) => m.captain).map((m) => m.token))
    this.marks.clear()
    this.armPhase()
    this.broadcast([{ e: 'start' }])
  }

  private finish(): RoomEvent[] {
    const g = this.game!
    this.stage = 'over'
    this.score[g.winner!]++
    this.clearPhase()
    this.marks.clear()
    return [{ e: 'over', winner: g.winner!, reason: g.endReason! }]
  }

  // ——— таймеры ———

  private clearPhase() {
    if (this.phaseTimer !== null) this.clock.clearTimeout(this.phaseTimer)
    this.phaseTimer = null
    this.deadline = null
  }

  private armPhase() {
    this.clearPhase()
    const g = this.playing()
    if (!g) return
    const sec = g.phase === 'clue' ? this.settings.clueSeconds : this.settings.guessSeconds
    if (!sec) return
    this.deadline = this.clock.now() + sec * 1000
    this.phaseTimer = this.clock.setTimeout(() => {
      this.phaseTimer = null
      const cur = this.playing()
      if (!cur) return
      timeout(cur)
      this.marks.clear()
      this.armPhase()
      this.broadcast([{ e: 'turn', team: cur.turn, reason: 'timeout' }])
    }, sec * 1000)
  }

  // ——— вид ———

  viewFor(m: Member | null): RoomView {
    const g = this.game
    let game: GameView | null = null
    if (g) {
      const seesKey = !!m?.captain && m.team !== null
      const over = g.phase === 'over'
      const marks: Record<number, string[]> = {}
      for (const [i, s] of this.marks) marks[i] = [...s]
      game = {
        cards: g.cards.map((c) => ({ word: c.word, revealed: c.revealed, color: c.revealed || over || seesKey ? c.color : null })),
        starting: g.starting,
        turn: g.turn,
        phase: g.phase,
        clues: g.clues,
        guessesLeft: g.guessesLeft === UNLIMITED ? -1 : g.guessesLeft,
        remaining: { amber: remaining(g, 'amber'), teal: remaining(g, 'teal') },
        winner: g.winner,
        endReason: g.endReason,
        marks,
        deadline: this.deadline,
      }
    }
    return {
      code: this.code,
      hostId: this.hostId ?? '',
      stage: this.stage,
      players: [...this.members.values()].map((x) => ({
        id: x.id, name: x.name, color: x.color, team: x.team, captain: x.captain, online: !!x.link,
      })),
      settings: this.settings,
      customWords: this.customWords.length,
      game,
      score: { ...this.score },
      blocker: this.stage === 'play' ? null : this.blocker(),
      serverNow: this.clock.now(),
    }
  }

  private broadcast(events?: RoomEvent[], except?: Member) {
    for (const m of this.members.values()) {
      if (!m.link || m === except) continue
      m.link.send(events?.length ? { t: 'view', view: this.viewFor(m), events } : { t: 'view', view: this.viewFor(m) })
    }
  }

  private sendAll(msg: ServerMessage, except?: Member) {
    for (const m of this.members.values()) if (m.link && m !== except) m.link.send(msg)
  }

  // ——— сохранение между перезапусками сервера ———

  snapshot(): RoomSnapshot {
    const marks: Record<number, string[]> = {}
    for (const [i, s] of this.marks) marks[i] = [...s]
    return {
      v: 1,
      code: this.code,
      hostId: this.hostId,
      nextId: this.nextId,
      members: [...this.members.values()].map(({ link: _l, ...rest }) => rest),
      banned: [...this.banned],
      settings: this.settings,
      customWords: this.customWords,
      stage: this.stage,
      game: this.game,
      score: this.score,
      marks,
      keySeen: [...this.keySeen],
    }
  }

  private restore(s: RoomSnapshot) {
    this.hostId = s.hostId
    this.nextId = s.nextId
    for (const m of s.members) this.members.set(m.id, { ...m, link: null })
    this.banned = new Set(s.banned)
    this.settings = { ...DEFAULT_SETTINGS, ...s.settings }
    this.customWords = s.customWords
    this.stage = s.stage
    this.game = s.game
    this.score = s.score
    for (const [i, ids] of Object.entries(s.marks)) this.marks.set(Number(i), new Set(ids))
    this.keySeen = new Set(s.keySeen ?? [])
    // таймер фазы после перезапуска начинаем заново — честнее, чем терять ход из-за выката
    this.armPhase()
  }
}
