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
  - `permission.ts`：`resolvePermissions` 按 3.6 节三层叠加。bash 默认带只读白名单（`git status|diff|log|show` 带任意参数，`git branch` 只放行 `--list`、`-a`、`-r`、`-v` 等列出分支的写法，`ls`、`cat` 等），白名单命令里带重定向 `>`、命令替换 `$(…)` / 反引号、`git --output` / `--ext-diff`、`find -exec/-delete/-fprint`、`rg --pre`、`tree -o` 的回到兜底档位；Agent 的技能允许列表和已有的 skill 权限取交集，列表里单独设成 deny / ask 的照旧；MCP 写入类（`create_ / update_ / delete_ / push_ / send_` 开头）默认询问，用户在 `mcp.json` 里设过的照用户的；`kits_*` 永远允许。输出的键顺序有意义（内核按顺序匹配，后写的优先）。
  - `mcp.ts`：`mcp.json` 的 `enabled`、`permissions` 两个 kits 字段；`${VAR}` 查找和替换。转成环境变量名后撞名的变量（如 `${TOKEN}` 和 `${token}`）报错，不静默覆盖。
- `packages/kernel/src/generate/`：`generateOpencodeConfig` 纯函数，返回要写的文件和子进程环境变量，或者一组 `{ section, target, message }` 错误（`section` 是设置页分区 `model / mcp / agent`）。`agentPermissions(agent, mode, mcp)` 单独导出，PR2 建会话时按会话模式算权限也用它。`writeGeneratedFiles` 先写临时文件再改名。
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
