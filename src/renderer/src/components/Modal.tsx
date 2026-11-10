import { AnimatePresence, motion } from 'motion/react'
import { useEffect, type ReactNode } from 'react'
import { X } from '@phosphor-icons/react'

interface Props {
  open: boolean
  title: string
  onClose(): void
  children: ReactNode
  width?: number
}

export function Modal({ open, title, onClose, children, width = 460 }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose()
          }}
        >
          <motion.div
            className="modal panel"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            style={{ width }}
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          >
            <header className="modal__head">
              <h2>{title}</h2>
              <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
                <X size={20} />
              </button>
            </header>
            <div className="modal__body">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
