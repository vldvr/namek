import { describe, expect, it } from 'vitest'
import {
  GameError, UNLIMITED, endTurn, giveClue, guess, newGame, normWord, remaining, seededRandomInt,
  type GameState, type Team,
} from './game.ts'

const WORDS = Array.from({ length: 40 }, (_, i) => `СЛОВО${String.fromCharCode(1040 + i)}`)

function game(seed = 1, start: Team = 'amber'): GameState {
  return newGame(WORDS, seededRandomInt(seed), start)
}
const idx = (g: GameState, color: string) => g.cards.findIndex((c) => c.color === color && !c.revealed)

describe('раскладка', () => {
  it('9/8/7/1 и 25 разных слов', () => {
    for (let s = 1; s < 50; s++) {
      const g = game(s, s % 2 ? 'amber' : 'teal')
      const n = (c: string) => g.cards.filter((x) => x.color === c).length
      expect(g.cards).toHaveLength(25)
      expect(new Set(g.cards.map((c) => c.word)).size).toBe(25)
      expect(n(g.starting)).toBe(9)
      expect(n(g.starting === 'amber' ? 'teal' : 'amber')).toBe(8)
      expect(n('neutral')).toBe(7)
      expect(n('trap')).toBe(1)
    }
  })
  it('мало слов — ошибка, дубли не считаются', () => {
    expect(() => newGame([...Array(30).fill('КОТ')], seededRandomInt(1))).toThrow(GameError)
  })
  it('нормализация ё', () => expect(normWord(' ёлка ')).toBe('ЕЛКА'))
})

describe('ход', () => {
  it('число+1 попыток', () => {
    const g = game()
    giveClue(g, 'amber', 'зверь', 1)
    expect(guess(g, 'amber', idx(g, 'amber')).turnEnded).toBe(false)
    expect(guess(g, 'amber', idx(g, 'amber')).turnEnded).toBe(true)
    expect(g.turn).toBe('teal')
    expect(g.phase).toBe('clue')
  })
  it('нейтральное слово передаёт ход', () => {
    const g = game()
    giveClue(g, 'amber', 'зверь', 3)
    expect(guess(g, 'amber', idx(g, 'neutral')).turnEnded).toBe(true)
    expect(g.turn).toBe('teal')
  })
  it('провал — проигрыш', () => {
    const g = game()
    giveClue(g, 'amber', 'зверь', 3)
    expect(guess(g, 'amber', idx(g, 'trap')).winner).toBe('teal')
    expect(g.phase).toBe('over')
    expect(g.endReason).toBe('trap')
  })
  it('открыть все свои — победа; чужое последнее — победа чужих', () => {
    const g = game()
    giveClue(g, 'amber', 'всё', UNLIMITED)
    for (let i = 0; i < 8; i++) guess(g, 'amber', idx(g, 'amber'))
    expect(guess(g, 'amber', idx(g, 'amber')).winner).toBe('amber')

    const h = game()
    for (const c of h.cards) if (c.color === 'teal') c.revealed = true
    h.cards[idx(h, 'teal') === -1 ? 0 : 0]!.revealed = h.cards[0]!.revealed
    const last = h.cards.findIndex((c) => c.color === 'teal')
    h.cards[last]!.revealed = false
    giveClue(h, 'amber', 'ой', 1)
    expect(guess(h, 'amber', last).winner).toBe('teal')
    expect(remaining(h, 'teal')).toBe(0)
  })
  it('нельзя ходить не в свою очередь и не в ту фазу', () => {
    const g = game()
    expect(() => giveClue(g, 'teal', 'зверь', 1)).toThrow('wrong_phase')
    expect(() => guess(g, 'amber', 0)).toThrow('wrong_phase')
    giveClue(g, 'amber', 'зверь', 1)
    expect(() => giveClue(g, 'amber', 'зверь', 1)).toThrow('wrong_phase')
    expect(() => endTurn(g, 'amber')).toThrow('wrong_phase') // ни одной попытки
    guess(g, 'amber', idx(g, 'amber'))
    endTurn(g, 'amber')
    expect(g.turn).toBe('teal')
  })
  it('подсказка: слово с поля и мусор отклоняются', () => {
    const g = game()
    expect(() => giveClue(g, 'amber', g.cards[0]!.word.toLowerCase(), 1)).toThrow('clue_on_board')
    expect(() => giveClue(g, 'amber', 'два слова', 1)).toThrow('bad_clue')
    expect(() => giveClue(g, 'amber', 'кот', 10)).toThrow('bad_count')
    expect(() => giveClue(g, 'amber', '123', 1)).toThrow('bad_clue')
  })
  it('повторно открыть нельзя', () => {
    const g = game()
    giveClue(g, 'amber', 'зверь', 3)
    const i = idx(g, 'amber')
    guess(g, 'amber', i)
    expect(() => guess(g, 'amber', i)).toThrow('already_revealed')
  })
})
