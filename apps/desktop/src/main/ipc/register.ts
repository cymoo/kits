import { channelName, contractEntries, type IpcHandlers, type PushEvents } from '@kits/core/ipc'
import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from 'electron'

// 按 core/ipc.ts 的契约逐个 handle；handlers 少一个方法或类型不对，编译就报错。
// 每次调用先看是谁发的：只认应用自己页面的主 frame，别的来源（被导航到的外部页面、iframe）一律拒绝。
export function registerIpc(handlers: IpcHandlers, isTrusted: (url: string) => boolean): void {
  for (const [domain, method] of contractEntries()) {
    const fn = (handlers[domain] as Record<string, (input: unknown) => unknown>)[method]
    if (!fn) throw new Error(`missing ipc handler ${domain}.${method}`)
    ipcMain.handle(channelName(domain, method), (event, input) => {
      if (!trustedSender(event, isTrusted)) throw new Error('ipc call from an untrusted frame')
      return fn(input)
    })
  }
}

function trustedSender(event: IpcMainInvokeEvent, isTrusted: (url: string) => boolean): boolean {
  const frame = event.senderFrame
  return !!frame && frame === event.sender.mainFrame && isTrusted(frame.url)
}

// 应用自己的页面：开发时是 electron-vite 的地址，打包后是 resources 里的 index.html
export function trustedUrl(entry: string): (url: string) => boolean {
  const base = new URL(entry)
  return (url) => {
    try {
      const u = new URL(url)
      return base.protocol === 'file:'
        ? u.protocol === 'file:' && u.pathname === base.pathname
        : u.origin === base.origin
    } catch {
      return false
    }
  }
}

// 推给所有窗口
export function push<C extends keyof PushEvents>(channel: C, payload: PushEvents[C]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}
