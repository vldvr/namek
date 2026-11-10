import { useRef, useState } from 'react'
import { ImageSquare, Trash } from '@phosphor-icons/react'
import { Avatar } from '../components/Avatar'
import { avatarFromFile } from '../lib/image'
import { PLAYER_COLORS, useApp } from '../store/app'

export function ProfileEditor({ autoFocus }: { autoFocus?: boolean }) {
  const profile = useApp((s) => s.profile)
  const setProfile = useApp((s) => s.setProfile)
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const pick = async (file: File | undefined) => {
    if (!file) return
    try {
      setError(null)
      setProfile({ avatar: await avatarFromFile(file) })
    } catch {
      setError('Не получилось открыть картинку. Подойдёт PNG, JPG или WebP.')
    }
  }

  return (
    <div className="profile">
      <div className="profile__avatar">
        <Avatar name={profile.name || '?'} color={profile.color} src={profile.avatar} size={72} />
        <div className="profile__avatar-actions">
          <button className="btn btn--sm" onClick={() => fileRef.current?.click()}>
            <ImageSquare size={16} /> {profile.avatar ? 'Другая картинка' : 'Своя картинка'}
          </button>
          {profile.avatar && (
            <button className="icon-btn" onClick={() => setProfile({ avatar: null })} aria-label="Убрать картинку">
              <Trash size={18} />
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => void pick(e.target.files?.[0])} />
        </div>
      </div>
      <label className="field">
        <span className="field__label">Имя в игре</span>
        <input
          className="input"
          type="text"
          value={profile.name}
          maxLength={20}
          autoFocus={autoFocus}
          placeholder="Например, Лёша"
          onChange={(e) => setProfile({ name: e.target.value })}
        />
      </label>
      <div className="field">
        <span className="field__label">Цвет</span>
        <div className="colors">
          {PLAYER_COLORS.map((c) => (
            <button
              key={c}
              className={`color ${profile.color === c ? 'is-on' : ''}`}
              style={{ background: c }}
              onClick={() => setProfile({ color: c })}
              aria-label={`Цвет ${c}`}
              aria-pressed={profile.color === c}
            />
          ))}
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}
