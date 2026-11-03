import { channelName, contractEntries, type IpcHandlers, type PushEvents } from '@kits/core/ipc'
import { BrowserWindow, ipcMain } from 'electron'

// 按 core/ipc.ts 的契约逐个 handle；handlers 少一个方法或类型不对，编译就报错。
export function registerIpc(handlers: IpcHandlers): void {
  for (const [domain, method] of contractEntries()) {
    const fn = (handlers[domain] as Record<string, (input: unknown) => unknown>)[method]
    if (!fn) throw new Error(`missing ipc handler ${domain}.${method}`)
    ipcMain.handle(channelName(domain, method), (_event, input) => fn(input))
  }
}

// 推给所有窗口
export function push<C extends keyof PushEvents>(channel: C, payload: PushEvents[C]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}
