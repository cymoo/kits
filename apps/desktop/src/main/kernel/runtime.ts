import type { KernelName } from '@kits/core/ipc'
import {
  type AgentKernel,
  codeagentDialect,
  MockKernel,
  type MockScenarioName,
  mockScenarioNames,
  OpencodeFamilyKernel,
  opencodeDialect,
  resolveKernelBinary,
  toCodeagentFiles,
} from '@kits/kernel'
import type { ConfigService } from '../config/config-service'
import type { SecretStore } from '../config/secrets'
import type { PlatformBridge } from '../platform'
import type { KitsToolHost } from '../tools/kits-tool-host'
import { kernelDirs, logFileFor, prepareKernelConfig } from './kernel-config'
import { KernelManager, type PrepareResult } from './kernel-manager'

// 把 KernelManager 接到真实环境：OpenCode、CodeAgent 走同一个适配器、各自的方言，
// KITS_KERNEL=mock 时用 Mock 内核（E2E、界面开发）。

export interface KernelRuntimeDeps {
  platform: PlatformBridge
  config: ConfigService
  secrets: SecretStore
  tools: KitsToolHost
  onStatus: ConstructorParameters<typeof KernelManager>[0]['onStatus']
  env?: NodeJS.ProcessEnv
  // resources/builtin：内置技能
  builtinDir?: string
}

function mockScenario(env: NodeJS.ProcessEnv): MockScenarioName {
  const name = env.KITS_MOCK_SCENARIO
  return name && (mockScenarioNames as readonly string[]).includes(name)
    ? (name as MockScenarioName)
    : 'done'
}

export function createKernelManager(deps: KernelRuntimeDeps): KernelManager {
  const env = deps.env ?? process.env
  const mock = env.KITS_KERNEL === 'mock'

  const create = (id: KernelName): AgentKernel => {
    if (mock) {
      return new MockKernel({
        scenario: mockScenario(env),
        tools: {
          askUser: (input, ctx) => deps.tools.current.askUser(input, ctx),
          outputSchema: (ctx) => deps.tools.current.outputSchema(ctx),
          onOutput: (output, ctx) => deps.tools.current.onOutput(output, ctx),
        },
        speed: Number(env.KITS_MOCK_SPEED ?? 1),
      })
    }
    return new OpencodeFamilyKernel(id === 'codeagent' ? codeagentDialect : opencodeDialect)
  }

  const prepare = async (id: KernelName): Promise<PrepareResult> => {
    const dirs = kernelDirs(deps.platform.userDataDir, id)
    if (mock)
      return { ok: true, cfg: { binary: '', configDir: dirs.config, dataDir: dirs.data, env: {} } }
    const binary = resolveKernelBinary(id, {
      platform: process.platform,
      arch: process.arch,
      env,
      ...(deps.platform.resourcesPath ? { resourcesPath: deps.platform.resourcesPath } : {}),
    })
    if (!binary) {
      return { ok: false, problems: [{ section: 'model', target: id, message: '内核没有安装' }] }
    }
    const tools = await deps.tools.start()
    const generated = prepareKernelConfig({
      config: deps.config,
      secrets: deps.secrets,
      kitsTools: { url: tools.url, token: tools.token },
      env,
      ...(deps.builtinDir ? { builtinDir: deps.builtinDir } : {}),
    })
    if (!generated.ok) return { ok: false, problems: generated.problems }
    // 两个内核的配置字段一样，CodeAgent 只是文件名不同（generate/codeagent-config.ts）
    const files = id === 'codeagent' ? toCodeagentFiles(generated.files) : generated.files
    await (id === 'codeagent' ? codeagentDialect : opencodeDialect).writeConfig(dirs.config, files)
    return {
      ok: true,
      cfg: {
        binary,
        configDir: dirs.config,
        dataDir: dirs.data,
        env: files.env,
        logFile: logFileFor(dirs),
      },
    }
  }

  return new KernelManager({
    create,
    prepare,
    ...(deps.onStatus ? { onStatus: deps.onStatus } : {}),
  })
}
