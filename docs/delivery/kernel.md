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
