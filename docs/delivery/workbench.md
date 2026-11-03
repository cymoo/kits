# 交付说明：workbench

## 2026-11-04　会话页右侧的工作区面板：改动、终端、上下文，完成时的总结卡片

> 日期：2026-11-04　PR：见本分支 `feat/workbench-panels`　作者：Claude Code

### 原始需求

phase1-implementation PR9（6.4 节的右侧面板和总结卡片）：会话页右边一栏看这个会话改了什么、跑了哪些命令、上下文用了多少，照原型 `designs/app/session.html`（`?s=changes`、`?s=done`、`?s=context`，放大模式 `?panel=wide`）。

做到什么程度算完：改动按轮分组，点文件看 diff，放大后 diff 能切统一 / 并排；终端按顺序列出每条命令的输出、退出码、耗时和是怎么被允许的，以及本会话的允许规则；上下文显示用量和窗口、Agent、内核、工作目录、累计 tokens；会话完成时对话末尾有“这个会话做了什么”总结卡片，点格子跳到对应页签。

### 怎么验收

用 Mock 内核，不需要模型（`KITS_KERNEL=mock`，`pnpm --filter @kits/desktop dev`）：

1. `KITS_MOCK_SCENARIO=done`：首页发任意任务。完成后右侧“改动 1”页签列出“第 1 轮 · src/points/redeem.py（M，+6 −1）”，下面是 diff，带新旧行号，新增行绿底、删除行红底。点“在编辑器打开”用系统默认程序打开这个文件。
2. 对话末尾出现总结卡片：改动“1 个文件 · +6 −1 · 1 轮”、命令“1 条 · 都成功了”、用量“21K / 320”。点“命令”跳到终端页签：`uv run pytest tests/points -q`，“退出 0 · 1.2 秒 · 自动允许”，下面是输出 `12 passed`。“复制回复”把最后一段回复复制到剪贴板。
3. 点“上下文”：用量“21K / 128K”（128K 是设置里这个模型的上下文窗口），下面是 Agent、内核 · 模型 · 窗口、工作目录（`~/…`）、累计用量。
4. 按 ⌘\（Windows 是 Ctrl+\）或点顶栏右上角的放大按钮：对话缩到左边 400px，面板占满右边，改动变成左右两栏，右上出现“统一 / 并排”，切到并排后左旧右新对齐显示。再按一次缩回。顶栏的“收起工作区面板”把面板收掉，再点“显示工作区面板”回来；这个选择重开应用还在。
5. `KITS_MOCK_SCENARIO=permission`：确认卡片出来时，终端页签里这条命令显示“等待确认”（黄底）；点“本会话允许”后变成“退出 0 · 3.4 秒 · 本会话允许”，下面“本会话的允许规则”列出 `uv run pytest *`。
6. 真实网关（`.env`）：让 Agent 改一个文件并跑一条命令。这一轮进行中“改动”先按编辑步骤列出文件（“这一轮结束后显示 diff”），结束后一两秒内换成内核算好的 diff 和行数。

### 主要改动

- `packages/core`：`tool-end` 事件和工具 part 多了 `exitCode`、`durationMs`；新类型 `FileDiffView`；IPC `session.diffs`、推送 `session.diffs`。
- `packages/kernel`：
  - 事件映射从 OpenCode 工具状态里取 `metadata.exit`（bash 的退出码，1.19.5 实测有）和 `time.start / end`。
  - `diff()` 给每个文件标上 `turn`（内核会话里第几条用户消息）。
  - Mock：工具步骤可以带退出码和耗时；`done` 场景加一条跑测试的命令。
- 数据库：新表 `diffs`（会话、轮次、路径、状态、增删行数、patch），迁移 `drizzle/20261103195203_overrated_goliath`；`messages` 加 `context_tokens`（这一轮最后一次模型调用的输入 token）和 `kernel_turn`（用户消息在内核会话里是第几条），迁移 `drizzle/20261103202118_melted_the_hunter`。旧库直接迁移。
- `apps/desktop/src/main/sessions/session-service.ts`：一轮结束后隔 0.3 / 1.5 / 4 秒去内核取改动（OpenCode 在一轮结束后才异步算出来），变了才整份替换落库并推给界面。内核对这一轮有了第一个动静（不是准备阶段就结束）时才记下 `kernel_turn`，内核的轮次按它换回本地轮次（内核启动期间、读历史期间就停掉的轮次不占号）；升级前建的会话第一次接着说时，按内核里已有的用户消息数补上。每个会话只认最新一次刷新，晚回来的旧结果丢掉；取完改动才释放内核，期间排着的重启会等它。
- `apps/desktop/src/renderer/src/`：
  - `session/panels/patch.ts`：unified diff → 带行号的行；并排时一段删除和紧跟的新增左右配对。
  - `session/panels/derive.ts`：改动按轮分组（最新在上，进行中的一轮先按编辑步骤列文件）、终端命令（去掉 OpenCode 附给模型看的 `<shell_metadata>`）、本会话允许规则、上下文用量（上下文条用最后一次模型调用的输入；累计输入已经含缓存，命中率 = 缓存读 / 输入）；这一轮已经结束但没收到结束事件的命令显示“中断”，不算进“都成功了”。“在编辑器打开”对工作目录外的绝对路径直接用原路径。
  - `session/panels/Workbench.tsx`、`Summary.tsx`：三个页签和总结卡片，样子照原型。
  - `pages/session/SessionPage.tsx`：对话 + 面板两栏，窄栏 / 放大 / 收起三种（放大时侧栏自动收成图标栏，900px 宽的窗口也放得下文件列表和 diff；并排视图长行折行，不截断）（`lib/ui-store.ts` 的 `panel`，记在 localStorage）；快捷键 ⌘\ 放大 / 缩回（`lib/shortcuts.ts` 的 `widePanel`）。
  - `index.css`：面板底色令牌 `--k-bg-panel`。
- 原型没画到、按风格补的：面板收起 / 显示按钮（窗口最小宽度 900px 时三栏太挤）；终端和改动的空状态图标；上下文用量条只有一段（原型三段要按系统提示 / 历史 / 最近拆，内核不给这个拆分）；进行中一轮“结束后显示 diff”的提示。

### 测试

- 单元测试：`patch.test.ts`（3 个：文件头跳过和行号、空 patch、并排配对）；`panels/derive.test.ts`（7 个：按轮分组、进行中的一轮、命令的退出码 / 耗时 / 允许方式、等待确认、去掉 shell_metadata、上下文用量、token 格式）；`events.test.ts` 补退出码和耗时；`opencode-family.test.ts` 补 diff 的轮次编号；`session-service.test.ts` 补“一轮结束后取到改动、落库、推送”；契约测试的 diff 断言补 `turn: 1`。
- E2E：`workbench.spec.ts`（3 个）：完成后的改动 / 总结卡片 / 终端 / 上下文；⌘\ 放大并切并排、缩回、收起再显示；等待确认的命令和本会话允许规则。

### 新增依赖

无。

### 已知问题

- 产出页签和总结卡片的“产出”格在 PR10；现在第三格是用量。
- 这个版本之前建的会话没有 `kernel_turn`，改动按内核的编号直接当本地轮次。
- 本会话允许的规则只能看，不能撤销（OpenCode 没有撤销会话规则的接口）。
- diff 没有语法高亮，也没有“只看这一轮 / 合并所有轮”的切换。
