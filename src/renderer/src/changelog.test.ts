import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CHANGELOG, compareVersions, releasesSince, type Release } from './changelog.ts'

const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string }

// Правило проекта: у каждой версии есть патчноут. Без записи для версии из package.json тесты падают,
// а с ними CI и релиз.
describe('changelog', () => {
  it('has notes for the version in package.json', () => {
    const entry = CHANGELOG.find((r) => r.version === pkg.version)
    expect(entry, `нет патчноута для ${pkg.version} в src/renderer/src/changelog.ts`).toBeDefined()
    expect(entry!.changes.length).toBeGreaterThan(0)
  })

  it('goes from new to old, without repeats or versions from the far future', () => {
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(compareVersions(CHANGELOG[i - 1]!.version, CHANGELOG[i]!.version)).toBeGreaterThan(0)
    }
    // Впереди может лежать только одна следующая версия, которую ещё не выпустили.
    const ahead = CHANGELOG.filter((r) => compareVersions(r.version, pkg.version) > 0)
    expect(ahead.length).toBeLessThanOrEqual(1)
  })

  it('every entry is filled in', () => {
    for (const r of CHANGELOG) {
      expect(r.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(r.title.trim().length).toBeGreaterThan(0)
      expect(r.changes.length).toBeGreaterThan(0)
      for (const c of r.changes) {
        expect(['new', 'better', 'fix']).toContain(c.kind)
        expect(c.title.trim().length).toBeGreaterThan(0)
        expect(c.title.endsWith('.')).toBe(false)
      }
    }
  })
})

describe('releasesSince', () => {
  const log: Release[] = ['1.9.0', '1.8.0', '1.7.1', '1.7.0', '1.6.0'].map((version) => ({
    version,
    date: '2026-01-01',
    title: version,
    changes: [{ kind: 'new', title: 'x' }],
  }))

  it('shows everything newer than what the player has seen, up to the running version', () => {
    expect(releasesSince('1.7.0', '1.8.0', log).map((r) => r.version)).toEqual(['1.8.0', '1.7.1'])
  })

  it('shows nothing when the version did not change', () => {
    expect(releasesSince('1.8.0', '1.8.0', log)).toEqual([])
  })

  it('a player from before patch notes sees only the current version', () => {
    expect(releasesSince(null, '1.7.1', log).map((r) => r.version)).toEqual(['1.7.1'])
  })

  it('caps a long gap at three releases', () => {
    expect(releasesSince('1.0.0', '1.9.0', log)).toHaveLength(3)
  })

  it('compares numerically, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBeGreaterThan(0)
  })
})
