import { app, BrowserWindow, dialog, safeStorage, shell } from 'electron'
import type { Encryptor } from './config/secrets'

declare const __KITS_VERSION__: string

// 平台相关的代码收在这里，以后加 Web 版不动页面。

export interface PlatformBridge {
  readonly os: NodeJS.Platform
  readonly userDataDir: string
  readonly resourcesPath: string | undefined
  readonly isPackaged: boolean
  readonly version: string
  readonly encryptor: Encryptor
  openExternal(url: string): Promise<void>
  openPath(path: string): Promise<void>
  // 在访达 / 资源管理器里选中
  revealPath(path: string): void
  // 系统的目录选择框；取消时返回 null
  pickDirectory(): Promise<string | null>
  // 移到废纸篓 / 回收站（删 Agent 文件用，删错了能找回来）
  trashPath(path: string): Promise<void>
}

export function createElectronPlatform(): PlatformBridge {
  return {
    os: process.platform,
    userDataDir: app.getPath('userData'),
    resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
    isPackaged: app.isPackaged,
    version: app.isPackaged ? app.getVersion() : __KITS_VERSION__,
    encryptor: {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (text) => safeStorage.encryptString(text),
      decrypt: (data) => safeStorage.decryptString(data),
    },
    // 只放行 http(s)，别的协议（file:、自定义协议）不交给系统打开
    openExternal: async (url) => {
      if (!/^https?:\/\//i.test(url)) throw new Error(`refusing to open ${url}`)
      await shell.openExternal(url)
    },
    pickDirectory: async () => {
      const win = BrowserWindow.getFocusedWindow()
      const options = { properties: ['openDirectory' as const, 'createDirectory' as const] }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    revealPath: (target) => shell.showItemInFolder(target),
    openPath: async (target) => {
      const error = await shell.openPath(target)
      if (error) throw new Error(error)
    },
    trashPath: (target) => shell.trashItem(target),
  }
}
