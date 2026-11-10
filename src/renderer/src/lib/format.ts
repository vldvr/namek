const NBSP = ' '

/** 1240 → «1 240» с неразрывным пробелом. */
export function chips(n: number): string {
  const s = Math.round(Math.abs(n)).toString()
  const grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
  return n < 0 ? `−${grouped}` : grouped
}

export function signedChips(n: number): string {
  if (n === 0) return '0'
  return n > 0 ? `+${chips(n)}` : chips(n)
}

/** Русское множественное число: plural(5, 'игрок', 'игрока', 'игроков'). */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  if (b === 1) return one
  return many
}

/** Шансы руки: «64%», без ложных 0% и 100%, пока исход не решён. */
export function formatEquity(v: number): string {
  if (v <= 0) return '0%'
  if (v >= 1) return '100%'
  if (v < 0.005) return '<1%'
  if (v > 0.995) return '>99%'
  return `${Math.round(v * 100)}%`
}

export function formatCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)}${NBSP}${code.slice(3)}` : code
}

export function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
}
