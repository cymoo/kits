# 交付说明：kernel

## 2026-11-03　启动环境变量和 retry 事件

> 日期：2026-11-03　PR：#3　作者：Claude Code

### 原始需求

模型 PoC（[references/model-poc.md](../references/model-poc.md)）的两个要紧发现，趁第 2 周做适配器前先把内核这一层改掉：

1. OpenCode 默认读写用户家目录的 OpenCode 数据，并加载 `~/.agents/skills`、`~/.claude/skills` 和 Claude Code 配置，每轮多 2.8k 输入 token，内核行为还依赖本机环境。
2. 网关约 148 s 无输出会断连，OpenCode 自动重试，但 `KernelEvent` 没有地方表达“重试中”。

### 怎么验收

1. 跑 `pnpm test`，`packages/kernel` 下 `spawnEnv` 的 3 个用例通过：四个 `XDG_*_HOME` 和 `OPENCODE_TEST_HOME` 都指向 `dataDir`，三个 `OPENCODE_DISABLE_*` 为 `1`，继承自外层的同名变量被覆盖。
2. 同一轮里的契约测试（真实启动 `opencode serve`）通过，它断言两件事：启动后 `dataDir/opencode/` 存在（XDG 数据没落到家目录）；放在 `dataDir/.opencode/opencode.json` 的 fixture 被 `GET /config` 返回（家目录级配置查找已重定向到 `dataDir`，用户自己的 `~/.opencode` 不会被加载）。想手动看，把测试 `finally` 里的 `rmSync` 注释掉再跑一次，临时目录在 `os.tmpdir()/kits-opencode-*`。
3. `packages/core/src/events.ts` 和 `docs/plans/phase1.md` 4.1 节的 `KernelEvent` 都多了 `retry` 事件，字段一致。

### 主要改动

- `packages/kernel`：`KernelConfig` 新增 `dataDir`；`spawnEnv(cfg)` 独立成函数，`spawn` 用它拼子进程环境：`XDG_DATA_HOME / XDG_CACHE_HOME / XDG_CONFIG_HOME / XDG_STATE_HOME` 和 `OPENCODE_TEST_HOME` 指到 `dataDir`，加 `OPENCODE_DISABLE_AUTOUPDATE / OPENCODE_DISABLE_EXTERNAL_SKILLS / OPENCODE_DISABLE_CLAUDE_CODE = 1`。只给子进程设，不动当前进程的环境。`OPENCODE_TEST_HOME` 是从 1.19.5 的二进制里确认的 `Global.Path.home` 覆盖口（`home = OPENCODE_TEST_HOME ?? os.homedir()`），配置查找会扫 `{home}/.opencode`；升级 OpenCode 时要复查这个变量还在不在，契约测试会先报。
- `packages/core`：`KernelEvent` 新增 `{ type: 'retry'; attempt; message; nextAt }`，`phase1.md` 同步。
- 没有界面改动，没有 schema 改动，没有新依赖。

### 测试

- 单元测试：`packages/kernel/src/dialects/opencode.test.ts` 新增 `spawnEnv` 3 个用例；契约测试同时传 `configDir` 和 `dataDir`，并断言数据目录和家目录级配置都落在 `dataDir`。

### 已知问题

- `retry` 事件只加了类型。OpenCode 的 `session.status {type:"retry"}` 到这个事件的映射，以及界面上“等待模型 / 重试中”两个状态，随第 2 周的适配器和会话页一起做（界面先改原型），见 #4。
- `opencode serve` 还没接进 app：计划一个 app 生命周期只起一个 serve 进程，第一次需要会话时懒启动，每个任务在同一进程上开新 session，进程意外退出再拉起。第 2 周实现，见 #5。

## 2026-11-04　统一配置模型和 opencode.json 生成

> 日期：2026-11-04　PR：#9　作者：Claude Code

### 原始需求

[phase1-implementation.md](../plans/phase1-implementation.md) 第 8 节 PR1：3.1～3.6 节的统一配置模型（zod）和 frontmatter 解析，4.1 节的配置转换 `generateOpencodeConfig`、写文件、校验，`opencodeDialect.writeConfig` 实现。第 9 节前两条风险（1.19.5 的字段名、多网关）在本 PR 用契约测试核对。

做到什么程度算完：给定一份 kits 配置，能生成 OpenCode 1.19.5 认的 `opencode.json`，真实内核读回来的 provider、agent、技能、MCP 和输入一致；配置不全时返回指向设置分区的错误，不启动内核。

