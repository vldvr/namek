import { useEffect, useState } from 'react'
import { Check, Clock, Prohibit, X } from '@phosphor-icons/react'
import { Modal } from '../components/Modal'
import { playerToken } from '../lib/id'
import { BusyError, proposeWords, type ProposeResult } from '../net/server'
import { useApp } from '../store/app'

const RESULT: Record<ProposeResult, { text: string; ok: boolean }> = {
  queued: { text: 'отправлено на проверку', ok: true },
  exists: { text: 'уже есть в словаре', ok: true },
  pending: { text: 'уже ждёт проверки', ok: true },
  rejected: { text: 'его уже не взяли', ok: false },
  invalid: { text: 'не подходит: одно русское слово, 2–14 букв', ok: false },
  limit: { text: 'на сегодня хватит, завтра можно ещё', ok: false },
}

/** Игрок предлагает слова в общий словарь. Появятся у всех после одобрения. */
export function ProposeModal() {
  const open = useApp((s) => s.propose)
  const token = useApp((s) => s.profile.token)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<{ word: string; result: ProposeResult }[]>([])
  const close = () => useApp.setState({ propose: null })

  useEffect(() => {
    if (open) {
      setText('')
      setResults([])
      setError(null)
    }
  }, [open])

  const words = text
    .split(/[\n,;\s]+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 10)

  const submit = async () => {
    if (!words.length) return
    setBusy(true)
    setError(null)
    try {
      setResults(await proposeWords(words, await playerToken(token)))
      setText('')
    } catch (err) {
      setError(err instanceof BusyError ? 'Слишком часто. Попробуй через минуту.' : 'Сервер не ответил. Проверь интернет и попробуй ещё раз.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!open} title="Предложить слово" onClose={close} width={480}>
      <p className="modal__lede">Существительное, которое хорошо играет: у него есть второй смысл или неожиданные связи. После проверки оно появится на поле у всех.</p>
      <div className="propose__row">
        <input
          className="input propose__input"
          value={text}
          autoFocus
          maxLength={160}
          spellCheck={false}
          placeholder="Например: самокат"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          aria-label="Слова через запятую"
        />
        <button className="btn btn--primary" disabled={busy || !words.length} onClick={() => void submit()}>
          {busy ? 'Отправляем' : 'Отправить'}
        </button>
      </div>
      <p className="row__hint">Можно несколько через запятую, до десяти за раз.</p>
      {error && <p className="form-error">{error}</p>}
      {results.length > 0 && (
        <ul className="propose__results">
          {results.map((r, i) => {
            const meta = RESULT[r.result]
            const Icon = r.result === 'queued' ? Clock : meta.ok ? Check : r.result === 'invalid' ? X : Prohibit
            return (
              <li key={i} className={meta.ok ? 'is-ok' : 'is-bad'}>
                <Icon size={16} weight="bold" />
                <b>{r.word}</b> {meta.text}
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
