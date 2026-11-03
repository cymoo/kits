import { app, safeStorage, shell } from 'electron'
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
    openPath: async (target) => {
      const error = await shell.openPath(target)
      if (error) throw new Error(error)
    },
  }
}
