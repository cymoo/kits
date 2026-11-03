import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  main: {
    // 开发时 app.getVersion() 拿到的是 Electron 的版本，版本号从 package.json 编进来
    define: { __KITS_VERSION__: JSON.stringify(pkg.version) },
    plugins: [externalizeDepsPlugin({ exclude: ['@kits/core', '@kits/kernel'] })],
    build: {
      rollupOptions: {
        // Node 内置模块，不能打进包里
        external: ['node:sqlite'],
      },
    },
  },
  preload: {
    // sandbox 的 preload 不能 require 工作区的包，IPC 契约要打进来
    plugins: [externalizeDepsPlugin({ exclude: ['@kits/core'] })],
    build: {
      rollupOptions: {
        // sandbox: true 的 preload 必须是 CommonJS
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
  },
})
