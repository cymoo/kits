import { contextBridge, ipcRenderer } from 'electron'

// 渲染进程只能通过这里和主进程说话。

const kits = {
  os: process.platform,
  versions: { electron: process.versions.electron, node: process.versions.node },
  ping: (): Promise<{ pong: boolean; os: string; sessions: number }> => ipcRenderer.invoke('ping'),
}

export type KitsApi = typeof kits

contextBridge.exposeInMainWorld('kits', kits)
