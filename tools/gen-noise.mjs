// Генерирует бесшовную текстуру шума для сукна и кожи (PNG, серый с альфой).
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const N = 256
let seed = 1337
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)

// Сумма нескольких октав сглаженного шума на торе, чтобы тайл не имел швов.
const octave = (cells) => {
  const g = Array.from({ length: cells * cells }, rnd)
  const at = (x, y) => g[((y % cells) + cells) % cells * cells + ((x % cells) + cells) % cells]
  return (u, v) => {
    const x = (u / N) * cells, y = (v / N) * cells
    const x0 = Math.floor(x), y0 = Math.floor(y)
    const sx = x - x0, sy = y - y0
    const s = (t) => t * t * (3 - 2 * t)
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1)
    return a + (b - a) * s(sx) + (c - a) * s(sy) + (a - b - c + d) * s(sx) * s(sy)
  }
}
const layers = [octave(128), octave(64), octave(16)]
const weights = [0.55, 0.3, 0.15]

const raw = Buffer.alloc(N * (N * 2 + 1))
for (let y = 0; y < N; y++) {
  raw[y * (N * 2 + 1)] = 0
  for (let x = 0; x < N; x++) {
    let v = 0
    for (let i = 0; i < layers.length; i++) v += layers[i](x, y) * weights[i]
    v = v * 0.7 + rnd() * 0.3 // мелкое зерно
    const o = y * (N * 2 + 1) + 1 + x * 2
    raw[o] = v > 0.5 ? 255 : 0
    raw[o + 1] = Math.round(Math.abs(v - 0.5) * 2 * 255)
  }
}

const crc = (buf) => {
  let c, crcTable = []
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0 }
  let x = 0xffffffff
  for (const b of buf) x = crcTable[(x ^ b) & 0xff] ^ (x >>> 8)
  return (x ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4)
ihdr[8] = 8; ihdr[9] = 4; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0 // серый + альфа
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])
const out = resolve(import.meta.dirname, '../src/renderer/src/assets/noise.png')
writeFileSync(out, png)
console.log(out, png.length, 'bytes')