### 怎么验收

1. `pnpm check` 全绿（lint、typecheck、99 个单测）。
2. 只跑内核包并看用例名：`pnpm vitest run --project kernel --reporter verbose`。`generated opencode config` 下 4 个契约用例会真实启动 `opencode serve`，分别确认：
   - 两个网关各自的 `baseURL` 和从环境变量读到的 key 都在 `GET /config` 里（多网关可配）；
   - `kits-api-reviewer` 这个 agent 的最终权限里 `bash` 和 `edit` 都是 `deny`（Agent 写了 `bash: deny`，工具列表里没有 edit）；
   - 列在 `skills.paths` 里的技能被 `GET /skill` 发现，并以 `source: skill` 出现在 `GET /command`；
   - `GET /mcp` 里有 `kits` 和 `wiki` 两个服务，停用的 `wiki` 状态是 `disabled`。
3. 想看生成结果：在 `packages/kernel/src/generate/opencode-config.contract.test.ts` 的 `afterAll` 里把 `rmSync` 注释掉再跑一次，临时目录 `os.tmpdir()/kits-contract-*/config/opencode.json` 就是生成的文件。打开确认：没有任何密钥明文，key 都写成 `{env:KITS_GW_<ID>_KEY}`，MCP 头里的 `${WIKI}` 写成 `{env:KITS_MCP_WIKI}`。
4. 错误提示：`opencode-config.test.ts` 里 `reports …` 开头的 6 个用例覆盖网关地址为空、没填 key、默认模型不存在、Agent 模型不存在、输出格式不是合法 JSON Schema、MCP 变量缺失（只对启用的服务报）、`kits` 服务名被占用。

### 主要改动

- `packages/core/src/config/`：
  - `settings.ts`、`gateway.ts`：`settings.json` 的完整 schema（3.1 节），字段全有默认值，空文件能解析；多了 `skillsDisabled`（3.4 节）和 `updateUrl`（PR20 用）。`parseModelRef` 只按第一个 `/` 拆，模型 id 里可以带 `/`。
  - `agent.ts`：Agent Markdown 的解析和序列化。`disabledTools` 换成允许列表 `tools`；`tools`、`skills`、`mcp` 可以写 YAML 数组、逗号分隔的一行或 `all`；`permissions` 是 `工具 → 档位` 或 `工具 → {模式: 档位}`。`mergeBySource` 做三级来源合并，记下被覆盖的来源（界面标“同名，项目的优先”）。
  - `skill.ts`、`memory.ts`、`files.ts`：SKILL.md 解析、技能三级合并和启停；`memory.md` 一行一条的读、追加、改、删（非列表行原样保留）；从目录加载 Agent 和技能，坏文件收进 `errors` 不拖垮列表，Agent 的 `output` 文件在加载时读进来并做 JSON Schema 结构检查。
  - `permission.ts`：按 3.6 节三层叠加，结果是一串**有顺序的规则**（和内核一样后匹配的优先），每层整段接在前一层后面、不挪动不合并：第一层 `basePermissions` 是默认值加 MCP 设置、按会话模式调整；第二层是 Agent 文件里的规则，按文件顺序，deny 永远生效、allow / ask 只在“执行前确认”模式下生效；最后是 kits 自己三个工具的放行。bash 默认带只读白名单（`git status|diff|log|show` 带任意参数，`git branch` 只放行 `--list`、`-a`、`-r`、`-v` 等列出分支的写法，`ls`、`cat` 等），白名单命令里带重定向 `>`、命令替换 `$(…)` / 反引号、`git --output` / `--ext-diff`、`find -exec/-delete/-fprint`、`rg --pre`、`tree -o` 的回到兜底档位；MCP 写入类（`create_ / update_ / delete_ / push_ / send_` 开头）默认询问，用户在 `mcp.json` 里设过的照用户的；`kits_` 开头的 MCP 服务名在配置转换时拒绝。契约测试实测：1.19.5 里建会话时传的规则排在 Agent 规则后面，所以会话模式能压过 Agent 配置。
  - `mcp.ts`：`mcp.json` 的 `enabled`、`permissions` 两个 kits 字段；`${VAR}` 查找和替换。转成环境变量名后撞名的变量（如 `${TOKEN}` 和 `${token}`）报错，不静默覆盖。
