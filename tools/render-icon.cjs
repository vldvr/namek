// Рисует иконку из tools/icon.html: npx electron tools/render-icon.cjs
const { app, BrowserWindow } = require('electron')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } })
  await win.loadFile(join(__dirname, 'icon.html'))
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
  await new Promise((r) => setTimeout(r, 300))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  const root = join(__dirname, '..')
  mkdirSync(join(root, 'build'), { recursive: true })
  writeFileSync(join(root, 'build/icon.png'), img.resize({ width: 1024, height: 1024 }).toPNG())
  writeFileSync(join(root, 'resources/icon.png'), img.resize({ width: 256, height: 256, quality: 'best' }).toPNG())
  app.quit()
})
