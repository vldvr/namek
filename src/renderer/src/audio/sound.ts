import { useApp } from '../store/app'

const files = import.meta.glob('../assets/sounds/*.ogg', { eager: true, query: '?url', import: 'default' }) as Record<
  string,
  string
>

const urls = new Map<string, string>()
for (const [path, url] of Object.entries(files)) urls.set(path.split('/').pop()!.replace('.ogg', ''), url)

/** Группы вариантов: каждый раз берём случайный, не повторяя предыдущий. */
const GROUPS: Record<string, string[]> = {}

export type SoundName = 'turn' | 'chime' | 'tick' | 'click' | 'select' | 'toggle' | 'message' | 'join' | 'leave' | 'win' | 'level'

interface PlayOptions {
  volume?: number
  /** Разброс высоты, по умолчанию ±4%. */
  jitter?: number
  delay?: number
  rate?: number
}

class SoundBank {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private buffers = new Map<string, AudioBuffer>()
  private loading: Promise<void> | null = null
  private last = new Map<string, string>()

  /** Браузер разрешает звук только после действия пользователя. */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' })
      this.master = this.ctx.createGain()
      this.master.connect(this.ctx.destination)
      this.applyVolume()
      this.loading = this.loadAll()
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  private async loadAll() {
    const ctx = this.ctx!
    await Promise.all(
      [...urls].map(async ([name, url]) => {
        try {
          const data = await (await fetch(url)).arrayBuffer()
          this.buffers.set(name, await ctx.decodeAudioData(data))
        } catch {
          // без этого звука проживём
        }
      }),
    )
  }

  applyVolume() {
    const { volume, muted } = useApp.getState().settings
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : volume, this.ctx.currentTime, 0.02)
  }

  play(name: SoundName, opts: PlayOptions = {}) {
    const ctx = this.ctx
    if (!ctx || !this.master || ctx.state !== 'running') return
    const group = GROUPS[name]
    let file: string = name
    if (group) {
      const prev = this.last.get(name)
      const pool = group.length > 1 ? group.filter((g) => g !== prev) : group
      file = pool[Math.floor(Math.random() * pool.length)]!
      this.last.set(name, file)
    }
    const buf = this.buffers.get(file)
    if (!buf) return
    const src = ctx.createBufferSource()
    src.buffer = buf
    const jitter = opts.jitter ?? 0.04
    src.playbackRate.value = (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * jitter)
    const gain = ctx.createGain()
    gain.gain.value = (opts.volume ?? 1) * (1 + (Math.random() * 2 - 1) * 0.04)
    src.connect(gain).connect(this.master)
    src.start(ctx.currentTime + (opts.delay ?? 0) / 1000)
  }

  /** Несколько коротких звуков подряд, например фишки в банк. */
  burst(name: SoundName, count: number, spacing: number, opts: PlayOptions = {}) {
    for (let i = 0; i < count; i++) this.play(name, { ...opts, delay: (opts.delay ?? 0) + i * spacing * (0.8 + Math.random() * 0.4) })
  }

  get ready() {
    return this.loading
  }
}

export const sound = new SoundBank()

useApp.subscribe((s, prev) => {
  if (s.settings.volume !== prev.settings.volume || s.settings.muted !== prev.settings.muted) sound.applyVolume()
})

if (typeof window !== 'undefined') {
  const unlock = () => sound.unlock()
  window.addEventListener('pointerdown', unlock, { capture: true })
  window.addEventListener('keydown', unlock, { capture: true })
}
