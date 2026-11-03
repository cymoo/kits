import {
  createKitsToolServer,
  type KitsToolHandlers,
  type KitsToolHttpServer,
  startKitsToolHttpServer,
  ToolCallRegistry,
} from '@kits/core'

// kits 工具服务的宿主（phase1-implementation 5.3 节）：一个应用一个 HTTP MCP 服务，所有内核和会话共用。
// 处理函数由会话服务（PR7）接上；没接之前提问按不阻塞处理、产出和记忆丢掉。
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
    if (this.server) return this.server
    const starting = startKitsToolHttpServer({
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
    this.server = starting
    // 监听失败（比如一时 EMFILE）不能把失败的结果缓存住：清掉，下次内核启动时重试
    starting.catch(() => {
      if (this.server === starting) this.server = undefined
    })
    return starting
  }

  async stop(): Promise<void> {
    const server = await this.server
    this.server = undefined
    await server?.close()
  }
}
