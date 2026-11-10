import { memo } from 'react'
import { initials } from '../lib/format'

interface Props {
  name: string
  color: string
  src?: string | null
  size: number
  dim?: boolean
}

export const Avatar = memo(function Avatar({ name, color, src, size, dim }: Props) {
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        background: src ? `center / cover no-repeat url(${src})` : `radial-gradient(circle at 35% 30%, ${color}, color-mix(in oklab, ${color} 55%, #000))`,
        fontSize: size * 0.36,
        opacity: dim ? 0.45 : 1,
      }}
      aria-hidden="true"
    >
      {!src && <span>{initials(name)}</span>}
    </div>
  )
})
