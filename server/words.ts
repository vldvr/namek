// Общий словарь: стартовые слова + предложенные игроками после одобрения в Телеграме.
import { DatabaseSync } from 'node:sqlite'
import { dictionaryWord } from '../src/engine/index.ts'

export type WordStatus = 'pending' | 'approved' | 'rejected'
export type ProposeResult = 'queued' | 'exists' | 'pending' | 'rejected' | 'invalid' | 'limit'

export interface WordRow {
  id: number
  text: string
  status: WordStatus
  source: 'seed' | 'user'
  submitted_by: string | null
  created_at: number
  decided_at: number | null
}

export const WORD_LIMITS = {
  /** Предложений с одного адреса или профиля в сутки. */
  perDay: 20,
  /** Сколько слов в одном запросе. */
  perRequest: 10,
}

export function openWords(file = ':memory:', { now = () => Date.now() } = {}) {
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      submitted_by TEXT,
      created_at INTEGER NOT NULL,
      decided_at INTEGER,
      notified INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS words_status ON words(status);
    CREATE TABLE IF NOT EXISTS proposals (key TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS proposals_key ON proposals(key, at);
  `)
  const q = {
    get: db.prepare('SELECT * FROM words WHERE text = ?'),
    add: db.prepare('INSERT INTO words (text, status, source, submitted_by, created_at) VALUES (?, ?, ?, ?, ?)'),
    approved: db.prepare("SELECT text FROM words WHERE status = 'approved'"),
    queue: db.prepare("SELECT * FROM words WHERE status = 'pending' ORDER BY id LIMIT ?"),
    unnotified: db.prepare("SELECT * FROM words WHERE status = 'pending' AND notified = 0 ORDER BY id LIMIT ?"),
    notified: db.prepare('UPDATE words SET notified = 1 WHERE id = ?'),
    decide: db.prepare("UPDATE words SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'"),
    byId: db.prepare('SELECT * FROM words WHERE id = ?'),
    setStatus: db.prepare('UPDATE words SET status = ?, decided_at = ? WHERE text = ?'),
    stats: db.prepare('SELECT status, source, COUNT(*) AS n FROM words GROUP BY status, source'),
    recentBy: db.prepare('SELECT COUNT(*) AS n FROM proposals WHERE key = ? AND at > ?'),
    hit: db.prepare('INSERT INTO proposals (key, at) VALUES (?, ?)'),
    prune: db.prepare('DELETE FROM proposals WHERE at < ?'),
  }

  // Кэш одобренных: раздача поля дёргает его на каждую партию.
  let cache: string[] | null = null
  const approved = (): string[] => (cache ??= (q.approved.all() as { text: string }[]).map((r) => r.text))

  return {
    approved,

    /** Стартовый словарь: добавляет недостающие слова, ничего не удаляет. */
    seed(list: string[]): number {
      let added = 0
      db.exec('BEGIN')
      try {
        for (const raw of list) {
          const w = dictionaryWord(raw)
          if (!w || q.get.get(w)) continue
          q.add.run(w, 'approved', 'seed', null, now())
          added++
        }
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
      if (added) cache = null
      return added
    },

    /** Игрок предлагает слова. who — ключи лимита (адрес, профиль). */
    propose(words: string[], who: string[]): { word: string; result: ProposeResult }[] {
      const since = now() - 24 * 3600_000
      q.prune.run(since)
      const used = Math.max(0, ...who.map((k) => (q.recentBy.get(k, since) as { n: number }).n))
      let left = WORD_LIMITS.perDay - used
      const out: { word: string; result: ProposeResult }[] = []
      for (const raw of words.slice(0, WORD_LIMITS.perRequest)) {
        const w = dictionaryWord(raw)
        if (!w) {
          out.push({ word: raw.trim().slice(0, 30), result: 'invalid' })
          continue
        }
        const row = q.get.get(w) as WordRow | undefined
        if (row) {
          out.push({ word: w, result: row.status === 'approved' ? 'exists' : row.status })
          continue
        }
        if (left <= 0) {
          out.push({ word: w, result: 'limit' })
          continue
        }
        q.add.run(w, 'pending', 'user', who[0] ?? null, now())
        // засчитываем на каждый ключ: сменой профиля лимит не обойти
        for (const k of who) q.hit.run(k, now())
        left--
        out.push({ word: w, result: 'queued' })
      }
      return out
    },

    queue(limit = 50): WordRow[] {
      return q.queue.all(limit) as unknown as WordRow[]
    },

    /** Ещё не показанные модератору. */
    takeUnnotified(limit = 20): WordRow[] {
      return q.unnotified.all(limit) as unknown as WordRow[]
    },

    markNotified(id: number) {
      q.notified.run(id)
    },

    decide(id: number, approve: boolean): WordRow | null {
      const r = q.decide.run(approve ? 'approved' : 'rejected', now(), id)
      if (r.changes) cache = null
      return (q.byId.get(id) as WordRow | undefined) ?? null
    },

    /** Модератор сам добавляет или убирает слово. */
    set(raw: string, approve: boolean): string | null {
      const w = dictionaryWord(raw)
      if (!w) return null
      if (q.get.get(w)) q.setStatus.run(approve ? 'approved' : 'rejected', now(), w)
      else q.add.run(w, approve ? 'approved' : 'rejected', 'user', 'admin', now())
      cache = null
      return w
    },

    stats(): Record<string, number> {
      const out: Record<string, number> = {}
      for (const r of q.stats.all() as { status: string; source: string; n: number }[]) out[`${r.status}_${r.source}`] = r.n
      return out
    },

    close() {
      db.close()
    },
  }
}

export type Words = ReturnType<typeof openWords>
