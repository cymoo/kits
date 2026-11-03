import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import { ConfigService } from './config/config-service'
import { resolveConfigDir } from './config/paths'
import { SecretStore } from './config/secrets'
import { openDatabase } from './db'
import { push, registerIpc } from './ipc/register'
import { createElectronPlatform } from './platform'

// 主进程入口：读配置、打开数据库、注册 IPC、开窗口。会话、内核等按模块往里加。

declare const __KITS_VERSION__: string

// 开发时不设名字，userData 会落在 …/Application Support/Electron 下
app.setName('kits')

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
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'kits',
    backgroundColor: '#F6F5F2',
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
  openDatabase(path.join(platform.userDataDir, 'kits.db'), migrationsFolder())
  const config = new ConfigService({
    dir: resolveConfigDir(),
    onSettingsChanged: (settings) => push('settings.changed', settings),
  })
  const secrets = new SecretStore(
    path.join(platform.userDataDir, 'secrets.json'),
    platform.encryptor,
  )

  registerIpc({
    app: {
      info: () => ({
        version: platform.version,
        os: platform.os,
        electron: process.versions.electron,
        node: process.versions.node,
        configDir: config.paths.dir,
        userDataDir: platform.userDataDir,
      }),
      openExternal: (url) => platform.openExternal(url),
      openPath: (target) => platform.openPath(target),
    },
    settings: {
      get: () => config.getSettings(),
      update: (patch) => config.updateSettings(patch),
      loadError: () => config.loadError ?? null,
    },
    secrets: {
      set: ({ key, value }) => secrets.set(key, value),
      has: (key) => secrets.has(key),
      remove: (key) => secrets.remove(key),
    },
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
