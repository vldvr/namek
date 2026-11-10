export function randomToken(len = 32): string {
  const abc = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const buf = new Uint32Array(len)
  crypto.getRandomValues(buf)
  return Array.from(buf, (x) => abc[x % abc.length]).join('')
}

/**
 * Токен игрока для сервера: по нему сервер узнаёт тебя после обрыва связи.
 * Сам токен профиля наружу не уходит, только его хеш.
 */
export async function playerToken(profileToken: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`namek:${profileToken}`))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40)
}
