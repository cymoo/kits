import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { type AskUserInput, type AskUserResult, askUserInputSchema } from './ask-user'
import { validateOutput } from './submit-output'

// kits 的本机 MCP 服务：把 ask_user / submit_output 提供给内核。
// 传输层（stdio 或 HTTP）由主进程决定，这里只定义工具。

export interface KitsToolHandlers {
  askUser(input: AskUserInput): Promise<AskUserResult>
  onOutput(output: unknown): Promise<void>
}

export interface KitsToolServerOptions {
  handlers: KitsToolHandlers
  // Agent 设置了输出格式时才提供 submit_output
  outputSchema?: Record<string, unknown>
}

export function createKitsToolServer(options: KitsToolServerOptions): McpServer {
  const server = new McpServer({ name: 'kits', version: '0.1.0' })

  server.registerTool(
    'ask_user',
    {
      description: '向用户提问。blocking 为 false 时不等待回答，按 assumption 继续并在结果里注明。',
      inputSchema: askUserInputSchema.shape,
    },
    async (input) => {
      const result = await options.handlers.askUser(askUserInputSchema.parse(input))
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    },
  )

  if (options.outputSchema) {
    const schema = options.outputSchema
    server.registerTool(
      'submit_output',
      {
        description: [
          '提交结构化结果。output 必须符合下面的 JSON Schema，不符合时返回错误，请修正后重新提交。',
          '',
          JSON.stringify(schema, null, 2),
        ].join('\n'),
        inputSchema: { output: z.unknown().describe('符合工具描述里 JSON Schema 的结果') },
      },
      async ({ output }) => {
        const result = validateOutput(schema, output)
        if (!result.ok) {
          return {
            isError: true,
            content: [{ type: 'text', text: `输出不符合格式：\n${result.errors.join('\n')}` }],
          }
        }
        await options.handlers.onOutput(result.output)
        return { content: [{ type: 'text', text: '已提交' }] }
      },
    )
  }

  return server
}
