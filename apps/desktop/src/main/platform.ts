import { app, shell } from 'electron'

// 平台相关的代码收在这里，以后加 Web 版不动页面。

export interface PlatformBridge {
  readonly os: NodeJS.Platform
  readonly userDataDir: string
  readonly resourcesPath: string | undefined
  readonly isPackaged: boolean
  openExternal(url: string): Promise<void>
}

export function createElectronPlatform(): PlatformBridge {
  return {
    os: process.platform,
    userDataDir: app.getPath('userData'),
    resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
    isPackaged: app.isPackaged,
    openExternal: (url) => shell.openExternal(url),
  }
}
