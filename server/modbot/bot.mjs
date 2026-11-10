// Бот модерации слов «Намёка». Живёт отдельно от сервера игры.
// Раз в POLL_MS забирает у сервера игры новые предложенные слова и присылает их админу
// с кнопками «Принять / Отклонить». Команды: /queue, /stats, /add слово, /del слово.
//
// Переменные окружения:
//   TELEGRAM_BOT_TOKEN  токен бота из BotFather
//   ADMIN_CHAT_ID       кому слать и чьи нажатия принимать (остальных бот игнорирует)
//   MOD_KEY             тот же ключ, что в .env сервера игры
//   NAMEK_HOST          домен сервера игры, по умолчанию namek.wkiseven.me
//   NAMEK_VIA           необязательно: host:port, через который сначала ходить к серверу
//                       игры (TLS с SNI домена). Если он не отвечает, ходим напрямую.
//   NAMEK_HTTP          только для проверки: host:port локального сервера по http
import http from 'node:http'
import https from 'node:https'

const env = process.env
const TOKEN = env.TELEGRAM_BOT_TOKEN
const ADMIN = env.ADMIN_CHAT_ID
const KEY = env.MOD_KEY
const HOST = env.NAMEK_HOST || 'namek.wkiseven.me'
const VIA = env.NAMEK_VIA || ''
const POLL_MS = Number(env.POLL_MS || 30_000)
const PLAIN = env.NAMEK_HTTP || ''
const TG = env.TELEGRAM_API || 'https://api.telegram.org'

const log = (...a) => console.log(new Date().toISOString(), ...a)

// ——— сервер игры ———

function request({ host, port, path, method, body }) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const req = (PLAIN ? http : https).request(
      {
        host,
        port,
        servername: HOST,
        path,
        method,
        timeout: 15_000,
        headers: {
          host: HOST,
          'x-mod-key': KEY,
          ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let raw = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          let json = null
          try {
            json = JSON.parse(raw)
          } catch {
            // не json
          }
          if (res.statusCode >= 400) reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode, json }))
          else resolve(json)
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

/** Сначала через туннель, потом напрямую. Ошибки HTTP (403, 400) не повторяем. */
export async function game(path, method = 'GET', body) {
  const routes = []
  if (PLAIN) {
    const [h, p] = PLAIN.split(':')
    routes.push({ host: h, port: Number(p) })
  } else if (VIA) {
    const [h, p] = VIA.split(':')
    routes.push({ host: h, port: Number(p) })
  }
  if (!PLAIN) routes.push({ host: HOST, port: 443 })
  let last
  for (const r of routes) {
    try {
      return await request({ ...r, path, method, body })
    } catch (err) {
      if (err.status) throw err
      last = err
    }
  }
  throw last
}

// ——— Телеграм ———

