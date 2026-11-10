// Сервер «Намёка»: комнаты по шестизначному коду, партия считается здесь (room.ts),
// общий словарь с предложениями игроков (words.ts) и API для бота модерации.
//
// WS  /ws?create=1           — новая комната, код придёт во view
// WS  /ws?code=123456        — войти в комнату (4404 — нет такой)
// POST /api/words            {words: string[], profile?: string} → {results}
// GET  /api/mod/queue         заголовок x-mod-key; ?fresh=1 — только ещё не показанные
// POST /api/mod/notified     {ids: number[]}
// POST /api/mod/decide       {id, approve}
// POST /api/mod/set          {word, approve}
// GET  /api/mod/stats
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { timingSafeEqual, randomInt } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import { Room, type RoomSnapshot, type Clock } from './room.ts'
import { openWords } from './words.ts'

export const LIMITS = {
  rooms: 500,
  maxPayload: 96 * 1024,
  rate: 30,
  burst: 80,
  pingMs: 25_000,
  missesPerWindow: 12,
  missWindowMs: 60_000,
  missBlockMs: 60_000,
  createsPerMinute: 10,
  apiPerMinute: 30,
  apiBody: 8 * 1024,
}

const CLOSE = { notFound: 4404, full: 4413, badRequest: 4400, tooFast: 4429, busy: 4503 }

export interface ServerOptions {
  port?: number
  host?: string
  trustProxy?: boolean
  db?: string
  seedFile?: string | null
  roomsFile?: string | null
  modKey?: string | null
  clock?: Clock
  log?: (s: string) => void
}

type Ws = WebSocket & { isAlive?: boolean }

