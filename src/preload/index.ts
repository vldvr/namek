import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { NamekApi, UpdateState } from './api'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: NamekApi = {
  info: () => ipcRenderer.invoke('app:info'),
  flash: (on) => ipcRenderer.send('win:flash', on),
  toggleFullscreen: () => ipcRenderer.send('win:fullscreen'),
  keepAwake: (on) => ipcRenderer.send('app:awake', on),
  openExternal: (url) => ipcRenderer.send('app:open', url),
  update: {
    onState: (cb) => subscribe<UpdateState>('update:state', cb),
    install: () => ipcRenderer.send('update:install'),
  },
}

contextBridge.exposeInMainWorld('namek', api)
