import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { type AskUserInput, type AskUserResult, askUserInputSchema } from './ask-user'
import { type RememberInput, rememberInputSchema } from './remember'
import { validateOutput } from './submit-output'

// kits 的本机 MCP 服务：把 ask_user / submit_output / remember 提供给内核（phase1-implementation 5.3 节）。
// 一个内核进程连一个服务，所有会话共用，所以工具列表是固定的：
// - 每个调用先按“工具名 + 参数”找到是哪个会话发的（resolveSession），处理函数拿到 sessionId；
// - submit_output 的格式按会话的 Agent 校验；格式本身由配置转换写进 Agent 提示词，
//   没有输出格式的 Agent 在内核配置里关掉这个工具。
// 传输层（HTTP）见 http-transport.ts。

export interface KitsToolContext {
  // 关联不上时为空，处理函数自己决定兜底
  sessionId: string | undefined
}

export interface KitsToolHandlers {
  askUser(input: AskUserInput, ctx: KitsToolContext): Promise<AskUserResult>
  // 会话的 Agent 的输出格式；没有返回 undefined
  outputSchema(ctx: KitsToolContext): Record<string, unknown> | undefined
  onOutput(output: unknown, ctx: KitsToolContext): Promise<void>
  remember(input: RememberInput, ctx: KitsToolContext): Promise<void>
}

export interface KitsToolServerOptions {
  handlers: KitsToolHandlers
  // tool 是不带服务名前缀的工具名（ask_user），input 是模型给的参数
  resolveSession(tool: string, input: unknown): Promise<string | undefined>
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })

export const KITS_TOOL_NAMES = ['ask_user', 'submit_output', 'remember'] as const

export function createKitsToolServer(options: KitsToolServerOptions): McpServer {
  const server = new McpServer({ name: 'kits', version: '0.1.0' })
  const { handlers } = options
  const ctx = async (tool: string, input: unknown): Promise<KitsToolContext> => ({
    sessionId: await options.resolveSession(tool, input),
  })

  server.registerTool(
    'ask_user',
    {
      description: [
        '向用户提问。只在缺少关键信息、而且猜错代价大时用。',
        'blocking 为 false（默认）时不等回答：写上 assumption，按它继续；用户的回答会作为下一条消息发给你。',
        'blocking 为 true 时等用户回答再继续。',
      ].join('\n'),
      inputSchema: askUserInputSchema.shape,
    },
    async (input) => {
      const result = await handlers.askUser(
        askUserInputSchema.parse(input),
        await ctx('ask_user', input),
      )
      return text(JSON.stringify(result))
    },
  )

  server.registerTool(
    'submit_output',
    {
      description:
        '提交结构化结果。output 必须符合提示词里“输出格式”一节的 JSON Schema，不符合时返回错误，请修正后重新提交。',
      inputSchema: { output: z.unknown().describe('符合输出格式 JSON Schema 的结果') },
    },
    async (input) => {
      const context = await ctx('submit_output', input)
      const schema = handlers.outputSchema(context)
      if (!schema) return { isError: true, ...text('当前 Agent 没有设置输出格式，不需要提交。') }
      const result = validateOutput(schema, input.output)
      if (!result.ok) {
        return { isError: true, ...text(`输出不符合格式：\n${result.errors.join('\n')}`) }
      }
      await handlers.onOutput(result.output, context)
      return text('已提交')
    },
  )

  server.registerTool(
    'remember',
    {
      description:
        '记住一条以后的会话还用得上的事实或约定（测试命令、接口约定、用户的偏好），一句话一条。不要记临时状态。',
      inputSchema: rememberInputSchema.shape,
    },
    async (input) => {
      await handlers.remember(rememberInputSchema.parse(input), await ctx('remember', input))
      return text('已记住')
    },
  )

  return server
}