- `packages/kernel/src/generate/`：`generateOpencodeConfig` 纯函数，返回要写的文件和子进程环境变量，或者一组 `{ section, target, message }` 错误（`section` 是设置页分区 `model / mcp / agent`）。`agentPermissions(agent, mode, mcp)` 单独导出（规则串，再加工具和技能允许列表），PR2 建会话时按会话模式算权限用它；写进 `opencode.json` 的全局权限是第一层，Agent 那一份只有 Agent 自己的规则和允许列表，内核按“全局 → Agent → 会话”的顺序接起来。`writeGeneratedFiles` 先写临时文件再改名。
- `packages/kernel`：`KernelConfig.gateway` 换成 `env`（多网关时每个网关一个 key 环境变量）；`opencodeDialect.writeConfig` 实现；`spawnEnv` 多关两样联网：`OPENCODE_DISABLE_MODELS_FETCH`（models.dev）、`OPENCODE_DISABLE_LSP_DOWNLOAD`。
- 和方案不一样的地方（已改回 [phase1-implementation.md](../plans/phase1-implementation.md) 4.1 节的表）：
  - 技能不做软链接：1.19.5 的 `skills.paths` 原生支持，单个技能目录也认，直接列启用技能的目录，Windows 也不用拷贝。内核会自动把技能注册成 `/` 命令，所以也不生成 `command.<name>`。
  - 内核里的 agent 名加 `kits-` 前缀，避免和内核自带的 `build / plan / general / explore / title / summary / compaction` 撞名。
  - 工具允许列表除了写 `tools: {x: false}`，还在权限里写 `deny`：契约测试发现 `tools` 不会转成权限规则，只关工具的话 Agent 权限里 `edit: allow` 依然有效。
  - MCP 的 `${VAR}` 不在生成时替换成明文，而是写成 `{env:KITS_MCP_<VAR>}`，值只进子进程环境变量，密钥不落盘。
- 没有界面改动，没有数据库 schema 改动。
- `biome.json` 给 `*.test.ts` 关了 `noTemplateCurlyInString`（测试里要写 `${VAR}` 字面量）和 `noExplicitAny`（读内核返回的 JSON）。

### 测试

- 单元测试：`packages/core` 新增 `permission / agent / memory / settings / files` 5 个测试文件，`mcp`、`submit-output` 各补用例；`packages/kernel` 新增 `opencode-config.test.ts`（转换和校验）和 `opencode-config.contract.test.ts`（真实内核读回）。
- E2E：没有界面改动，不涉及。

### 新增依赖

| 依赖 | 版本 | 用途 | 许可证 |
|---|---|---|---|
| yaml | 2.9.1 | 解析 Agent 文件和 SKILL.md 的 frontmatter | ISC |

方案 6.1 节写的是 gray-matter。换成 `yaml` 加十几行切分：gray-matter 最后一次发布在 2019 年，带 js-yaml 3 和另外三个依赖；`yaml` 无依赖、纯 JS、维护活跃，序列化（保存 Agent）也用得上。

### 已知问题

- 内置技能名不能叫 `review` 或 `init`：内核自带同名 `/` 命令，列表里会出现两个。PR13 写内置技能时改名（比如 `code-review`），或者在 `#skills` 里提示。
- 模型的上下文窗口没有写进 `provider.models.<id>.limit`：1.19.5 要求 `context` 和 `output` 同时给，而网关不返回输出上限，随便填可能截断推理模型的输出。kits 自己按 `contextWindow` 算用量（PR16）；内核的自动压缩暂时不会因为超窗触发。
- kits 工具服务对 MCP 调用的超时（`ask_user` 阻塞提问）留给 PR3 核对：`mcp.<name>.timeout` 在 1.19.5 里是列工具的超时，调用超时可能是 `experimental.mcp_timeout`。
- `checkJsonSchema` 只做结构检查（`type` 是否合法、子 schema 是否对象、`required` 是否字符串数组），不是完整的元 schema 校验。

## 2026-11-04　OpenCode 系适配器、事件映射和假网关

> 日期：2026-11-04　PR：见本分支 `feat/kernel-adapter`　作者：Claude Code

### 原始需求

[phase1-implementation.md](../plans/phase1-implementation.md) 第 8 节 PR2：4.2 节的 `OpencodeFamilyKernel`（事件流、映射、完成判定、权限回复、diff、abort），4.5 节的假网关，契约测试进 CI。关 #4 的内核部分（`session.status retry` → `retry` 事件；界面上的“等待模型 / 重试中”随会话页做）。

