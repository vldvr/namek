import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ClientTransport,
  type HelloMessage,
  type RejectReason,
  type RoomEvent,
  type RoomView,
  type ServerMessage,
} from '../protocol/index.ts'

export interface SessionHandlers {
  onWelcome(you: string, view: RoomView, avatars: Record<string, string>): void
  onView(view: RoomView, events: RoomEvent[]): void
  onAvatar(id: string, avatar: string | null): void
  onReject(reason: RejectReason): void
  onError(code: string): void
  /** Транспорт закрылся не по нашей воле. */
  onDrop(): void
}

export type Profile = Omit<HelloMessage, 't' | 'v'>

const PING_MS = 5000

/** Протокол клиента поверх транспорта. Переподключение решает вызывающий. */
export class GameSession {
  private transport: ClientTransport | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private rtt: number | null = null
  private closing = false
  private profile: Profile
  private h: SessionHandlers

  constructor(profile: Profile, h: SessionHandlers) {
    this.profile = profile
    this.h = h
  }

  /** hello уже ушёл при подключении, first — первый ответ сервера. */
  attach(t: ClientTransport, first: ServerMessage) {
    this.detach()
    this.closing = false
    this.transport = t
    t.onMessage = (msg) => this.receive(msg)
    t.onClose = () => {
      if (this.transport !== t) return
      this.stopPing()
      this.transport = null
      if (!this.closing) this.h.onDrop()
    }
    this.pingTimer = setInterval(() => this.send({ t: 'ping', ts: Date.now(), rtt: this.rtt }), PING_MS)
    this.receive(first)
  }

  hello(): ClientMessage {
    return { t: 'hello', v: PROTOCOL_VERSION, ...this.profile }
  }

  setProfile(p: Profile) {
    this.profile = p
  }

  updateProfile(p: Pick<Profile, 'name' | 'color' | 'avatar'>) {
    this.profile = { ...this.profile, ...p }
    this.send({ t: 'profile', name: p.name, color: p.color, avatar: p.avatar })
  }

  get connected() {
    return this.transport !== null
  }

  get latency() {
    return this.rtt
  }

  send(msg: ClientMessage) {
    this.transport?.send(msg)
  }

  /** Сознательно закрываем: без onDrop. */
  close() {
    this.closing = true
    this.detach()
  }

  private detach() {
    this.stopPing()
    const t = this.transport
    this.transport = null
    if (t) {
      t.onClose = null
      t.onMessage = null
      t.close()
    }
  }

  private stopPing() {
    if (this.pingTimer !== null) clearInterval(this.pingTimer)
    this.pingTimer = null
  }

  private receive(msg: ServerMessage) {
    switch (msg.t) {
      case 'welcome':
        return this.h.onWelcome(msg.you, msg.view, msg.avatars)
      case 'view':
        return this.h.onView(msg.view, msg.events ?? [])
      case 'avatar':
        return this.h.onAvatar(msg.id, msg.avatar)
      case 'reject':
        this.closing = true
        return this.h.onReject(msg.reason)
      case 'error':
        return this.h.onError(msg.code)
      case 'pong':
        this.rtt = Math.max(0, Date.now() - msg.ts)
        return
    }
  }
}
