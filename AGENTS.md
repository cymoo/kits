# kitty 开发约定

本仓库是 **kitty** 的代码仓：一个本地运行的 AI 测试作业平台（Electron 桌面应用），测试设计、用例开发、测试执行、结果分析都在一个工具里完成。产品叫 kitty，仓库叫 kits。

这份文件是给所有协作者和所有 AI 编码工具（Claude Code、Cursor、Codex 等）看的。先读它，再读 `docs/plan-2026-11.html`（当前开发计划，含技术栈和排期）。

## 文档在哪

| 文档 | 内容 |
|---|---|
| [docs/plan-2026-11.html](docs/plan-2026-11.html) | 六周开发计划：目标、模块、逐周计划、技术栈、开发约定、风险。**当前执行的计划。** |
| [docs/phase1-plan.md](docs/phase1-plan.md) | 第一阶段方案：架构、内核接口、配置转换、权限模型、数据记录。技术决策的依据。 |
| [docs/codeagent-spec.md](docs/codeagent-spec.md) | CodeAgent SDK 规格（HTTP + SSE 接口、事件类型）。接内核时对照它，和实际行为不一致的地方记到核对清单里。 |
| [designs/prototype/](designs/prototype/index.html) | 界面原型。浏览器直接打开，或 `python3 -m http.server 8765 --directory designs/prototype`。 |
| `docs/delivery/` | 每个模块的交付说明（见下文）。 |

