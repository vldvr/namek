// ?profile=b разводит настройки по вкладкам: так в одном браузере можно сыграть за нескольких.
const profileParam = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('profile') : null
const PREFIX = profileParam ? `namek.${profileParam}.` : 'namek.'

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw === null) return fallback
    return { ...fallback, ...JSON.parse(raw) } as T
  } catch {
    return fallback
  }
}

export function loadRaw<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw === null ? null : (JSON.parse(raw) as T)
  } catch {
    return null
  }
}

export function save(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(PREFIX + key)
    else localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // переполнение или приватный режим: настройки просто не сохранятся
  }
}
