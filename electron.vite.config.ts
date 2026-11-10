import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string }

export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: resolve(import.meta.dirname, 'src/main/index.ts') },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve(import.meta.dirname, 'src/preload/index.ts'),
        // Песочница Electron понимает только CommonJS в preload.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    plugins: [react()],
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    build: {
      rollupOptions: { input: resolve(import.meta.dirname, 'src/renderer/index.html') },
    },
  },
})
