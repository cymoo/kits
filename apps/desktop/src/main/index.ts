import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { gatewaySecretKey } from '@kits/core'
import { app, BrowserWindow } from 'electron'
import { ConfigService } from './config/config-service'
import { resolveConfigDir } from './config/paths'
import { SecretStore } from './config/secrets'
import { openDatabase } from './db'
import { testGateway } from './gateway/gateway-client'
import { push, registerIpc } from './ipc/register'
import { kernelInfo, kernelLogsDir } from './kernel/kernel-info'
import { createKernelManager } from './kernel/runtime'
import { createElectronPlatform } from './platform'
import { KitsToolHost } from './tools/kits-tool-host'

// 主进程入口：读配置、打开数据库、注册 IPC、开窗口。会话、内核等按模块往里加。

declare const __KITS_VERSION__: string

// 开发时不设名字，userData 会落在 …/Application Support/Electron 下
app.setName('kits')

// E2E 和本地调试可以指定独立的用户数据目录，不碰真实数据。必须在 app ready 之前设置。
if (process.env.KITS_USER_DATA_DIR) {
  app.setPath('userData', process.env.KITS_USER_DATA_DIR)
}

let shutdown: (() => Promise<void>) | undefined

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
  const secrets = new SecretStore(
    path.join(platform.userDataDir, 'secrets.json'),
    platform.encryptor,
  )
  const tools = new KitsToolHost()
  // 设置变了要重启内核、内核启动要读设置，两边互相引用
  let onConfigChanged = () => {}
  const config = new ConfigService({
    dir: resolveConfigDir(),
    onSettingsChanged: (settings) => {
      push('settings.changed', settings)
      onConfigChanged()
    },
  })
  const kernels = createKernelManager({
    platform,
    config,
    secrets,
    tools,
    onStatus: (status) => push('kernel.status', status),
  })
  onConfigChanged = () => kernels.configChanged()

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
    gateway: {
      test: ({ baseUrl, apiKey, gatewayId }) => {
        const key = apiKey ?? (gatewayId ? secrets.get(gatewaySecretKey(gatewayId)) : undefined)
        return testGateway(key ? { baseUrl, apiKey: key } : { baseUrl })
      },
    },
    kernel: {
      status: () =>
        kernelInfo({
          userDataDir: platform.userDataDir,
          resourcesPath: platform.resourcesPath,
          runtime: (id) => kernels.status(id),
          mock: process.env.KITS_KERNEL === 'mock',
        }),
      restart: (id) => kernels.restart(id),
      openLogs: async (id) => {
        const dir = kernelLogsDir(platform.userDataDir, id)
        mkdirSync(dir, { recursive: true })
        await platform.openPath(dir)
      },
    },
    secrets: {
      set: ({ key, value }) => secrets.set(key, value),
      has: (key) => secrets.has(key),
      remove: (key) => secrets.remove(key),
    },
  })

  // 退出时关掉内核子进程和工具服务，不留孤儿进程
  shutdown = async () => {
    await kernels.dispose()
    await tools.stop()
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  void shutdown?.()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
