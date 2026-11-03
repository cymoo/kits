import type { KernelName } from '@kits/core/ipc'
import {
  type AgentKernel,
  MockKernel,
  type MockScenarioName,
  mockScenarioNames,
  OpencodeFamilyKernel,
  opencodeDialect,
  resolveKernelBinary,
} from '@kits/kernel'
import type { ConfigService } from '../config/config-service'
import type { SecretStore } from '../config/secrets'
import type { PlatformBridge } from '../platform'
import type { KitsToolHost } from '../tools/kits-tool-host'
import { kernelDirs, logFileFor, prepareKernelConfig } from './kernel-config'
import { KernelManager, type PrepareResult } from './kernel-manager'

// 把 KernelManager 接到真实环境：OpenCode 走适配器，KITS_KERNEL=mock 时用 Mock 内核（E2E、界面开发）。
// CodeAgent 的方言在 PR19，现在选它会报“未安装”。

export interface KernelRuntimeDeps {
  platform: PlatformBridge
  config: ConfigService
  secrets: SecretStore
  tools: KitsToolHost
  onStatus: ConstructorParameters<typeof KernelManager>[0]['onStatus']
  env?: NodeJS.ProcessEnv
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
    if (id === 'codeagent') throw new Error('CodeAgent 方言还没接入')
    return new OpencodeFamilyKernel(opencodeDialect)
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
    })
    if (!generated.ok) return { ok: false, problems: generated.problems }
    await opencodeDialect.writeConfig(dirs.config, generated.files)
    return {
      ok: true,
      cfg: {
        binary,
        configDir: dirs.config,
        dataDir: dirs.data,
        env: generated.files.env,
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
