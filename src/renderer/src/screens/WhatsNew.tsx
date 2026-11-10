import { motion } from 'motion/react'
import { Sparkle, TrendUp, Wrench, type Icon } from '@phosphor-icons/react'
import { releasedUpTo, releasesSince, type ChangeKind, type Release } from '../changelog'
import { Modal } from '../components/Modal'
import { save } from '../lib/storage'
import { useApp } from '../store/app'

const KIND: Record<ChangeKind, { label: string; icon: Icon }> = {
  new: { label: 'Новое', icon: Sparkle },
  better: { label: 'Лучше', icon: TrendUp },
  fix: { label: 'Исправлено', icon: Wrench },
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

function dateText(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`
}

/** Патчноуты: сами после обновления и по кнопке в настройках. */
export function WhatsNew() {
  const notes = useApp((s) => s.notes)
  const version = useApp((s) => s.appVersion)
  const reduce = useApp((s) => s.settings.reduceMotion)
  const releases = notes === null ? [] : notes.all ? releasedUpTo(version) : releasesSince(notes.seen, version)

  const close = () => {
    save('seenVersion', version)
    useApp.setState({ notes: null })
  }

  return (
    <Modal open={notes !== null && releases.length > 0} title={notes?.all ? 'Все обновления' : 'Что нового'} onClose={close} width={600}>
      <div className="notes">
        {releases.map((r, i) => (
          <ReleaseNotes key={r.version} release={r} hero={i === 0} reduce={reduce} />
        ))}
      </div>
      <div className="notes__foot">
        <button className="btn btn--primary btn--lg" onClick={close} autoFocus>
          {notes?.all ? 'Закрыть' : 'К столу'}
        </button>
      </div>
    </Modal>
  )
}

function ReleaseNotes({ release, hero, reduce }: { release: Release; hero: boolean; reduce: boolean }) {
  return (
    <article className={`notes__release ${hero ? 'is-hero' : ''}`}>
      <header className="notes__head">
        <span className="notes__version num">{release.version}</span>
        <div className="notes__titles">
          <h3>{release.title}</h3>
          <span className="notes__date">{dateText(release.date)}</span>
        </div>
      </header>
      <ul className="notes__list">
        {release.changes.map((c, i) => {
          const k = KIND[c.kind]
          const Glyph = k.icon
          return (
            <motion.li
              key={`${c.kind}-${c.title}`}
              className={`notes__item is-${c.kind}`}
              initial={hero ? { opacity: 0, y: reduce ? 0 : 8 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.12 + i * 0.07, ease: [0.16, 1, 0.3, 1] }}
            >
              <span className="notes__icon" aria-hidden="true">
                <Glyph size={18} weight="duotone" />
              </span>
              <span className="notes__text">
                <span className="notes__item-title">
                  {c.title}
                  <span className="notes__kind">{k.label}</span>
                </span>
                {c.text && <span className="notes__item-text">{c.text}</span>}
              </span>
            </motion.li>
          )
        })}
      </ul>
    </article>
  )
}