async function tg(method, params) {
  const res = await fetch(`${TG}/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(method === 'getUpdates' ? 40_000 : 15_000),
  })
  const json = await res.json()
  if (!json.ok) throw new Error(`${method}: ${json.description}`)
  return json.result
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])

function card(words) {
  const text =
    words.length === 1
      ? `Новое слово: <b>${esc(words[0].text)}</b>`
      : `Новые слова (${words.length}):\n` + words.map((w) => `• <b>${esc(w.text)}</b>`).join('\n')
  const keyboard = words.map((w) => [
    { text: `✓ ${w.text}`, callback_data: `a:${w.id}` },
    { text: '✕', callback_data: `r:${w.id}` },
  ])
  if (words.length > 1)
    keyboard.push([
      { text: 'Принять все', callback_data: `A:${words.map((w) => w.id).join(',')}` },
      { text: 'Отклонить все', callback_data: `R:${words.map((w) => w.id).join(',')}` },
    ])
  return { text, reply_markup: { inline_keyboard: keyboard } }
}

// ——— циклы ———

/** Новые слова → одно сообщение с кнопками. */
export async function pollQueue() {
  const { words } = await game('/api/mod/queue?fresh=1')
  if (!words?.length) return 0
  const { text, reply_markup } = card(words)
  await tg('sendMessage', { chat_id: ADMIN, text, parse_mode: 'HTML', reply_markup })
  await game('/api/mod/notified', 'POST', { ids: words.map((w) => w.id) })
  log(`sent ${words.length} words`)
  return words.length
}

async function decide(ids, approve) {
  const out = []
  for (const id of ids) {
    try {
      const { word } = await game('/api/mod/decide', 'POST', { id, approve })
      out.push(word)
    } catch (err) {
      if (err.status !== 404) throw err
    }
  }
  return out
}

async function onCallback(q) {
  if (String(q.message?.chat?.id) !== String(ADMIN)) return tg('answerCallbackQuery', { callback_query_id: q.id })
  const [kind, list] = String(q.data).split(':')
  const ids = list.split(',').map(Number).filter(Number.isInteger)
  const approve = kind === 'a' || kind === 'A'
  const words = await decide(ids, approve)
  await tg('answerCallbackQuery', { callback_query_id: q.id, text: approve ? 'Принято' : 'Отклонено' })
  // Перерисовываем сообщение: решённые слова с отметкой, кнопки только у нерешённых.
  const kb = q.message.reply_markup?.inline_keyboard ?? []
  const decided = new Set(ids)
  const rest = kb.filter((row) => {
    const id = Number(String(row[0]?.callback_data).split(':')[1])
    return Number.isInteger(id) && !decided.has(id) && row.length === 2 && /^[ar]:/.test(row[0].callback_data)
  })
  const lines = (q.message.text ?? '').split('\n')
  const mark = approve ? '✓' : '✕'
  const names = new Set(words.map((w) => w.text))
  const text = lines.map((l) => {
    const m = /^(?:• |Новое слово: )(.+)$/.exec(l)
    return m && names.has(m[1]) ? `${mark} ${esc(m[1])}` : esc(l)
  }).join('\n')
  const reply_markup = { inline_keyboard: rest.length > 1 ? [...rest, kb.at(-1)] : rest }
  await tg('editMessageText', { chat_id: ADMIN, message_id: q.message.message_id, text, parse_mode: 'HTML', reply_markup }).catch(() => {})
}

async function onMessage(m) {
  if (String(m.chat?.id) !== String(ADMIN) || typeof m.text !== 'string') return
  const [cmd, ...rest] = m.text.trim().split(/\s+/)
  const arg = rest.join(' ')
  const reply = (text, extra = {}) => tg('sendMessage', { chat_id: ADMIN, text, parse_mode: 'HTML', ...extra })
  if (cmd === '/queue') {
    const { words } = await game('/api/mod/queue')
    if (!words.length) return reply('Очередь пуста.')
    const chunk = words.slice(0, 30)
    return reply(card(chunk).text, { reply_markup: card(chunk).reply_markup })
  }
  if (cmd === '/stats') {
    const { stats, rooms } = await game('/api/mod/stats')
    const n = (k) => stats[k] ?? 0
    return reply(
      `Словарь: <b>${n('approved_seed') + n('approved_user')}</b> слов (от игроков ${n('approved_user')})\n` +
        `Ждут решения: ${n('pending_user')}\nОтклонено: ${n('rejected_user') + n('rejected_seed')}\nКомнат сейчас: ${rooms}`,
    )
  }
  if ((cmd === '/add' || cmd === '/del') && arg) {
    try {
      const { word } = await game('/api/mod/set', 'POST', { word: arg, approve: cmd === '/add' })
      return reply(cmd === '/add' ? `Добавлено: <b>${esc(word)}</b>` : `Убрано: <b>${esc(word)}</b>`)
    } catch (err) {
      if (err.status === 400) return reply('Не подходит: одно русское слово, 2–14 букв.')
      throw err
    }
  }
  return reply('/queue — очередь\n/stats — словарь\n/add слово — добавить\n/del слово — убрать')
}

async function updatesLoop() {
  let offset = 0
  for (;;) {
    try {
      const updates = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] })
      for (const u of updates) {
        offset = u.update_id + 1
        try {
          if (u.callback_query) await onCallback(u.callback_query)
          else if (u.message) await onMessage(u.message)
        } catch (err) {
          log(`update ${u.update_id}: ${err.message}`)
          if (u.callback_query) await tg('answerCallbackQuery', { callback_query_id: u.callback_query.id, text: 'Сервер игры не ответил, попробуй позже' }).catch(() => {})
        }
      }
    } catch (err) {
      log(`getUpdates: ${err.message}`)
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
}

async function queueLoop() {
  for (;;) {
    try {
      await pollQueue()
    } catch (err) {
      // сервер игры бывает недоступен по нескольку минут — просто ждём следующего круга
      log(`queue: ${err.message}`)
    }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [k, v] of Object.entries({ TELEGRAM_BOT_TOKEN: TOKEN, ADMIN_CHAT_ID: ADMIN, MOD_KEY: KEY })) {
    if (!v) {
      console.error(`нет ${k}`)
      process.exit(1)
    }
  }
  log(`modbot: ${HOST}${VIA ? ` via ${VIA}` : ''}`)
  void updatesLoop()
  void queueLoop()
}
