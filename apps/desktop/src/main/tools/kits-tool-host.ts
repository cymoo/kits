import {
  createKitsToolServer,
  type KitsToolHandlers,
  type KitsToolHttpServer,
  startKitsToolHttpServer,
  ToolCallRegistry,
} from '@kits/core'

// kits 工具服务的宿主（phase1-implementation 5.3 节）：一个应用一个 HTTP MCP 服务，所有内核和会话共用。
// 提问由会话服务接上（PR8）；产出和记忆接上之前丢掉。
// 会话关联：会话服务看到 kits 工具的 tool-start 时调 register，工具服务收到调用时按参数匹配。

const fallback: KitsToolHandlers = {
  askUser: async (input) => ({
    answered: false,
    ...(input.assumption ? { assumption: input.assumption } : {}),
  }),
  outputSchema: () => undefined,
  onOutput: async () => {},
  remember: async () => {},
}

export class KitsToolHost {
  readonly registry = new ToolCallRegistry()
  private handlers: KitsToolHandlers = fallback
  private server: Promise<KitsToolHttpServer> | undefined

  setHandlers(handlers: KitsToolHandlers): void {
    this.handlers = handlers
  }

  // 现在生效的处理函数，Mock 内核直接调它们
  get current(): KitsToolHandlers {
    return this.handlers
  }

  start(): Promise<KitsToolHttpServer> {
    this.server ??= startKitsToolHttpServer({
      createServer: () =>
        createKitsToolServer({
          // 每次调用时取当前的处理函数，setHandlers 之后不用重启服务
          handlers: {
            askUser: (input, ctx) => this.handlers.askUser(input, ctx),
            outputSchema: (ctx) => this.handlers.outputSchema(ctx),
            onOutput: (output, ctx) => this.handlers.onOutput(output, ctx),
            remember: (input, ctx) => this.handlers.remember(input, ctx),
          },
          resolveSession: (tool, input) => this.registry.match(tool, input),
        }),
    })
    return this.server
  }

  async stop(): Promise<void> {
    const server = await this.server
    this.server = undefined
    await server?.close()
  }
}
