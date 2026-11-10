import { create } from 'zustand'
import type { RoomEvent, RoomView } from '../../../protocol/index.ts'
import type { UpdateState } from '../../../preload/api'
import { load, save } from '../lib/storage'
import { randomToken } from '../lib/id'

export const PLAYER_COLORS = ['#e8a33d', '#e06c4f', '#c77dba', '#7f8fe8', '#3fb3c4', '#56b97f', '#b8bf4a', '#a39c90']

export interface ProfileState {
  name: string
  color: string
  avatar: string | null
  token: string
}

export interface Settings {
  volume: number
  muted: boolean
  reduceMotion: boolean
  /** Звук, когда наступает твой ход. */
  turnSound: boolean
  /** Подтверждать открытие слова вторым нажатием. */
  confirmReveal: boolean
  /** Узоры на цветах команд — для тех, кто плохо различает цвета. */
  patterns: boolean
}

export type ConnState = 'idle' | 'connecting' | 'online' | 'reconnecting'

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'error'
}

interface AppState {
  profile: ProfileState
  settings: Settings
  screen: 'home' | 'room'
  code: string | null
  conn: ConnState
  homeError: string | null
  you: string | null
  view: RoomView | null
  /** Последняя пачка событий: по ней играют звук и анимация. */
  events: { seq: number; list: RoomEvent[] }
  avatars: Record<string, string>
  toasts: Toast[]
  update: UpdateState
  appVersion: string
  notes: { seen: string | null; all: boolean } | null
  /** Окно «Предложить слово»: откуда открыли. */
  propose: { where: 'home' | 'room' } | null
  settingsOpen: boolean
  setProfile(p: Partial<ProfileState>): void
  setSettings(s: Partial<Settings>): void
  toast(text: string, tone?: Toast['tone']): void
  dismissToast(id: number): void
}

const defaultProfile: ProfileState = { name: '', color: PLAYER_COLORS[0]!, avatar: null, token: '' }

const defaultSettings: Settings = {
  volume: 0.7,
  muted: false,
  reduceMotion: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  turnSound: true,
  confirmReveal: true,
  patterns: false,
}

function initialProfile(): ProfileState {
  const p = load('profile', defaultProfile)
  if (!p.token) {
    p.token = randomToken()
    save('profile', p)
  }
  return p
}

let toastSeq = 0

export const useApp = create<AppState>((set, get) => ({
  profile: initialProfile(),
  settings: load('settings', defaultSettings),
  screen: 'home',
  code: null,
  conn: 'idle',
  homeError: null,
  you: null,
  view: null,
  events: { seq: 0, list: [] },
  avatars: {},
  toasts: [],
  update: { state: 'idle' },
  appVersion: '0.0.0',
  notes: null,
  propose: null,
  settingsOpen: false,
  setProfile(p) {
    const profile = { ...get().profile, ...p }
    save('profile', profile)
    set({ profile })
  },
  setSettings(s) {
    const settings = { ...get().settings, ...s }
    save('settings', settings)
    set({ settings })
  },
  toast(text, tone = 'info') {
    const id = ++toastSeq
    set({ toasts: [...get().toasts, { id, text, tone }].slice(-3) })
    setTimeout(() => get().dismissToast(id), tone === 'error' ? 5000 : 3200)
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },
}))
