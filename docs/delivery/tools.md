# 交付说明：tools

## 2026-11-04　kits 工具服务走 HTTP，加 remember 和会话关联

> 日期：2026-11-04　PR：见本分支 `feat/tools-http`　作者：Claude Code

### 原始需求

[phase1-implementation.md](../plans/phase1-implementation.md) 第 8 节 PR3，对应 5.3 节：kits 工具服务（`ask_user`、`submit_output`、`remember`）补 HTTP 传输和 token，加 `remember`，解决“MCP 调用不带会话 id”的会话关联；内存 transport 单测，契约测试里由真实内核调用。第 9 节的两条风险（会话关联靠事件匹配、阻塞提问会不会被内核掐断）在本 PR 核对。

做到什么程度算完：真实 `opencode serve` 按生成的配置连上 kits 工具服务，四种调用（不阻塞提问、阻塞提问、提交产出、记忆）都能对到发起它的会话，阻塞提问挂着时内核不超时。

### 怎么验收

1. `pnpm check` 全绿。
2. `pnpm vitest run --project kernel kits-tools --reporter verbose`：`kits tools called by opencode serve` 下 4 个契约用例，真实内核经 HTTP MCP 调 kits 工具；另有 `kits tool call timeout` 1 个：
   - 不阻塞提问：处理函数拿到的 `sessionId` 就是发起它的会话，参数补齐了默认的 `blocking: false`，模型拿到 `{ answered: false, assumption: '测试环境' }` 后继续；
   - 阻塞提问：处理函数挂 8 s 才回答，这一轮耗时不少于 8 s，工具没有报错，模型拿到“用预发环境”；
   - 提交产出：有输出格式的 Agent 提交 `{ n: 1 }`，校验通过，记到对应会话；
   - 记忆：默认 `scope: project`，记到对应会话；
   - 超时：把 kits 服务的 `timeout` 调到 2 s、处理函数挂 5 s，工具以错误结束。说明这个字段管的就是调用超时。
3. `pnpm vitest run --project core server --reporter verbose`：工具列表、按会话的输出格式校验、没有输出格式时拒绝、HTTP 不带 token 或 token 错返回 401、带 token 的 MCP 客户端能用；关联表的 5 个用例（同参数两个会话按先后对上、参数顺序和默认值不影响匹配、调用先到事件后到时会等、超过 10 s 的登记作废）。

### 主要改动

- `packages/core/src/tools/`：
  - `http-transport.ts`：`startKitsToolHttpServer`，MCP Streamable HTTP，只监听 `127.0.0.1` 的随机端口，每次启动随机 token，`Authorization: Bearer <token>` 用定长比较。无状态模式：每个请求新建 MCP 服务和传输，阻塞提问只占它自己那个请求；关掉 Node 的请求超时，阻塞提问不会被 HTTP 服务器自己掐掉。
  - `server.ts`：三个工具固定注册，处理函数多一个 `ctx.sessionId`。一个内核进程所有会话共用一个工具服务，`submit_output` 的格式按调用它的会话的 Agent 校验，没有格式时返回错误。
  - `correlation.ts`：`ToolCallRegistry`。适配器看到 `kits_*` 工具的 `tool-start` 就按“工具名 + 参数”登记，工具服务收到调用时匹配 10 s 内的登记，调用比事件先到时最多等 2 s。两边都先按工具的 schema 解析参数再比（工具服务拿到的参数补过默认值、去过多余字段）。
  - `remember.ts`：`remember(text, scope)` 的参数，`scope` 默认 `project`。
- `packages/kernel/src/generate/opencode-config.ts`：
  - 有输出格式的 Agent，把 JSON Schema 作为“输出格式”一节追加到它的提示词里。工具描述是所有会话共用的，放不下各 Agent 的格式。
  - kits 服务加 `timeout: 86400000`（24 小时）。**实测 1.19.5 默认 60 s 就掐断 MCP 工具调用**：挂 130 s 的阻塞提问在 60.2 s 时被内核结束；配上 `timeout` 后挂 70 s 的照常拿到回答。这就是第 9 节“阻塞时内核对 MCP 调用有没有超时”那条风险的结论：有，60 s，可配，阻塞式提问保留。两个长时间的实验没进 CI（太慢），CI 里跑的是上面 2 s 的反向用例。
- 和方案不一样的地方：5.3 节说“匹配不到就按最近一个在跑的会话兜底”。兜底依赖会话服务知道哪些会话在跑，放在 PR7 的会话服务里做，工具服务这一层只把 `sessionId: undefined` 交给处理函数。
- 没有界面改动，没有数据库 schema 改动，没有新依赖。

### 测试

- 单元测试：`packages/core/src/tools/server.test.ts`（工具服务 5 个、关联表 5 个、HTTP 传输 2 个）；`opencode-config.test.ts` 补“输出格式写进提示词”。
- 契约测试：`packages/kernel/src/adapter/kits-tools.contract.test.ts`（真实 opencode serve + 4 个假网关，各让模型调一个 kits 工具）。

### 新增依赖

无（`@modelcontextprotocol/sdk` 已有，HTTP 传输是它自带的）。

### 已知问题

- 工具服务的宿主（主进程里起服务、把事件流里的 `tool-start` 登记到关联表、`ask_user` 接到界面、`remember` 写文件）在 PR7 会话服务里接；本 PR 的契约测试里这段胶水写在测试里。
- 关联靠参数匹配：两个会话在 10 s 内用一模一样的参数调同一个工具时按先后对上，极端情况下可能对反（两边的事件到达顺序和调用顺序不一致）。对 `ask_user` 来说问题和参数都一样，对反了影响很小。
