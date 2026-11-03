import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { gatewaySecretKey } from '@kits/core'
import { app, BrowserWindow, shell } from 'electron'
import { ConfigService } from './config/config-service'
import { resolveConfigDir } from './config/paths'
import { SecretStore } from './config/secrets'
import { openDatabase } from './db'
import { testGateway } from './gateway/gateway-client'
import { push, registerIpc, trustedUrl } from './ipc/register'
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

function rendererEntry(): string {
  return !app.isPackaged && process.env.ELECTRON_RENDERER_URL
    ? process.env.ELECTRON_RENDERER_URL
    : pathToFileURL(path.join(import.meta.dirname, '../renderer/index.html')).href
}

const isTrusted = trustedUrl(rendererEntry())

function createWindow(onFocus: () => void): void {
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
  // 窗口只显示应用自己的页面：站外链接交给系统浏览器，不在窗口里打开、不让页面跳走
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrusted(url)) event.preventDefault()
  })
  win.on('focus', onFocus)
  void win.loadURL(rendererEntry())
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

  registerIpc(
    {
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
        loadError: () => config.loadError ?? secrets.loadError ?? null,
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
      // 网关 key、MCP 变量都经内核子进程的环境变量传进去，改了也要按新配置重启
      secrets: {
        set: ({ key, value }) => {
          secrets.set(key, value)
          kernels.configChanged()
        },
        has: (key) => secrets.has(key),
        remove: (key) => {
          secrets.remove(key)
          kernels.configChanged()
        },
      },
    },
    isTrusted,
  )

  // 退出时关掉内核子进程和工具服务，不留孤儿进程
  shutdown = async () => {
    await kernels.dispose()
    await tools.stop()
  }

  // 窗口回到前台时看一眼 settings.json 有没有被人改过
  const onFocus = () => void config.reloadIfChanged()
  createWindow(onFocus)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(onFocus)
  })
})

// will-quit 不等异步清理：先拦下退出，清理完再真的退（只做一次）
let quitting = false
app.on('will-quit', (event) => {
  if (quitting || !shutdown) return
  event.preventDefault()
  quitting = true
  void shutdown()
    .catch(() => {})
    .finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
