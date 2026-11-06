import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveKernelBinary } from '../binary'
import { prependPath } from './child'
import { opencodeDialect, skipPluginInstall, spawnEnv } from './opencode'

// 契约测试：启动真实的 opencode serve，验证方言层的启动、就绪判断和关闭。不调模型。
const binary = resolveKernelBinary('opencode', {
  platform: process.platform,
  arch: process.arch,
  env: process.env,
})

const cfg = {
  binary: binary ?? '',
  configDir: '/kits/config',
  dataDir: '/kits/data',
  env: { KITS_GW_CORP_KEY: 'test' },
}

describe('skipPluginInstall', () => {
  it('marks the plugin package as installed in both config dirs', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'kits-skip-'))
    try {
      const configDir = path.join(root, 'config')
      const dataDir = path.join(root, 'data')
      skipPluginInstall({ configDir, dataDir })
      for (const dir of [configDir, path.join(dataDir, 'opencode')]) {
        expect(existsSync(path.join(dir, 'node_modules'))).toBe(true)
        const lock = JSON.parse(readFileSync(path.join(dir, 'package-lock.json'), 'utf8'))
        expect(lock.packages[''].dependencies).toHaveProperty('@opencode-ai/plugin')
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps a lock file the kernel already wrote', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'kits-skip-'))
    try {
      const configDir = path.join(root, 'config')
      mkdirSync(configDir)
      writeFileSync(path.join(configDir, 'package-lock.json'), '{"name":"real"}')
      skipPluginInstall({ configDir, dataDir: path.join(root, 'data') })
      expect(readFileSync(path.join(configDir, 'package-lock.json'), 'utf8')).toBe(
        '{"name":"real"}',
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('spawnEnv', () => {
  it('points every XDG home and the opencode home at the kits data dir', () => {
    const env = spawnEnv(cfg, {})
    const keys = [
      'XDG_DATA_HOME',
      'XDG_CACHE_HOME',
      'XDG_CONFIG_HOME',
      'XDG_STATE_HOME',
      'OPENCODE_TEST_HOME',
    ]
    for (const key of keys) expect(env[key]).toBe('/kits/data')
  })

  it('leaves npm alone for the commands and mcp servers the kernel starts', () => {
    const env = spawnEnv(cfg, {})
    expect(Object.keys(env).filter((k) => k.toLowerCase().startsWith('npm_'))).toEqual([])
  })

  it('disables autoupdate, claude code config and network downloads but keeps project skills', () => {
    const env = spawnEnv(cfg, {})
    expect(env.OPENCODE_DISABLE_AUTOUPDATE).toBe('1')
    // 项目的 .agents/skills 靠内核自己的外部技能发现
    expect(env.OPENCODE_DISABLE_EXTERNAL_SKILLS).toBeUndefined()
    expect(env.OPENCODE_DISABLE_CLAUDE_CODE).toBe('1')
    expect(env.OPENCODE_DISABLE_MODELS_FETCH).toBe('1')
    expect(env.OPENCODE_DISABLE_LSP_DOWNLOAD).toBe('1')
    expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe('1')
  })

  it('overrides inherited XDG variables and passes the secret env through', () => {
    const env = spawnEnv(cfg, { XDG_DATA_HOME: '/home/me/.local/share', KITS_GW_CORP_KEY: 'mine' })
    expect(env.XDG_DATA_HOME).toBe('/kits/data')
    expect(env.KITS_GW_CORP_KEY).toBe('test')
  })
})

describe('toolsDir', () => {
  it('goes first on PATH so the kernel finds rg without downloading it', () => {
    const env = spawnEnv({ ...cfg, toolsDir: '/kits/rg' }, { PATH: '/bin' })
    expect(env.PATH?.split(path.delimiter)).toEqual(['/kits/rg', '/bin'])
  })

  it('keeps the name of a Windows style Path variable', () => {
    const env = prependPath({ Path: 'C:\\Windows' }, 'C:\\kits', ';')
    expect(env).toEqual({ Path: 'C:\\kits;C:\\Windows' })
  })

  it('leaves PATH alone without a tools dir', () => {
    expect(spawnEnv(cfg, { PATH: '/bin' }).PATH).toBe('/bin')
  })
})

describe.skipIf(!binary)('opencodeDialect.spawn', () => {
  it('starts opencode serve with per-instance auth and reports healthy', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'kits-opencode-'))
    const dataDir = path.join(root, 'data')
    // 家目录级配置的 fixture：放在 dataDir 下的 .opencode/，只有 home 被重定向到 dataDir 时才会被加载
    mkdirSync(path.join(dataDir, '.opencode'), { recursive: true })
    writeFileSync(
      path.join(dataDir, '.opencode', 'opencode.json'),
      JSON.stringify({ username: 'kits-fixture' }),
    )
    const kernel = await opencodeDialect.spawn({
      ...cfg,
      configDir: path.join(root, 'config'),
      dataDir,
    })
    try {
      const anonymous = await fetch(`${kernel.baseUrl}/global/health`)
      expect(anonymous.status).toBe(401)
      const res = await fetch(`${kernel.baseUrl}/global/health`, { headers: kernel.headers })
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ healthy: true })

      // 隔离：XDG 数据落在 dataDir，home 级配置从 dataDir/.opencode 读而不是用户家目录
      expect(existsSync(path.join(dataDir, 'opencode'))).toBe(true)
      const config = await fetch(`${kernel.baseUrl}/config`, { headers: kernel.headers })
      expect(config.status).toBe(200)
      expect(await config.json()).toMatchObject({ username: 'kits-fixture' })
    } finally {
      await kernel.close()
      rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)
})
