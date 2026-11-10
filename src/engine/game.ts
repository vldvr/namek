// Правила «Намёка». Чистые функции над состоянием партии, без сети и UI.

export type Team = 'amber' | 'teal'
export type Color = Team | 'neutral' | 'trap'
export type RandomInt = (maxExclusive: number) => number

export const BOARD_SIZE = 25
export const UNLIMITED = -1 // «∞» в подсказке

export type Card = { word: string; color: Color; revealed: boolean; revealedBy?: Team }

export type Clue = {
  team: Team
  word: string
  count: number // UNLIMITED для ∞
  guesses: { index: number; color: Color }[]
}

export type Phase = 'clue' | 'guess' | 'over'

export type GameState = {
  cards: Card[]
  starting: Team
  turn: Team
  phase: Phase
  clues: Clue[]
  guessesLeft: number // в фазе guess; Infinity не сериализуется, поэтому -1 = без лимита
  winner: Team | null
  endReason: 'cleared' | 'trap' | null
}

export const other = (t: Team): Team => (t === 'amber' ? 'teal' : 'amber')

export function cryptoRandomInt(max: number): number {
  const buf = new Uint32Array(1)
  // отбрасываем хвост, чтобы не было перекоса
  const limit = Math.floor(0x1_0000_0000 / max) * max
  do crypto.getRandomValues(buf)
  while (buf[0]! >= limit)
  return buf[0]! % max
}

export function seededRandomInt(seed: number): RandomInt {
  let s = seed >>> 0 || 1
  return (max) => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s % max
  }
}

export function shuffle<T>(arr: T[], rnd: RandomInt): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1)
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

/** Нормализация для сравнения слов: регистр, ё→е, пробелы. */
export function normWord(w: string): string {
  return w.trim().toLocaleUpperCase('ru-RU').replace(/Ё/g, 'Е').replace(/\s+/g, ' ')
}

/** Выбирает 25 разных слов из пула (по нормализованному виду). */
export function pickWords(pool: readonly string[], rnd: RandomInt): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of shuffle(pool.slice(), rnd)) {
    const n = normWord(w)
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
    if (out.length === BOARD_SIZE) return out
  }
  throw new GameError('not_enough_words')
}

export class GameError extends Error {
  code: GameErrorCode
  constructor(code: GameErrorCode) {
    super(code)
    this.code = code
  }
}
export type GameErrorCode =
  | 'not_enough_words'
  | 'wrong_phase'
  | 'bad_clue'
  | 'clue_on_board'
  | 'bad_count'
  | 'bad_card'
  | 'already_revealed'

export function newGame(words: readonly string[], rnd: RandomInt, starting?: Team): GameState {
  const chosen = pickWords(words, rnd)
  const first = starting ?? (rnd(2) === 0 ? 'amber' : 'teal')
  const colors: Color[] = [
    ...Array<Color>(9).fill(first),
    ...Array<Color>(8).fill(other(first)),
    ...Array<Color>(7).fill('neutral'),
    'trap',
  ]
  const mixed = shuffle(colors, rnd)
  return {
    cards: chosen.map((word, i) => ({ word, color: mixed[i]!, revealed: false })),
    starting: first,
    turn: first,
    phase: 'clue',
    clues: [],
    guessesLeft: 0,
    winner: null,
    endReason: null,
  }
}

export function remaining(g: GameState, team: Team): number {
  return g.cards.filter((c) => c.color === team && !c.revealed).length
}

/** Проверка слова подсказки; возвращает нормализованный вид. */
export function validateClueWord(g: GameState, raw: string): string {
  const w = normWord(raw)
  if (!/^[А-ЯA-Z][А-ЯA-Z-]{0,23}$/.test(w) || w.endsWith('-')) throw new GameError('bad_clue')
  for (const c of g.cards) {
    if (c.revealed) continue
    // нельзя называть слово с поля, а также его часть или слово, содержащее его
    if (c.word === w || (w.length >= 3 && c.word.includes(w)) || (c.word.length >= 3 && w.includes(c.word)))
      throw new GameError('clue_on_board')
  }
  return w
}

export function giveClue(g: GameState, team: Team, raw: string, count: number): Clue {
  if (g.phase !== 'clue' || g.turn !== team) throw new GameError('wrong_phase')
  if (!(Number.isInteger(count) && ((count >= 0 && count <= 9) || count === UNLIMITED)))
    throw new GameError('bad_count')
  const word = validateClueWord(g, raw)
  const clue: Clue = { team, word, count, guesses: [] }
  g.clues.push(clue)
  g.phase = 'guess'
  // 0 и ∞ — без лимита попыток; иначе число + 1
  g.guessesLeft = count === UNLIMITED || count === 0 ? UNLIMITED : count + 1
  return clue
}

export type GuessResult = { color: Color; turnEnded: boolean; winner: Team | null }

export function guess(g: GameState, team: Team, index: number): GuessResult {
  if (g.phase !== 'guess' || g.turn !== team) throw new GameError('wrong_phase')
  const card = g.cards[index]
  if (!card) throw new GameError('bad_card')
  if (card.revealed) throw new GameError('already_revealed')
  card.revealed = true
  card.revealedBy = team
  g.clues[g.clues.length - 1]!.guesses.push({ index, color: card.color })

  if (card.color === 'trap') return finish(g, other(team), 'trap', card.color)
  // открыть последнее слово любой команды — победа этой команды
  for (const t of [team, other(team)] as const) {
    if (remaining(g, t) === 0) return finish(g, t, 'cleared', card.color)
  }
  if (card.color !== team) {
    passTurn(g)
    return { color: card.color, turnEnded: true, winner: null }
  }
  if (g.guessesLeft !== UNLIMITED) {
    g.guessesLeft--
    if (g.guessesLeft <= 0) {
      passTurn(g)
      return { color: card.color, turnEnded: true, winner: null }
    }
  }
  return { color: card.color, turnEnded: false, winner: null }
}

export function endTurn(g: GameState, team: Team): void {
  if (g.phase !== 'guess' || g.turn !== team) throw new GameError('wrong_phase')
  // хотя бы одна попытка обязательна — защита от случайного нажатия
  const last = g.clues[g.clues.length - 1]
  if (!last || last.guesses.length === 0) throw new GameError('wrong_phase')
  passTurn(g)
}

/** Время фазы вышло: ход переходит к соперникам без штрафа. */
export function timeout(g: GameState): void {
  if (g.phase === 'over') throw new GameError('wrong_phase')
  passTurn(g)
}

/** Слово для общего словаря: одно русское слово, 2–14 букв, дефис внутри можно. */
export function dictionaryWord(raw: string): string | null {
  const w = normWord(raw)
  return /^[А-Я](?:[А-Я]|-(?=[А-Я])){1,13}$/.test(w) && w.replace(/-/g, '').length >= 2 ? w : null
}

/** Слово для своего набора комнаты: мягче — латиница, цифры, пробел, до 20 знаков. */
export function customWord(raw: string): string | null {
  const w = normWord(raw)
  return /^[А-ЯA-Z0-9][А-ЯA-Z0-9 -]{0,19}$/.test(w) && w.length >= 2 ? w : null
}

function passTurn(g: GameState): void {
  g.turn = other(g.turn)
  g.phase = 'clue'
  g.guessesLeft = 0
}

function finish(g: GameState, winner: Team, reason: 'cleared' | 'trap', color: Color): GuessResult {
  g.phase = 'over'
  g.winner = winner
  g.endReason = reason
  g.guessesLeft = 0
  return { color, turnEnded: true, winner }
}