做到什么程度算完：不调真实模型，用真实 `opencode serve` 加假网关跑通“建会话 → prompt → 权限请求 → 回复 → 工具结束 → 正文 → done”，网关失败时能看到重试，abort 能结束这一轮。

### 怎么验收

1. `pnpm check` 全绿。
2. `pnpm vitest run --project kernel --reporter verbose`，看三组用例：
   - `OpencodeFamilyKernel against opencode serve`（真实内核，6 个）：完整一轮的事件顺序和内容（权限请求的 `patterns` 是 `printf 'hi'`、工具输出含 `hi`、正文是“命令输出：hi”、推理是“命令跑完了，汇报结果。”、用户自己的话没混进正文、有 `usage`、以 `done: completed` 结束）；拒绝时的说明文字作为工具错误交给模型；假网关第一次回 503 时收到 `retry`（第 1 次，带下次重试时间）后照常完成；首字 30 s 的网关上 abort 后以 `done: aborted` 结束；`ls && touch …` 这种串起来的命令照样询问；读回会话消息和 diff。
   - `OpencodeFamilyKernel`（假内核，3 个）：`session.idle` 丢了靠 `GET /session/status` 轮询收尾；事件流断开后重连，用 `GET /session/{id}/message` 补齐断线期间的正文且不重复；内核连不上时这一轮以 `done: error` 结束，不抛异常。
   - `createOpencodeEventMapper`（纯函数，20 个）：用 PoC 文档里录制的事件样本逐条核对映射。
3. 手动看一遍假网关：`packages/kernel/src/testing/mock-model.ts` 是给契约测试和以后的 E2E 用的 OpenAI 兼容服务，`GET /models` 返回一个 `mock-model`，`POST /chat/completions` 按请求内容回：没有 tools → 一句固定文本（内核生成标题时走这里）；最后一条是工具结果 → 带上工具输出的文本；否则调一次 bash。

### 主要改动

- `packages/kernel/src/adapter/`：
  - `opencode-family.ts`：`OpencodeFamilyKernel`。一个工作目录一条 `GET /event` 长连接，各轮按 `sessionID` 分发；断开 1 s 后重连，重连后补齐。完成以 `session.idle` 为准，每 5 s 轮询状态兜底（看到过 busy 之后变 idle，或连续两次 idle），轮询失败且 60 s 没有任何事件（包括内核每 10 s 的心跳）判卡死，以 `done: error` 结束。abort 后最多等 5 s 内核的结束事件，等不到直接结束。
  - `events.ts`：SSE → `KernelEvent` 的映射器，一轮一个。文本按 part 记已发出的长度，增量和整段都能来，只发没发过的那截，断线补齐时把消息重放一遍不会重复；补齐时跳过这一轮开始之前的消息。认 CodeAgent 文档里的 `permission.requested` 别名。
  - `sse.ts`：`text/event-stream` 的最小解析。
- `packages/kernel/src/kernel.ts`：接口调整（[phase1.md](../plans/phase1.md) 4.1 节已同步）：
  - 会话用 `KernelSession`（id + 工作目录 + Agent + 模型）整个传进来，适配器不记会话：OpenCode 每个请求都要带工作目录，应用重启后从数据库读出来照样能续。
  - `createSession` 接收按会话模式解析好的权限（`agentPermissions` 的结果），转成内核的规则数组随建会话一起发，所以三档模式（执行前确认 / 只读 / 全部自动）是会话级的，不用重启内核。
  - `respondPermission` 的回复改成 `once | always | reject`，拒绝可带说明：1.19.5 的回复接口原生支持 `message`，内核把它当反馈交给模型，不用再另发一条用户消息。
  - `FileDiff` 改成 `{ path, status, additions, deletions, patch }`：内核返回的是 unified diff，不是前后全文。
  - 新增 `summarize`（上下文压缩）和 `messages`（补齐、恢复）。
  - 方言多一个 `apiPrefix`（CodeAgent 是 `/api/v1`）。
- `packages/core/src/events.ts`：`text-delta` / `reasoning-delta` 带 `partId`（落库时同一个 part 的增量合并）；`permission-request` 带 `patterns`、`always`、`callId`；`usage` 拆出缓存读写和费用；新增 `status`、`compaction`；`PermissionDecision` 换成 `PermissionReply`。
- `packages/kernel/src/testing/mock-model.ts`：假网关，可配“前 N 次失败”和“首字延迟”。
- 没有界面改动，没有数据库 schema 改动，没有新依赖。

