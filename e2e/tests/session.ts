import { mkdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'

// 会话类 E2E 的准备：配一个假网关和一个工作目录，返回工作目录的真实路径。extraModels：默认模型之外再加的模型
export async function prepare(
  page: Page,
  configDir: string,
  extraModels: { id: string; vision?: boolean }[] = [],
) {
  const workdir = path.join(path.dirname(configDir), 'member-svc')
  mkdirSync(workdir, { recursive: true })
  const real = realpathSync(workdir)
  await page.evaluate(
    ({ dir, extra }) =>
      window.kits.settings.update({
        gateways: [
          {
            id: 'corp',
            name: '公司网关',
            baseUrl: 'http://127.0.0.1:9/v1',
            enabled: true,
            models: [
              { id: 'coder-main', note: '', contextWindow: 128000, toolCall: true },
              ...extra.map((m) => ({ note: '', contextWindow: 128000, toolCall: true, ...m })),
            ],
          },
        ],
        defaultModel: 'corp/coder-main',
        workdirs: [{ path: dir, lastUsedAt: 0 }],
      }),
    { dir: real, extra: extraModels },
  )
  return real
}
