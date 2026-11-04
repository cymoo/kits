// OpenCode 插件：给 bash 工具加 description 参数，让模型写一句话说明这条命令在做什么，会话页的步骤行拿它当标题。
// 1.19.5 的 bash 只有 command / timeout / workdir，也没有配置项能加参数，只有 tool.definition 钩子能改。
// 这里只改模型看到的参数表，内核的参数校验不变：模型漏写时命令照常跑，界面退回显示命令本身。
// 钩子改不了原参数表（Effect Schema），只能整份替换，升级内核时要对一遍 bash 的参数（契约测试会校验这一份送到了模型）。
// 内核从配置目录的 plugins/ 自动加载，加载前要等 npm 安装结束，所以子进程的 npm 设成了离线（见 opencode.ts 的 spawnEnv）。
// CodeAgent 不加载时只是没有描述。

export const DESCRIBE_BASH_PLUGIN_PATH = 'plugins/kits-describe-bash.js'

const parameters = {
  type: 'object',
  properties: {
    command: { type: 'string', description: 'The command to execute' },
    description: {
      type: 'string',
      description:
        '用一句中文说明这条命令在做什么，不超过 20 个字，会作为这一步的标题显示给用户。例：跑积分模块的测试',
    },
    timeout: { type: 'number', description: 'Optional timeout in milliseconds' },
    workdir: {
      type: 'string',
      description:
        "The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.",
    },
  },
  required: ['command', 'description'],
  additionalProperties: false,
}

export const DESCRIBE_BASH_PLUGIN = `// kits 生成，改了会被覆盖
const parameters = ${JSON.stringify(parameters, null, 2)}

export const KitsDescribeBash = async () => ({
  'tool.definition': async (input, output) => {
    if (input.toolID === 'bash') output.jsonSchema = parameters
  },
})
`
