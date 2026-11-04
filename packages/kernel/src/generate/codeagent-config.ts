import type { GeneratedFiles } from '../kernel'
import { DESCRIBE_BASH_PLUGIN_PATH } from './describe-bash-plugin'

// CodeAgent 的配置（phase1-implementation 4.3 节）：文档“Global.Config”一章的字段和 opencode.json 一样
// （model、provider、agent、mcp、permission、instructions、enabled_providers …），所以直接用 OpenCode 的转换结果，
// 只改文件名、去掉 OpenCode 的 $schema。权限不写 settings.json 的 permissions.defaultMode
// （SDK 默认不读它，要 SDK_LOAD_SETTINGS_PERMISSIONS），kits 的权限照旧写在配置的 permission 和建会话的规则里。
// 文件名文档没写：先写 codeagent.json，启动后读 GET /global/config 核对，没读到就用 PATCH 补上（dialects/codeagent.ts）。
// 真机待验，见 docs/references/codeagent-checklist.md。

export const CODEAGENT_CONFIG_FILE = 'codeagent.json'

export function toCodeagentFiles(opencode: GeneratedFiles): GeneratedFiles {
  return {
    env: opencode.env,
    // describe-bash 插件先不给 CodeAgent：真机没验过，加载前等 npm 的话内网会卡启动。没有描述时界面显示命令本身
    files: opencode.files
      .filter((f) => f.path !== DESCRIBE_BASH_PLUGIN_PATH)
      .map((f) => {
        if (f.path !== 'opencode.json') return f
        const { $schema: _, ...config } = JSON.parse(f.content) as Record<string, unknown>
        return { path: CODEAGENT_CONFIG_FILE, content: `${JSON.stringify(config, null, 2)}\n` }
      }),
  }
}

// 配置里的 {env:NAME} 换成值（PATCH /global/config 时用：接口收到的是 JSON，不会再替换环境变量）
export function resolveEnvRefs(value: unknown, env: Record<string, string | undefined>): unknown {
  if (typeof value === 'string') {
    return value.replace(
      /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g,
      (all, name: string) => env[name] ?? all,
    )
  }
  if (Array.isArray(value)) return value.map((v) => resolveEnvRefs(v, env))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveEnvRefs(v, env)]))
  }
  return value
}
