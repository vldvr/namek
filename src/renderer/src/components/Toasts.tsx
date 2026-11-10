import { AnimatePresence, motion } from 'motion/react'
import { useApp } from '../store/app'

export function Toasts() {
  const toasts = useApp((s) => s.toasts)
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            className={`toast toast--${t.tone}`}
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.18 } }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