### 测试

- 单元测试：`events.test.ts`（映射器 20 个 + SSE 解析 1 个）、`opencode-family.test.ts`（假内核 3 个）。
- 契约测试：`opencode-family.contract.test.ts`（真实 opencode serve + 4 个假网关，6 个）。随 `pnpm test` 在 CI 的 macOS 和 Windows 上跑。

### 新增依赖

无。

### 已知问题

- `compaction` 事件的 `summary` 先给空串：`session.compacted` 不带摘要内容，要从消息里取，PR16 做上下文压缩时补。
- `done: max-steps` 还没有映射：1.19.5 里输出超长是 `session.error` 的 `MessageOutputLengthError`，现在按普通错误报，带内核给的原因。
- 正文只按 `messageID` 的角色过滤用户消息；角色还没到就先来的 part 当作回复。契约测试确认 1.19.5 总是先发 `message.updated`。
- 只读白名单只写单条命令的模式；`&&`、管道串起来的命令由内核拆开逐条判断，有一条不在白名单就整体询问。契约测试 `asks for the non-whitelisted part of a chained command` 锁住了这个行为，升级 OpenCode 时会先报。

## 2026-11-04　KernelManager 和 Mock 内核

> 日期：2026-11-04　PR：见本分支 `feat/kernel-runtime`　作者：Claude Code

### 原始需求

[phase1-implementation.md](../plans/phase1-implementation.md) 第 8 节 PR6：5.1 节 KernelManager（关 #5）、4.4 节 Mock 内核和 8 个场景、`kernel.status` 推送。

做到什么程度算完：一个应用每种内核最多一个进程，第一次需要时启动；进程意外退出时正在跑的轮次以出错结束、下次自动拉起；设置改了按新配置重启（有轮次在跑就等它结束）；设置页能看到内核状态、能手动启动 / 重启、配置不全时指出缺什么。`KITS_KERNEL=mock` 时换成按场景回放的 Mock 内核。

### 怎么验收

1. `pnpm check` 全绿；`pnpm build && pnpm test:e2e` 9 个用例通过，其中 `kernel.spec.ts` 2 个是本 PR 的。
2. 配置不全时不启动：`KITS_CONFIG_DIR=/tmp/kits-empty pnpm dev`（空目录），⌘, → 内核与模型，“内核进程”一行写“未启动（开始会话时自动启动）”；点“启动”，状态变“出错”，下面红框列出“gateways：还没有启用的模型网关”“defaultModel：还没有选默认模型”。
3. 真内核：用上一节的步骤配一个网关和默认模型，点“启动”，几秒后变“运行中”；点“内核日志”一行的“打开目录”，能看到当天的 `YYYY-MM-DD.log`，里面是 `opencode serve` 的输出。`{userData}/kernel/opencode/config/opencode.json` 是生成的配置，没有密钥明文。
4. 配置变更：内核运行中时在网关卡片里改一下模型的上下文窗口（任何设置保存都算），状态短暂变“未启动 / 启动中”后回到“运行中”，日志里多一段新的 `--- … opencode serve ---`。
5. 进程退出：内核运行中时在终端里 `pkill -f "opencode serve"`，状态变“出错”，红框里写“内核进程退出了（信号 SIGTERM）”；再点“重启”回到“运行中”。
6. Mock 内核：`KITS_KERNEL=mock pnpm dev`，内核卡片两个都显示 mock，“启动”后立刻“运行中”。各场景的事件序列在 `packages/kernel/src/mock/scenarios.ts`，会话页做好之后（PR7）用 `KITS_MOCK_SCENARIO=permission` 等环境变量逐个看。

### 主要改动

- `packages/kernel`：
  - `kernel.ts`：`KernelConfig` 加 `logFile`；`SpawnedKernel` 和 `AgentKernel` 加 `onExit`（意外退出才通知，`close()` 关掉的不算），带退出码 / 信号和输出尾部。
  - `dialects/opencode.ts`：子进程输出追加写日志文件；内存里只留最后 64 KB（以前无上限）。
  - `adapter/opencode-family.ts`：进程意外退出时，正在跑的每一轮以 `done: error`（“内核进程退出了（退出码 N）”加输出尾部）结束，再通知监听方。
  - `mock/mock-kernel.ts`、`mock/scenarios.ts`：Mock 内核和 8 个场景（`streaming`、`permission`、`question`、`done`、`retry`、`crash`、`context`、`output-structured`），和原型 `session.html` 的 `?s=` 一一对应。权限请求真的等 `respondPermission`，按回复走允许 / 拒绝两个分支；提问和提交产出调和真内核一样的 kits 工具处理函数；`KITS_MOCK_SPEED` 调快慢。