更早的方案文档（完整平台设计、MVP 方案、OpenCode 评估、API 对比、原型评审）留在 [cymoo/kaise](https://github.com/cymoo/kaise)，已被上面的方案取代，只作参考。

## 开发流程

人主要管两头：需求和验收。中间的原型、代码、文档、测试尽量交给 AI。

```
需求（人） → 原型（AI） → 开发（AI） → 交付说明 + 测试（AI） → 验收（人）
```

### 1. 需求

写清楚要什么、做到什么程度算完，附上对应的原型页面。需求写在 issue 或交付说明的“原始需求”一节，不要只留在聊天记录里。

### 2. 原型先行

界面改动先改原型，看过没问题再写页面。不要跳过原型直接改代码，也不要让代码和原型长期不一致。

- 现有原型在 `designs/prototype/`，是几个可交互的 HTML 页面（`runtime.js` 是它们的极简运行时，只为原型服务）。改现有页面就改这里。
- 新页面、新流程的探索用 `.agents/skills/claude-design` 技能：在 `designs/<slug>/` 下建一个画板，本地编辑器里可以并排看多个页面、改文案、留评论。评审通过后再并入 `designs/prototype/` 或直接实现。
- 原型只画必要的状态（空、加载、正常、出错），不堆功能。原型评审的结论写回需求。

### 3. 开发

- 加载 `.agents/skills/` 里的技能，照原型实现。原型没有画到的，按原型的风格补，并在交付说明里写明。
- 技术栈以 `docs/plan-2026-11.html` 的“技术栈”为准：Electron + electron-vite，React 19 + TypeScript，Tailwind CSS + Radix UI，zustand + TanStack Query，SQLite（better-sqlite3）+ Drizzle，pnpm workspace + Turborepo，Biome，Vitest，Playwright。
- 几条原则：
  - 不自研 Agent 内核。CodeAgent 和 OpenCode 经同一个 `AgentKernel` 适配器接入，只调两者共有的接口，差异收在方言层。
  - 配置只写一份，按内核转换。Agent、技能、产出格式都是配置，不写死在代码里。
  - 通用能力做到测试场景够用就停。加功能前先问“对测试有没有直接帮助”。
  - 平台相关的代码收在 `PlatformBridge` 里，以后加 Web 版不动页面。
- **尽量不手改 AI 写的代码。** 代码有问题，优先改需求、交付说明或技能让 AI 重做；确实要手改的，在交付说明里写一句原因。一个地方手改得多，说明技能该补了。
- **新依赖先说一声。** 引入三方库前在群里说一下：许可证能不能商用、内网能不能装、有没有原生依赖、是不是已经有类似的库。

### 4. 交付说明

每个 PR 附一份 `docs/delivery/<模块>.md`（同一模块多次交付就在同一份里追加一节），按 [docs/delivery/TEMPLATE.md](docs/delivery/TEMPLATE.md) 写：

- 原始需求：这次要解决什么，引用需求和原型页面。
- 怎么验收：一步一步能照着做，写清楚预期结果；验收用的测试数据一起给。
- 主要改动：改了哪些模块、新增了哪些配置项、数据库 schema 有没有变。
- 新增依赖：名称、版本、用途、许可证。
- 已知问题：没做完的、绕过的、手改过的。

验收的人只看这份文档，不通读代码。文档写不清楚的，视为没交付。

### 5. 测试跟着代码走

UT 和 E2E 和代码一起提交，不另外排期。没有测试的 PR 不合，CI 不绿不 demo。

- **单元测试**：Vitest，文件放在被测代码旁边（`foo.test.ts`）。重点覆盖纯逻辑：配置转换（统一配置 → CodeAgent / OpenCode 格式）、JSON Schema 校验、SSE 事件映射、JUnit XML 解析、产出格式。一个用例只验一件事，名字写成一句话（`maps tool.start to a running tool part`）。
- **契约测试**：内核适配器对 OpenCode 跑契约测试，CI 用 OpenCode 加 mock 模型跑；CodeAgent 行为不一致的地方先记核对清单，再补用例。
- **E2E**：Playwright，放在 `e2e/`。覆盖主流程：配置模型 → 新建会话 → 流式回复 → 确认工具调用 → 查看改动 → 导出产出；测试工作台跑通一条链。不用 E2E 测细节。
- 修 bug 先写能复现的测试，再改代码。
- 测试里不调真实模型；网关、内核都用 mock 或录制的事件流。

### 6. Git

- `main` 受保护，不直接推。从 `main` 拉分支：`feat/<模块>-<简述>`、`fix/<模块>-<简述>`、`docs/<简述>`、`chore/<简述>`。
- 一个 PR 做一件事，对应一份交付说明。PR 描述放交付说明的链接和验收要点；至少一人 review，CI 绿了才合，合并用 squash。
- 提交信息用 [Conventional Commits](https://www.conventionalcommits.org/)，英文，祈使句，首字母小写，不加句号：

  ```
  <type>(<scope>): <subject>

  <body，可选，说明为什么这么改；可以写中文>
  ```

  `type`：`feat`、`fix`、`docs`、`test`、`refactor`、`chore`、`build`、`ci`、`perf`、`style`。`scope` 用模块名：`kernel`、`session`、`mcp`、`skills`、`workbench`、`settings`、`storage`、`prototype`、`delivery` 等。例：`feat(session): stream tool calls into the thread`、`fix(kernel): fall back to polling when session.idle is missing`。
- AI 生成的提交保留工具自带的署名行（如 `Co-Authored-By`），方便事后统计采纳率。
- 不提交生成物（`dist/`、`out/`、`coverage/`）、密钥和本机配置。

## 仓库结构

```
AGENTS.md                 本文件
README.md
.agents/skills/           开发用的技能（所有工具共用，改动走 PR）
.claude/skills/           指向 .agents/skills 的软链接，给 Claude Code 用
.claude/launch.json       原型和文档的本地预览配置
designs/prototype/        界面原型
docs/                     方案、计划、SDK 规格
docs/delivery/            交付说明
```

工程骨架（`apps/`、`packages/`、`e2e/`、`evals/`）在第一周搭起来后补到这里。

## 技能

- 技能遵循 [Agent Skills](https://agentskills.io) 规范（目录 + `SKILL.md`），放在 `.agents/skills/`，来源和版本记在 [.agents/skills/README.md](.agents/skills/README.md)。
- `.claude/skills/` 只放软链接，不放实体文件。Windows 上 clone 时请开启 `git config core.symlinks true`，或者让工具直接读 `.agents/skills/`。
- 计划里列的流程技能（`delivery-doc`、`prototype-first`、`unit-test`、`e2e-test`、`commit-and-pr`）随工程骨架一起加；在那之前以本文为准。

## 写作约定

- 文档和注释用中文，代码标识符、提交信息、日志用英文。
- 产品名写 `kitty`（小写），仓库名 `kits`。
- 文档写结论和理由，不写过程；状态、日期放在文首。