export async function createGameServer(o: ServerOptions = {}) {
  const log = o.log ?? console.log
  const words = openWords(o.db ?? ':memory:')
  if (o.seedFile && existsSync(o.seedFile)) {
    const added = words.seed(readFileSync(o.seedFile, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')))
    if (added) log(`seed: +${added} words`)
  }
  const rooms = new Map<string, Room>()

  const makeRoom = (code: string, snap?: RoomSnapshot) => {
    const room = new Room(
      {
        code,
        commonWords: words.approved,
        clock: o.clock,
        log,
        onEmpty: () => {
          if (rooms.get(code) !== room) return
          rooms.delete(code)
          room.dispose()
          log(`room ${code} closed (${rooms.size} rooms)`)
        },
      },
      snap,
    )
    rooms.set(code, room)
    return room
  }

  if (o.roomsFile && existsSync(o.roomsFile)) {
    try {
      const snaps = JSON.parse(readFileSync(o.roomsFile, 'utf8')) as RoomSnapshot[]
      for (const s of snaps) if (s.v === 1) makeRoom(s.code, s)
      log(`restored ${rooms.size} rooms`)
    } catch (err) {
      log(`rooms restore failed: ${err}`)
    }
  }

  const saveRooms = () => {
    if (!o.roomsFile) return
    const tmp = `${o.roomsFile}.tmp`
    writeFileSync(tmp, JSON.stringify([...rooms.values()].map((r) => r.snapshot())))
    renameSync(tmp, o.roomsFile)
  }

  const newCode = () => {
    for (let i = 0; i < 50; i++) {
      const c = String(randomInt(100000, 1000000))
      if (!rooms.has(c)) return c
    }
    return null
  }

  // ——— ограничения по адресу ———
  const ipOf = (req: IncomingMessage): string | null => {
    if (o.trustProxy) {
      const v = req.headers['x-real-ip']
      return typeof v === 'string' && v ? v : null
    }
    return req.socket.remoteAddress ?? null
  }
  const windows = new Map<string, { count: number; since: number; until: number }>()
  /** Считает событие kind для ip; true — превышено. */
  const hit = (kind: string, ip: string | null, max: number, windowMs = 60_000, blockMs = 0): boolean => {
    if (!ip) return false
    const key = `${kind}:${ip}`
    const t = Date.now()
    const w = windows.get(key) ?? { count: 0, since: t, until: 0 }
    if (w.until > t) return true
    if (t - w.since > windowMs) Object.assign(w, { count: 0, since: t })
    w.count++
    if (w.count > max && blockMs) w.until = t + blockMs
    windows.set(key, w)
    return w.count > max
  }
  const isBlocked = (ip: string | null) => {
    const w = ip ? windows.get(`miss:${ip}`) : undefined
    return !!w && w.until > Date.now()
  }

  // ——— HTTP ———
  const modOk = (req: IncomingMessage) => {
    const k = req.headers['x-mod-key']
    if (!o.modKey || typeof k !== 'string') return false
    const a = Buffer.from(k)
    const b = Buffer.from(o.modKey)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  async function body(req: IncomingMessage): Promise<Record<string, unknown> | null> {
    let raw = ''
    for await (const chunk of req) {
      raw += chunk
      if (raw.length > LIMITS.apiBody) return null
    }
    try {
      const v = JSON.parse(raw)
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null
    } catch {
      return null
    }
  }

  async function api(req: IncomingMessage, res: ServerResponse, path: string) {
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
    }
    const reply = (status: number, b: unknown) => {
      res.writeHead(status, headers)
      res.end(JSON.stringify(b))
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...headers, 'access-control-allow-methods': 'GET, POST' })
      return res.end()
    }
    const ip = ipOf(req)

    if (path === '/api/words' && req.method === 'POST') {
      if (hit('api', ip, LIMITS.apiPerMinute)) return reply(429, { error: 'slow down' })
      const b = await body(req)
      const list = b?.words
      if (!Array.isArray(list) || !list.every((w) => typeof w === 'string' && w.length <= 40)) return reply(400, { error: 'bad request' })
      const profile = typeof b?.profile === 'string' ? b.profile.slice(0, 64) : null
      const who = [ip ? `ip:${ip}` : null, profile ? `p:${profile}` : null].filter((x): x is string => !!x)
      return reply(200, { results: words.propose(list as string[], who.length ? who : ['anon']) })
    }

    if (path.startsWith('/api/mod/')) {
      if (!modOk(req)) {
        hit('miss', ip, LIMITS.missesPerWindow, LIMITS.missWindowMs, LIMITS.missBlockMs)
        return reply(403, { error: 'forbidden' })
      }
      const url = new URL(req.url ?? '/', 'http://x')
      if (path === '/api/mod/queue' && req.method === 'GET') {
        return reply(200, { words: url.searchParams.get('fresh') ? words.takeUnnotified(20) : words.queue(50) })
      }
      if (path === '/api/mod/stats' && req.method === 'GET') return reply(200, { stats: words.stats(), rooms: rooms.size })
      const b = await body(req)
      if (!b) return reply(400, { error: 'bad json' })
      if (path === '/api/mod/notified' && req.method === 'POST') {
        for (const id of Array.isArray(b.ids) ? b.ids : []) if (Number.isInteger(id)) words.markNotified(id as number)
        return reply(200, { ok: true })
      }
      if (path === '/api/mod/decide' && req.method === 'POST') {
        if (!Number.isInteger(b.id) || typeof b.approve !== 'boolean') return reply(400, { error: 'bad request' })
        const row = words.decide(b.id as number, b.approve)
        return row ? reply(200, { word: row }) : reply(404, { error: 'not found' })
      }
      if (path === '/api/mod/set' && req.method === 'POST') {
        if (typeof b.word !== 'string' || typeof b.approve !== 'boolean') return reply(400, { error: 'bad request' })
        const w = words.set(b.word, b.approve)
        return w ? reply(200, { word: w }) : reply(400, { error: 'invalid word' })
      }
    }
    return reply(404, { error: 'not found' })
  }

  const http = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!
    if (path.startsWith('/api/')) {
      api(req, res, path).catch((err) => {
        log(`api ${path}: ${err?.stack ?? err}`)
        if (!res.headersSent) res.writeHead(500)
        res.end()
      })
      return
    }
    if (path === '/health') {
      let online = 0
      for (const r of rooms.values()) online += r.online
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, rooms: rooms.size, online, words: words.approved().length }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Намёк: сервер комнат. Скачать игру: https://github.com/vldvr/namek/releases\n')
  })

  // ——— WebSocket ———
  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.maxPayload, perMessageDeflate: false })

  http.on('upgrade', (req, socket, head) => {
    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://x')
    } catch {
      return socket.destroy()
    }
    if (url.pathname !== '/ws') return socket.destroy()
    const ip = ipOf(req)
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws as Ws, url.searchParams, ip))
  })

  function onConnection(ws: Ws, params: URLSearchParams, ip: string | null) {
    ws.isAlive = true
    ws.on('pong', () => (ws.isAlive = true))
    let room: Room | undefined
    if (params.get('create') === '1') {
      if (hit('create', ip, LIMITS.createsPerMinute)) return ws.close(CLOSE.tooFast, 'too many rooms')
      const code = rooms.size < LIMITS.rooms ? newCode() : null
      if (!code) return ws.close(CLOSE.busy, 'busy')
      room = makeRoom(code)
      log(`room ${code} created (${rooms.size} rooms)`)
    } else {
      const code = params.get('code') ?? ''
      if (!/^\d{6}$/.test(code)) return ws.close(CLOSE.badRequest, 'bad code')
      if (isBlocked(ip)) return ws.close(CLOSE.tooFast, 'slow down')
      room = rooms.get(code)
      if (!room) {
        hit('miss', ip, LIMITS.missesPerWindow, LIMITS.missWindowMs, LIMITS.missBlockMs)
        return ws.close(CLOSE.notFound, 'no room')
      }
    }

    let tokens = LIMITS.burst
    let last = Date.now()
    const session = room.attach({
      send: (m) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m))
      },
      close: () => ws.close(1000),
    })
    ws.on('message', (data, isBinary) => {
      const t = Date.now()
      tokens = Math.min(LIMITS.burst, tokens + ((t - last) / 1000) * LIMITS.rate)
      last = t
      if (tokens < 1) return ws.close(CLOSE.tooFast, 'too fast')
      tokens--
      if (isBinary) return
      let msg: unknown
      try {
        msg = JSON.parse(data.toString())
      } catch {
        return
      }
      session.receive(msg)
    })
    ws.on('close', () => session.detach())
    ws.on('error', () => {})
  }

  const heartbeat = setInterval(() => {
    const t = Date.now()
    for (const [k, w] of windows) if (w.until < t && t - w.since > 10 * 60_000) windows.delete(k)
    for (const c of wss.clients as Set<Ws>) {
      if (!c.isAlive) {
        c.terminate()
        continue
      }
      c.isAlive = false
      c.ping()
    }
  }, LIMITS.pingMs)
  const saver = setInterval(() => {
    try {
      saveRooms()
    } catch (err) {
      log(`save rooms: ${err}`)
    }
  }, 60_000)
  saver.unref()

  return new Promise<{ port: number; rooms: Map<string, Room>; words: typeof words; close(): Promise<void> }>((resolve) => {
    http.listen(o.port ?? 8080, o.host ?? '0.0.0.0', () => {
      const addr = http.address()
      resolve({
        port: typeof addr === 'object' && addr ? addr.port : 0,
        rooms,
        words,
        close: () =>
          new Promise<void>((r) => {
            clearInterval(heartbeat)
            clearInterval(saver)
            try {
              saveRooms()
            } catch (err) {
              log(`save rooms: ${err}`)
            }
            for (const room of rooms.values()) room.dispose()
            for (const c of wss.clients) c.terminate()
            wss.close()
            words.close()
            http.close(() => r())
          }),
      })
    })
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = new URL('.', import.meta.url).pathname
  const server = await createGameServer({
    port: Number(process.env.PORT ?? 8787),
    trustProxy: process.env.TRUST_PROXY === '1',
    db: process.env.DB_FILE ?? `${dir}namek.db`,
    roomsFile: process.env.ROOMS_FILE ?? `${dir}rooms.json`,
    seedFile: process.env.SEED_FILE ?? `${dir}seed-words.txt`,
    modKey: process.env.MOD_KEY || null,
  })
  console.log(`namek server on :${server.port}, ${server.words.approved().length} words`)
  const stop = async () => {
    await server.close()
    process.exit(0)
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}
