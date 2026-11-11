// Патчноуты. Правило: у каждой версии из package.json здесь есть запись, иначе тесты и релиз не пройдут.
// Новая версия идёт первой. Пишем для игроков: что изменилось за столом, без внутренней кухни.

export type ChangeKind = 'new' | 'better' | 'fix'

export interface Change {
  kind: ChangeKind
  /** Коротко, как заголовок: «Кролик». */
  title: string
  /** Одно-два предложения: что это и как этим пользоваться. */
  text?: string
}

export interface Release {
  version: string
  /** ГГГГ-ММ-ДД. */
  date: string
  /** Имя релиза в два-три слова. */
  title: string
  changes: Change[]
}

export const CHANGELOG: Release[] = [
  {
    version: '0.1.1',
    date: '2026-11-11',
    title: 'Через Sevensave',
    changes: [
      {
        kind: 'new',
        title: 'Лаунчер Sevensave',
        text: 'Намёк теперь можно поставить и обновлять из лаунчера Sevensave: одна кнопка, без выбора файлов. Обычный установщик работает как раньше.',
      },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-11-10',
    title: 'Первая партия',
    changes: [
      { kind: 'new', title: 'Поле на двоих', text: 'Две команды, капитаны дают намёки, отгадчики открывают слова. Комната по шестизначному коду.' },
      { kind: 'new', title: 'Свои слова', text: 'Хост может загрузить в комнату свой список слов — только свои или вперемешку с общим словарём.' },
      { kind: 'new', title: 'Предложить слово', text: 'Не хватает слова в общем словаре? Предложи его, после проверки оно появится у всех.' },
    ],
  },
]

/** Сравнение версий вида 1.2.3: отрицательное, если a старше b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * Что показать после обновления: версии новее `seen` до текущей включительно, не больше трёх.
 * seen = null: игрок пришёл с версии, где патчноутов ещё не было, показываем только текущую.
 */
export function releasesSince(seen: string | null, current: string, log: readonly Release[] = CHANGELOG): Release[] {
  const upTo = log.filter((r) => compareVersions(r.version, current) <= 0)
  if (seen === null) return upTo.filter((r) => r.version === current)
  return upTo.filter((r) => compareVersions(r.version, seen) > 0).slice(0, 3)
}

/** Все вышедшие версии до текущей: для списка в настройках. */
export function releasedUpTo(current: string, log: readonly Release[] = CHANGELOG): Release[] {
  return log.filter((r) => compareVersions(r.version, current) <= 0)
}
