// Текст релиза на GitHub: патчноут версии из src/renderer/src/changelog.ts и как скачать.
// node --experimental-strip-types tools/release-notes.mjs 1.7.0 > notes.md
// Нет патчноута для версии: скрипт падает, и релиз не выходит.
import { readFileSync } from 'node:fs'
import { CHANGELOG } from '../src/renderer/src/changelog.ts'

const version = (process.argv[2] ?? '').replace(/^v/, '')
const release = CHANGELOG.find((r) => r.version === version)
if (!release) {
  console.error(`Нет патчноута для версии ${version || '(не указана)'}: допиши src/renderer/src/changelog.ts`)
  process.exit(1)
}

const SECTIONS = [
  ['new', 'Новое'],
  ['better', 'Лучше'],
  ['fix', 'Исправлено'],
]

const out = [`## ${release.title}`, '']
for (const [kind, label] of SECTIONS) {
  const items = release.changes.filter((c) => c.kind === kind)
  if (!items.length) continue
  out.push(`### ${label}`, '')
  for (const c of items) out.push(c.text ? `- **${c.title}.** ${c.text}` : `- ${c.title}`)
  out.push('')
}

const download = readFileSync(new URL('../.github/release-notes.md', import.meta.url), 'utf8').trim()
out.push('---', '', download, '')
process.stdout.write(out.join('\n'))
