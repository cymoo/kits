// 主进程抛的错：去掉 Electron 加的前缀
export function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
