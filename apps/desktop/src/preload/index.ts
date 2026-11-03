import {
  channelName,
  contractEntries,
  type KitsInvoke,
  type PushChannel,
  type PushEvents,
} from '@kits/core/ipc'
import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron'

// 渲染进程只能通过这里和主进程说话。方法按 core/ipc.ts 的契约生成：window.kits.<域>.<方法>(入参)。

const invoke: Record<string, Record<string, (input?: unknown) => Promise<unknown>>> = {}
for (const [domain, method] of contractEntries()) {
  invoke[domain] ??= {}
  invoke[domain][method] = (input) => ipcRenderer.invoke(channelName(domain, method), input)
}

const kits = {
  ...(invoke as unknown as KitsInvoke),
  os: process.platform,
  // 订阅主进程推送，返回取消订阅的函数
  on<C extends PushChannel>(channel: C, listener: (payload: PushEvents[C]) => void): () => void {
    const handler = (_event: IpcRendererEvent, payload: PushEvents[C]) => listener(payload)
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.off(channel, handler)
    }
  },
}

export type KitsApi = typeof kits

contextBridge.exposeInMainWorld('kits', kits)
