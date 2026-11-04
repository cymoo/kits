import os from 'node:os'
import path from 'node:path'

// 用户配置在 ~/.kits/（人能直接改、能用 Git 管），运行数据在 Electron 的 userData 目录（phase1-implementation 2.3 节）。
// E2E 和本地调试用 KITS_CONFIG_DIR / KITS_USER_DATA_DIR / KITS_WORKSPACE_DIR 指到临时目录，不碰真实数据。

export function resolveConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.KITS_CONFIG_DIR ? path.resolve(env.KITS_CONFIG_DIR) : path.join(os.homedir(), '.kits')
}

// 没选工作目录时用的默认目录。不用家目录本身：Agent 会在工作目录里读写文件
export function resolveWorkspaceDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.KITS_WORKSPACE_DIR
    ? path.resolve(env.KITS_WORKSPACE_DIR)
    : path.join(os.homedir(), 'kits-workspace')
}

export interface ConfigPaths {
  dir: string
  settings: string
  mcp: string
  memory: string
  agents: string
  skills: string
}

export function configPaths(dir: string): ConfigPaths {
  return {
    dir,
    settings: path.join(dir, 'settings.json'),
    mcp: path.join(dir, 'mcp.json'),
    memory: path.join(dir, 'memory.md'),
    agents: path.join(dir, 'agents'),
    skills: path.join(dir, 'skills'),
  }
}
