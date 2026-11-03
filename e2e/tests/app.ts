import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { type ElectronApplication, _electron as electron, type Page } from '@playwright/test'

// 启动打包前的应用（apps/desktop/out，先 pnpm build）。每次用独立的配置目录和数据目录，不碰本机的 ~/.kits 和 kits.db。
// 以后的开关（KITS_KERNEL=mock、KITS_MOCK_SCENARIO、KITS_SKIP_ONBOARDING）从 env 传进来。

const main = path.resolve(import.meta.dirname, '../../apps/desktop/out/main/index.js')

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  configDir: string
  userDataDir: string
  close(): Promise<void>
}

// prepare 在启动前拿到配置目录，用来放预置的 settings.json 等
export async function launchApp(
  env: Record<string, string> = {},
  prepare?: (configDir: string) => void,
): Promise<LaunchedApp> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'kits-e2e-'))
  const configDir = path.join(root, 'config')
  const userDataDir = path.join(root, 'data')
  prepare?.(configDir)
  const merged: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) merged[k] = v
  Object.assign(merged, { KITS_CONFIG_DIR: configDir, KITS_USER_DATA_DIR: userDataDir }, env)
  const app = await electron.launch({ args: [main], env: merged })
  const page = await app.firstWindow()
  return {
    app,
    page,
    configDir,
    userDataDir,
    async close() {
      await app.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

// 快捷键的修饰键：mac 用 ⌘，其他平台用 Ctrl
export const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
