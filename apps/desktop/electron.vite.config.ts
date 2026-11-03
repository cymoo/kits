import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@kits/core', '@kits/kernel'] })],
    build: {
      rollupOptions: {
        // Node 内置模块，不能打进包里
        external: ['node:sqlite'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
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
