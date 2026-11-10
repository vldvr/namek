// Проверяет, что слои импортируют только то, что им положено.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const allowed = {
  'src/engine': ['src/engine'],
  'src/protocol': ['src/engine', 'src/protocol'],
  'src/client': ['src/engine', 'src/protocol', 'src/client'],
  'src/main': ['src/main', 'src/protocol', 'src/preload/api'],
  'src/preload': ['src/preload'],
  'src/renderer': ['src/renderer', 'src/engine', 'src/protocol', 'src/client', 'src/preload/api'],
  // сервер берёт из src только правила и протокол
  server: ['src/engine', 'src/protocol'],
}

const files = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
  })

let bad = 0
for (const [layer, ok] of Object.entries(allowed)) {
  const dir = join(root, layer)
  let list = []
  try {
    list = files(dir)
  } catch {
    continue
  }
  for (const file of list) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const target = relative(root, resolve(dirname(file), m[1]))
      if (!target.startsWith('src/')) continue
      if (!ok.some((p) => target === p || target.startsWith(p + '/') || target.startsWith(p + '.'))) {
        console.error(`${relative(root, file)}: нельзя импортировать ${target}`)
        bad++
      }
    }
  }
}
if (bad) process.exit(1)
console.log('границы слоёв в порядке')
