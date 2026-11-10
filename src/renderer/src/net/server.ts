import type { ClientMessage, ClientTransport, ServerMessage } from '../../../protocol/index.ts'

/** Сервер на russia. Для разработки: ?server=http://127.0.0.1:8787 или localStorage namek.server. */
export const SERVER_URL = (() => {
  if (typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search).get('server')
    if (q) return q.replace(/\/$/, '')
    try {
      const saved = localStorage.getItem('namek.server')
      if (saved) return saved.replace(/\/$/, '')
    } catch {
      // нет хранилища: берём боевой адрес
    }
  }
  return 'https://namek.wkiseven.me'
})()

const WS_URL = SERVER_URL.replace(/^http/, 'ws') + '/ws'

export class NotFoundError extends Error {}
export class ServerUnreachableError extends Error {}
export class BusyError extends Error {}

/**
 * create — новая комната; code — войти в существующую. hello уходит сразу при открытии,
 * а вход считается удачным только по первому ответу сервера: комнату, которой нет,
 * сервер закрывает кодом 4404 уже после открытия сокета.
 */
export function connect(
  target: { create: true } | { code: string },
  hello: ClientMessage,
  timeoutMs = 10_000,
): Promise<{ transport: ClientTransport; first: ServerMessage }> {
  return new Promise((resolve, reject) => {
    const url = 'create' in target ? `${WS_URL}?create=1` : `${WS_URL}?code=${encodeURIComponent(target.code)}`
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      reject(new ServerUnreachableError('bad url'))
      return
    }
    let ready = false
    const timer = setTimeout(() => {
      if (ready) return
      ws.close()
      reject(new ServerUnreachableError('timeout'))
    }, timeoutMs)

    const transport: ClientTransport = {
      onMessage: null,
      onClose: null,
      send(msg: ClientMessage) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
      },
      close() {
        ws.close(1000)
      },
    }
    ws.onopen = () => ws.send(JSON.stringify(hello))
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      let msg: ServerMessage
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (!ready) {
        ready = true
        clearTimeout(timer)
        resolve({ transport, first: msg })
        return
      }
      transport.onMessage?.(msg)
    }
    ws.onclose = (ev) => {
      if (ready) {
        transport.onClose?.()
        return
      }
      clearTimeout(timer)
      if (ev.code === 4404) reject(new NotFoundError('not found'))
      else if (ev.code === 4503 || ev.code === 4429) reject(new BusyError('busy'))
      else reject(new ServerUnreachableError(`closed ${ev.code}`))
    }
  })
}

export type ProposeResult = 'queued' | 'exists' | 'pending' | 'rejected' | 'invalid' | 'limit'

export async function proposeWords(words: string[], profile: string): Promise<{ word: string; result: ProposeResult }[]> {
  const res = await fetch(`${SERVER_URL}/api/words`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ words, profile }),
  })
  if (res.status === 429) throw new BusyError('slow down')
  if (!res.ok) throw new ServerUnreachableError(String(res.status))
  return ((await res.json()) as { results: { word: string; result: ProposeResult }[] }).results
}
