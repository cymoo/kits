import path from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { openDatabase } from './db'
import { sessions } from './db/schema'
import { createElectronPlatform } from './platform'

// 空壳应用：开一个窗口，打开本机数据库，回应 ping。会话、设置等功能按模块往里加。

// E2E 和本地调试可以指定独立的用户数据目录，不碰真实数据。必须在 app ready 之前设置。
if (process.env.KITS_USER_DATA_DIR) {
  app.setPath('userData', process.env.KITS_USER_DATA_DIR)
}

function migrationsFolder(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'drizzle')
    : path.resolve(import.meta.dirname, '../../drizzle')
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'kits',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
    },
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const platform = createElectronPlatform()
  const { db } = openDatabase(path.join(platform.userDataDir, 'kits.db'), migrationsFolder())

  ipcMain.handle('ping', () => ({
    pong: true,
    os: platform.os,
    sessions: db.select().from(sessions).all().length,
  }))

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
