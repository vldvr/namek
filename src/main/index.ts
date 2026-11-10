import { app, BrowserWindow, ipcMain, Menu, powerSaveBlocker, session, shell } from 'electron'
import { join } from 'node:path'
import { initUpdater, installUpdate, isPortable } from './updater'
import type { UpdateState } from '../preload/api'

// NAMEK_PROFILE=a|b|c: отдельные настройки для нескольких копий на одной машине (для проверки).
const profile = process.env.NAMEK_PROFILE
if (profile) app.setPath('userData', join(app.getPath('appData'), `Namek-${profile}`))
else if (!app.requestSingleInstanceLock()) app.quit()

app.setAppUserModelId('com.vldvr.namek')

let win: BrowserWindow | null = null
let awakeId: number | null = null
let lastUpdate: UpdateState = { state: 'idle' }

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'Намёк',
    backgroundColor: '#0e1311',
    titleBarStyle: 'hidden',
    ...(process.platform === 'win32'
      ? { titleBarOverlay: { color: '#0e1311', symbolColor: '#a59d90', height: 36 } }
      : { trafficLightPosition: { x: 14, y: 12 } }),
    icon: join(import.meta.dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  })

  win.once('ready-to-show', () => win?.show())
  win.on('focus', () => win?.flashFrame(false))
  win.on('closed', () => {
    win = null
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!process.env.ELECTRON_RENDERER_URL || !url.startsWith(process.env.ELECTRON_RENDERER_URL)) e.preventDefault()
  })
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F11') {
      win?.setFullScreen(!win.isFullScreen())
      e.preventDefault()
    }
    // В релизе не даём случайно перезагрузить окно посреди партии.
    if (app.isPackaged && (input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r'))) {
      e.preventDefault()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

function setupIpc() {
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, portable: isPortable() }))
  ipcMain.on('win:flash', (_e, on: boolean) => {
    if (win && !win.isFocused()) win.flashFrame(!!on)
    else win?.flashFrame(false)
  })
  ipcMain.on('win:fullscreen', () => win?.setFullScreen(!win.isFullScreen()))
  ipcMain.on('app:awake', (_e, on: boolean) => {
    if (on && awakeId === null) awakeId = powerSaveBlocker.start('prevent-app-suspension')
    if (!on && awakeId !== null) {
      powerSaveBlocker.stop(awakeId)
      awakeId = null
    }
  })
  ipcMain.on('app:open', (_e, url: string) => {
    if (typeof url === 'string' && url.startsWith('https://')) void shell.openExternal(url)
  })

  ipcMain.on('update:install', () => installUpdate())
}

function setupSession() {
  const allowed = new Set(['clipboard-sanitized-write', 'fullscreen'])
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))
}

function setupMenu() {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]),
    )
  } else {
    Menu.setApplicationMenu(null)
  }
}

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

app.whenReady().then(() => {
  setupSession()
  setupMenu()
  setupIpc()
  createWindow()
  initUpdater((s) => {
    lastUpdate = s
    win?.webContents.send('update:state', s)
  })
  win?.webContents.on('did-finish-load', () => {
    if (lastUpdate.state !== 'idle') win?.webContents.send('update:state', lastUpdate)
  })
})

app.on('window-all-closed', () => app.quit())
