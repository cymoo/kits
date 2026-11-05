import { spawn } from 'node:child_process'
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
  // 用同一份用户数据再启动一次，和用户再双击一次一样；等这个进程退出
  launchAgain(): Promise<void>
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
  // 默认跳过首次引导和“打开上次的会话”以外的启动跳转；测引导的用例传 KITS_SKIP_ONBOARDING: '0'
  Object.assign(
    merged,
    {
      KITS_CONFIG_DIR: configDir,
      KITS_USER_DATA_DIR: userDataDir,
      KITS_WORKSPACE_DIR: path.join(root, 'kits-workspace'),
      KITS_SKIP_ONBOARDING: '1',
      // 窗口全透明，跑测试时还能干活；要看窗口就设 E2E_HEADED=1
      KITS_HIDDEN_WINDOW: process.env.E2E_HEADED ? '0' : '1',
    },
    env,
  )
  const app = await electron.launch({ args: [main], env: merged })
  const page = await app.firstWindow()
  return {
    app,
    page,
    configDir,
    userDataDir,
    async launchAgain() {
      const electronPath = await app.evaluate(() => process.execPath)
      await new Promise<void>((resolve, reject) => {
        const second = spawn(electronPath, [main], { env: merged, stdio: 'ignore' })
        second.once('error', reject)
        second.once('exit', () => resolve())
      })
    },
    async close() {
      await app.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

// 快捷键的修饰键：mac 用 ⌘，其他平台用 Ctrl
export const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