- `apps/desktop/src/main`：
  - `kernel/kernel-manager.ts`：`acquire / release`（会话服务每轮调一次，用来判断能不能立即重启）、懒启动（并发调用共用一次启动）、退出处理、`configChanged`、`requestRestart`（设置页的“重启”：有轮次在跑就标待重启，最后一轮结束后再重启，不会把在跑的轮次掐断）、`dispose`，状态变化推给界面。
  - `dialects/opencode.ts`：Windows 上关内核用 `taskkill /T /F` 结束整棵进程树，OpenCode 拉起的 stdio MCP 服务和命令不会在应用退出后留下。
  - Mock 内核：会话 id 跨实例唯一（重启后新建的会话不会和旧会话撞 id）；崩溃时先通知退出再交出 `done`；`dispose` 后还没开始的等待也立刻结束。
  - `kernel/kernel-config.ts`：从 `~/.kits`（设置、个人 Agent、个人技能、`mcp.json`、个人记忆）和密钥表收拢成内核配置，写进 `{userData}/kernel/<id>/config`，日志在 `{userData}/kernel/<id>/logs/<日期>.log`。
  - `kernel/runtime.ts`：真内核 / Mock 内核的工厂；找不到内核二进制时报“内核没有安装”。
  - `tools/kits-tool-host.ts`：kits 工具服务的宿主（一个应用一个 HTTP MCP 服务），处理函数可替换，PR7 由会话服务接上。
  - `index.ts`：设置保存后通知 KernelManager；退出时关内核子进程和工具服务。
- `packages/core/src/ipc.ts`：`KernelRuntime`（状态、错误、配置问题）、`kernel.restart`、推送 `kernel.status`。
- 设置页“Agent 内核”卡片：标签换成运行状态，加“内核进程”一行（状态 + 启动 / 重启），出错时红框列出原因和配置问题。原型 `designs/app/settings.html#model` 同步加了这一行，`?proc=stopped|starting|running|restart-pending|error` 切演示状态。
- `apps/desktop` 开发依赖加 `opencode-ai@1.19.5`（和 `packages/kernel` 同一个版本，pnpm 硬链接同一份文件）：主进程打包后从 `apps/desktop/out` 找 npm 包，原来找不到内核。
- 和方案不一样的地方：Mock 场景写成 TS（`scenarios.ts`）而不是 `scenarios/*.json`，步骤类型有检查，写错字段编译就报。
- 没有数据库 schema 改动，没有新的三方依赖。

### 测试

- 单元测试：`kernel-manager.test.ts`（懒启动只启动一次、配置问题不启动、退出后标出错并在下次拉起、空闲时立即重启、有轮次时待重启、配置修好后清掉错误、dispose）；`mock-kernel.test.ts`（8 个场景都以一条 done 结束、权限两个分支、提问走 askUser、产出走 onOutput、崩溃通知（消费方在 done 处停下也收得到）、等权限时 abort、dispose 后结束、会话 id 跨实例唯一、重试时间、diff）；`kernel-manager.test.ts` 补“有轮次时手动重启要等、空闲时立即重启”；`opencode-family.test.ts` 补“进程退出时正在跑的轮次以出错结束”。
- E2E：`kernel.spec.ts`：Mock 内核从设置页启动和重启；没配网关时启动真内核失败并列出缺的设置。

### 新增依赖

无新的三方库（`opencode-ai` 已是 `packages/kernel` 的开发依赖，这里在 `apps/desktop` 再声明一次）。

### 已知问题

- 项目级（`<工作目录>/.agents/`）的 Agent、技能、记忆还没进内核配置：内核配置是整个进程一份，而工作目录跟着会话走。PR13、PR14、PR16 做三级来源时一起定（候选做法：把最近用过的工作目录的项目配置都列进去，同名时按会话的工作目录选）。
- CodeAgent 方言在 PR19；现在默认内核选 CodeAgent 会报“CodeAgent 方言还没接入”。
- MCP 配置里 `${VAR}` 的值先查密钥表的 `env:<VAR>` 再查环境变量；设置页填 MCP 密钥的界面在 PR12。
