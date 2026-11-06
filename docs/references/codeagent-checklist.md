# CodeAgent 真机核对清单

> 状态：待在 Windows 真机上跑（负责人填“实测结果”）　日期：2026-11-04　对应：phase1-implementation 4.3 节、PR19

CodeAgent 方言（`packages/kernel/src/dialects/codeagent.ts`）按 [codeagent-sdk.md](codeagent-sdk.md) 写，契约测试只对着按文档写的假服务（`packages/kernel/src/testing/fake-codeagent-server.mjs`）跑过。下面每一项在真机上照着做，把结果填进“实测结果”；和文档不一致的，按“不一致时改哪里”改，再给契约测试的假服务补上同样的行为。

## 怎么跑

1. 装好 CodeAgent，确认命令行能跑 `codeagent serve`。
2. 设环境变量 `KITS_CODEAGENT_BIN` 指到 `codeagent.exe`（或 `.cmd` 启动脚本），启动 kits。
3. 设置 → 内核与模型：CodeAgent 卡片显示版本号、不再是“未安装”，选成默认内核。
4. 内核日志在 设置 → 内核与模型 → 内核日志 → 打开目录（`<userData>/kernel/codeagent/logs/`），每一项出问题先看这里。

## 清单

| # | 项目 | 文档怎么说 | 实测结果 | 不一致时改哪里 |
|---|---|---|---|---|
| 1 | 启动参数 | `serve --host 127.0.0.1 --port 0 --token <t> --config-dir <dir>` | | `codeagent.ts` 的 `args` |
| 2 | 就绪行 | stdout 一行 `{"type":"codeagent.server.ready","base_url":…,"auth":{"token":…}}` | | `parseReadyLine` |
| 3 | 鉴权 | `Authorization: Bearer <token>`，也认 `?access_token=` | | 就绪后的 `headers` |
| 4 | 路径前缀 | 所有接口在 `/api/v1` 下 | | `API_PREFIX` |
| 5 | 配置文件 | 文档没写 `--config-dir` 里读哪个文件；kits 写 `codeagent.json`（字段同 opencode.json），就绪后 `GET /global/config` 看 `model` 对不对，不对就 `PATCH /global/config` | 读到了文件 / 走了 PATCH？ | `generate/codeagent-config.ts` 的 `CODEAGENT_CONFIG_FILE`；**走 PATCH 时网关 Key 会以明文进内核的配置，要确认它会不会写到磁盘** |
| 6 | `{env:…}` 引用 | 文档没写；opencode.json 里用 `{env:KITS_GW_…}` 引用子进程环境变量 | | 不支持就只能走 PATCH（见 5） |
| 7 | provider 写法 | `provider.<id> = { npm: "@ai-sdk/openai-compatible", options: { baseURL, apiKey }, models }` 和 OpenCode 一样 | | `generate/opencode-config.ts` 的 provider 段，或在 `toCodeagentFiles` 里改写 |
| 8 | 内网联网开关 | OpenCode 的 `autoupdate: false`、`share: "disabled"`、`lsp: false` CodeAgent 认不认；AI Market、账户相关的联网功能怎么关 | | `toCodeagentFiles` 去掉不认的字段、补 CodeAgent 自己的开关；`codeagentEnv` 补环境变量 |
| 9 | 用户家目录 | kits 只想用自己的配置目录，不读 `~/.cac/settings.json`（SDK 默认不读权限，`SDK_LOAD_SETTINGS_PERMISSIONS` 不设） | 会不会读到 `~/.cac` 里的别的配置？ | `codeagentEnv`（比如再指 `HOME` / `USERPROFILE`） |
| 10 | Agent | `agent.kits-<name>`（`mode: primary`、`model`、`tools`、`permission`），prompt 随消息的 `system` 带 | 建会话、发消息时 `agent: "kits-assistant"` 认不认 | `opencodeAgentEntry` |
| 11 | 建会话 | `POST /session` body 里 `permission: PermissionRule[]` | 规则生效吗（比如只读模式下 `edit` 被拒） | `toOpencodeRuleset` |
| 12 | 发消息 | `POST /session/{id}/prompt_async`，`model: {providerID, modelID}`、`agent`、`system`、`parts` | | 适配器 `prompt` |
| 13 | 事件流 | `GET /event?directory=<目录>`，`message.updated` / `message.part.updated` / `message.part.delta` 和 OpenCode 一样 | 正文、思考、工具步骤都对得上吗 | `adapter/events.ts` |
| 14 | 权限请求 | 事件 `permission.requested`（别名 `permission.asked`），带 `id`、`permission`、`patterns`、`metadata`、`tool.callID` | | `events.ts` 的 `ALIASES` 和 `permission.asked` 分支 |
| 15 | 权限回复 | `POST /permission/{id}/reply` body `{ reply: once \| always \| reject, message? }` | “本会话允许”之后同类命令不再问吗 | `permissionReplyPath` |
| 16 | 结束 | `prompt.completed`（成功）、`prompt.failed`（失败、中止），`session.idle` 兜底 | 三个都会来吗、先后顺序 | `events.ts` |
| 17 | 重试 | `session.next.retried` 带 `attempt`、`error`；有没有“下次什么时候重试”的字段 | 字段名 | `events.ts` 的 `session.next.retried` 分支（现在读 `next`） |
| 18 | 中止 | `POST /session/{id}/abort` 之后来 `prompt.failed` | `error.name` 是什么 | `events.ts` |
| 19 | 改动 | `GET /session/{id}/diff` 返回 `{ file, status, additions, deletions }[]`；补丁内容在哪 | 有没有像 OpenCode 那样放在用户消息的 `summary.diffs` 上 | 适配器 `diff` |
| 20 | 压缩 | `POST /session/{id}/summarize` body `{ providerID, modelID }`，之后摘要是哪条消息 | 有没有 `summary: true` 的助手消息 | 适配器 `summarize` |
| 21 | 提问 | kits 用自己的 `ask_user`（MCP 工具），内核自带的 `question.asked` 应该不会出现 | 有没有被内核自带的提问工具抢走 | 内核配置里关掉自带的提问工具 |
| 22 | kits 工具 | `mcp.kits = { type: "remote", url, headers }`（本机 HTTP MCP） | `ask_user`、`submit_output`、`remember` 能调到吗 | `generate/opencode-config.ts` 的 `mcp` 段 |
| 23 | 技能 | `skills.paths`、项目 `.agents/skills` 的发现 | | 同 OpenCode 的处理 |
| 25 | 命令描述 | OpenCode 用配置目录的 `plugins/kits-describe-bash.js`（`tool.definition` 钩子）给 bash 加 `description` 参数；CodeAgent 现在没发这个插件，步骤显示命令本身 | bash 自带 `description` 吗；不带的话 `tool.definition` 钩子有没有；加载插件前会不会等 npm（内网会卡启动） | 能用就让 `toCodeagentFiles` 留下插件；要等 npm 就照 `skipPluginInstall` 处理 CodeAgent 的配置目录 |
| 27 | 上下文窗口 | `provider.<网关>.models.<模型>.limit = { context, output }`，内核按它判断什么时候自动压缩 | 字段认不认；用得快满时有没有自动压缩 | `generate/opencode-config.ts` 的 `modelLimit` |
| 26 | 子任务 | 子任务在子会话里跑：`session.created` 带 `parentID`，task 工具运行时 `metadata.sessionId` 是子会话 id，子会话的 `permission.requested` 带子会话的 `sessionID` | 子任务里要确认的命令有没有弹卡片；CodeAgent 是不是改走 `task.started`（文档里有这个事件） | `events.ts` 的 `subsessions` |
| 24 | 退出 | 关 kits 时内核和它拉起的 MCP 进程一起结束（Windows `taskkill /T`） | 任务管理器里还有没有残留 | `dialects/child.ts` 的 `stopChild` |
| 28 | 权限回复事件 | 事件 `permission.replied`，带 `sessionID`、`requestID`、`reply`；回复一个请求时内核连带处理同一会话的其他请求 | 并行两个请求，点“本会话允许”后另一张卡片会不会收起；回复已经不在的请求是不是返回 404 | `events.ts` 的 `permission.replied`、`opencode-family.ts` 的 `respondPermission` |
| 29 | 运行中再发消息 | `POST /session/{id}/prompt_async` 在这一轮运行中再调一次；OpenCode 把它并进同一轮，模型下一步看到 | 运行中调一次：是并进这一轮，还是排成新的 prompt；`prompt.completed` 来几次；助手消息带不带 `parentID` | 并进同一轮时打开 `dialects/codeagent.ts` 的 `interject` |
| 30 | 改权限 | `PATCH /session/{id}` body `permission: PermissionRule[]` | 运行中改了下一次工具调用生效吗？规则是追加还是替换（追加时后面的优先吗） | `opencode-family.ts` 的 `setPermission` |
| 31 | 项目配置 | OpenCode 设 `OPENCODE_DISABLE_PROJECT_CONFIG=1`，不读工作目录的 `opencode.json` 和 `.opencode`（里面的插件在打开会话时就执行）；CodeAgent 现在没设对应的开关 | 工作目录放一个项目配置或插件：会被加载吗？有没有关掉的办法 | `dialects/codeagent.ts` 的启动环境 |
| 32 | 智能档路径 | OpenCode：`edit` 的路径相对工作树，git 仓库里工作区外是 `../x`，非 git 工作区从根写起、开头没有 `/`；`external_directory` 的模式是目标目录；管道里的 `sh` 单独成一条子命令，`FOO=1 x` 带着前缀 | 这几种写法一样吗？工作区外写入有没有问、工作区内有没有被误问 | `permission.ts` 的 `editRules`、`RISKY_COMMANDS` |

## 跑完以后

- 结果填进上表，提一个 PR：改动按“不一致时改哪里”做，契约测试的假服务同步改，交付说明（`docs/delivery/kernel.md`）追加一节写清楚改了什么。
- 全部通过后把文首状态改成“已在 Windows 真机核对（日期、CodeAgent 版本）”。
