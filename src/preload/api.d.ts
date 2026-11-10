export type UpdateState =
  | { state: 'idle' }
  | { state: 'downloading'; version: string }
  | { state: 'ready'; version: string }
  | { state: 'available'; version: string; url: string }
  | { state: 'error'; message: string }

/** То, что preload отдаёт окну как window.namek. */
export interface NamekApi {
  info(): Promise<{ version: string; platform: string; portable: boolean }>
  flash(on: boolean): void
  toggleFullscreen(): void
  keepAwake(on: boolean): void
  openExternal(url: string): void
  update: {
    onState(cb: (s: UpdateState) => void): () => void
    install(): void
  }
}

declare global {
  interface Window {
    namek?: NamekApi
  }
}
