# 交付说明：workbench

## 2026-11-04　会话页右侧的工作区面板：改动、终端、上下文，完成时的总结卡片

> 日期：2026-11-04　PR：见本分支 `feat/workbench-panels`　作者：Claude Code

### 原始需求

phase1-implementation PR9（6.4 节的右侧面板和总结卡片）：会话页右边一栏看这个会话改了什么、跑了哪些命令、上下文用了多少，照原型 `designs/app/session.html`（`?s=changes`、`?s=done`、`?s=context`，放大模式 `?panel=wide`）。

做到什么程度算完：改动按轮分组，点文件看 diff，放大后 diff 能切统一 / 并排；终端按顺序列出每条命令的输出、退出码、耗时和是怎么被允许的，以及本会话的允许规则；上下文显示用量和窗口、Agent、内核、工作目录、累计 tokens；会话完成时对话末尾有“这个会话做了什么”总结卡片，点格子跳到对应页签。

### 怎么验收

用 Mock 内核，不需要模型（`KITS_KERNEL=mock`，`pnpm --filter @kits/desktop dev`）：

1. `KITS_MOCK_SCENARIO=done`：首页发任意任务。完成后右侧“改动 1”页签列出“第 1 轮 · src/points/redeem.py（M，+6 −1）”，下面是 diff，带新旧行号，新增行绿底、删除行红底。点“在文件夹中显示”在访达 / 资源管理器里选中这个文件（不直接打开：Agent 改的可能是 .bat、.exe，交给系统默认程序就执行了）。
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
- `apps/desktop/src/main/sessions/session-service.ts`：一轮结束后隔 0.3 / 1.5 / 4 秒去内核取改动（OpenCode 在一轮结束后才异步算出来），变了才整份替换落库并推给界面。内核对这一轮有了第一个动静（不是准备阶段就结束）时才记下 `kernel_turn`，内核的轮次按它换回本地轮次（内核启动期间、读历史期间就停掉的轮次不占号）；升级前建的会话第一次接着说时，按内核里已有的用户消息数补上。每个会话只认最新一次刷新，晚回来的旧结果丢掉；取完改动才释放内核，期间排着的重启会等它；读内核（取改动、补轮次号）有 10 秒截止时间，请求挂住也会收尾释放。
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

## 2026-11-06　界面改版 6：顶栏菜单、上下文对话框、产出卡片

> PR：分支 `feat/session-menu-and-output-card`　作者：Claude Code

### 原始需求

右侧三个页签里产出用得少，上下文不值得占一个页签；顶栏的信息太杂。见[界面改版方案](../plans/2026-11-ui-refresh.md)的决策 5、5a。

### 怎么验收

1. 顶栏只有 工作区 / 标题、状态、`…`、面板按钮；Agent 不是 assistant 时跟在工作区后面。
2. `…` 菜单：查看上下文（带百分比）、压缩上下文、导出 Markdown、导出 JSON、在访达中显示、重命名、置顶、删除。运行中压缩和删除是灰的。
3. 查看上下文或点输入框的用量环：弹出上下文对话框，内容和原来的页签一样，内核和模型在这里看。
4. 导出：顶栏下面出现“已导出到 xxx”，能在文件夹中显示，能关掉。文件在 `{userData}/exports/`。
5. 右侧只有“改动”。用配了产出格式的 Agent（比如 api-reviewer）跑一轮：回复后面有产出卡片；点“查看”多一个可关闭的“产出”页签；点“导出”直接写 JSON 文件；点提交产出的步骤也能打开。
6. 用 assistant 跑一轮：没有卡片，也没有产出页签。

### 主要改动

- `pages/session/SessionMenu.tsx`：顶栏菜单。`SessionPage.tsx`：顶栏、导出提示、就地改名、产出页签的开关。
- `session/panels/ContextPanel.tsx`：从 `Workbench.tsx` 拆出来，换成对话框；接近上限的阈值统一成八成。
- `session/thread/outputs.ts`、`OutputCard.tsx`：卡片放在这一轮的回复后面。
- `OutputPanel.tsx`：只留结构化产出。
- 主进程：不再把回复正文记成产出；旧数据里的文本产出不再列出，表里的数据不动。新增 `session.export` 和 `sessions/export.ts`，方案里以为已有的 `session.export` 其实只有导出产出。去掉 `output.save`。
- 配置项、数据库 schema 没有变化。

### 测试

- 单元测试：`sessions/export.test.ts`、`thread/outputs.test.ts`，`session-service.test.ts` 的 `SessionService outputs`。
- E2E：`workbench.spec.ts` 的 `manages the session from the header menu`，`output.spec.ts` 改走卡片。

### 新增依赖

无。

### 已知问题

- 回复正文不再能在产出里编辑后导出，要留存用“导出会话”。
- 结构化产出还是 JSON 视图，原型里逐条审核的样子这次没做。
- 手动压缩失败的错误显示在顶栏下面。

## 2026-11-06　界面改版 7：文件面板

> PR：分支 `feat/workbench-files-panel`　作者：Claude Code

### 原始需求

没有地方看工作区里的文件。见[界面改版方案](../plans/2026-11-ui-refresh.md)的决策 6 和“文件面板”一节。这个 PR 做文本类预览，图片、PDF、Word 在下一个 PR。

### 怎么验收

1. 会话页右侧点“文件”：目录树，依赖目录（`node_modules`、`.git`、`dist` 等）不列。这个会话改过的文件标 A / M，收起的目录上有小点。
2. 点 Markdown 文件：渲染，能切源码。窄栏有返回按钮；放大后左树右预览。
3. 点代码文件：有行号和高亮，深色主题下配色正常。JSON、YAML、XML 同样。
4. 点 CSV：表格，只显示前 1000 行。
5. 二进制文件、超过 20 MB 的文件：提示不能预览，给“用系统应用打开”。超过 2 MB 的文本只显示开头并有提示。
6. 预览顶上的 `@`：把路径填进输入框。筛选框：平铺匹配的文件。
7. Agent 改了文件后，展开的目录和正看的文件自动刷新；也有手动刷新按钮。
8. 指向工作区外的软链接点开提示读不了。

### 主要改动

- `main/files/browse.ts`：`listDir`、`readPreview`、`resolveInside`。根目录和目标都取真实路径再比，软链接逃出去的一律拒绝。
- `files.list`、`files.read`、`files.open` 三个 IPC。
- `session/panels/FilesPanel.tsx`、`lib/highlight.ts`、`lib/csv.ts`。
- 这版不用 `fs.watch`：工具调用结束和回合结束时刷新。
- 配置项、数据库 schema 没有变化。

### 测试

- 单元测试：`files/browse.test.ts`（路径限制、大文件、二进制）、`lib/csv.test.ts`、`lib/highlight.test.ts`。
- E2E：`workbench.spec.ts` 的 `browses the workspace files and previews them`。

### 新增依赖

| 依赖 | 版本 | 用途 | 许可证 |
|---|---|---|---|
| `shiki` | 4.6.0 | 文件预览的代码高亮。用 JS 正则引擎，没有原生依赖，不加载 wasm，语言按需加载 | MIT |

按约定要在群里说一声，用户还没发。

### 已知问题

- 回复里的代码块还没有高亮。
- 超过 5000 行或 300 KB 的代码不高亮，超过 2 万行不显示行号。

## 2026-11-06　界面改版 8：图片、PDF、Word 预览

> PR：分支 `feat/workbench-file-previews`　作者：Claude Code

### 原始需求

文件面板要能看测试同学常用的需求文档。见[界面改版方案](../plans/2026-11-ui-refresh.md)的决策 6。

### 怎么验收

1. 文件页签点图片（png、jpg、gif、webp、svg 等）：居中显示，宽了就缩。
2. 点 PDF：一页一页看，底部能翻页；中文 PDF 文字正常；拖面板宽度页面跟着缩放。
3. 点 Word（docx）：正文、表格、图片都在；链接和脚本不起作用。`.doc` 这种老格式给“用系统应用打开”。
4. 损坏的 docx：提示不能预览，不报错。

### 主要改动

- `main/files/browse.ts`：按扩展名返回图片、PDF、HTML。Word 用已有的 `mammoth` 转 HTML。
- `lib/pdf.ts`、`session/panels/PdfView.tsx`：用已有的 `pdfjs-dist` 在渲染进程画 canvas。CMap、标准字体、解码器经 `files.pdfAsset` 从主进程取，不打进页面。
- Word 的 HTML 放进 `sandbox=""` 的 iframe，不新增净化库。
- 配置项、数据库 schema 没有变化。

### 测试

- 单元测试：`files/browse.test.ts` 的图片、PDF、Word、坏文件和 `pdfAsset`。
- E2E：`workbench.spec.ts` 的 `previews images, pdf and word files`，检查 canvas 上确实画了东西。

### 新增依赖

无。

### 已知问题

- PDF 一次看一页，没有缩放和搜索。
- 大于 20 MB 的文件不预览。
- PDF 预览在 macOS 打包后的应用里实测过，Windows 打包后没有实测。

## 2026-11-06　修 Windows 上的文件面板单测

> PR：分支 `fix/files-browse-windows-test`　作者：Claude Code

### 原始需求

#66 合并后 `main` 的 Windows CI 失败：`follows a link that stays inside` 把异步 `realpath` 的结果和同步 `realpathSync` 算的路径比，CI 的临时目录是 8.3 短路径（`RUNNER~1`），同步版不展开。只是用例的问题，产品代码两端都用异步 `realpath`，不受影响。

### 怎么验收

CI 的 `pnpm test` 通过，后面的 Windows E2E 能跑到。

### 主要改动

- `files/browse.test.ts`：期望值也用异步 `realpath`。

### 测试

`pnpm test` 本地通过。

### 新增依赖

无。

### 已知问题

无。

## 2026-11-06　文件列表放松，预览顶部去掉大小

> PR：分支 `fix/workbench-file-list`　作者：Claude Code

### 原始需求

用的时候发现文件列表太紧凑，参考 DeepSeek Harness 的文件列表；预览顶部的文件大小把文件名挤到上面，不好看。

### 怎么验收

1. 文件页签：行高 34px，字号 14，图标 16px，文档、代码、数据、表格、图片颜色不同。
2. 点文件：预览顶部只有一行路径，垂直居中。

### 主要改动

- `FilesPanel.tsx`：行距、图标、筛选框；预览顶部去掉大小。`lib/file-kind.ts`：按扩展名分类。
- 原型 `session.html` 同步。

配置项、数据库 schema 没有变化。

### 测试

- 单元测试：`lib/file-kind.test.ts`。
- E2E：`workbench.spec.ts` 的文件面板用例不变。

### 新增依赖

无。

### 已知问题

无。

## 2026-11-06　顶栏菜单去掉上下文两项

> PR：分支 `fix/session-menu-context`　作者：Claude Code

### 原始需求

顶栏 `…` 菜单里的“查看上下文”“压缩上下文”和输入框的用量环重复。

### 怎么验收

1. `…` 菜单只有导出 Markdown、导出 JSON、在访达中显示、重命名、置顶、删除。
2. 点输入框的用量环：打开上下文对话框，压缩按钮在里面。
3. 会话的模型从设置里删掉后（不知道窗口大小），用量环还在，只是没有百分比，也能点开。

### 主要改动

- `SessionMenu.tsx`：去掉两项。
- `Composer.tsx`、`SessionPage.tsx`：用量环一直显示，否则不知道窗口大小时上下文就没有入口了。
- 原型 `session.html`、`designs/README.md`、方案同步。

配置项、数据库 schema 没有变化。

### 测试

- E2E：`workbench.spec.ts` 的 `manages the session from the header menu`，`session-stream.spec.ts` 的 `reaches the context from the ring when the model window is unknown`。

### 新增依赖

无。

### 已知问题

无。


## 2026-11-07　改动面板打磨：修 diff 显示问题，加高亮、键盘切换、跳到文件

> PR：分支 `feat/workbench-diff-polish`　作者：Claude Code

### 原始需求

梳理侧栏“改动”面板：有没有 bug、怎么提升体验、在不加复杂度的前提下补哪些功能。原型 `designs/app/session.html?s=changes`。

用多文件的 Mock 场景实际跑了一遍，找到这些问题：

| 问题 | 现象 |
|---|---|
| 行号挤在一起 | 行号栏固定 28px，五位数行号（`10001 10002`）连成一串 |
| 文件名被截掉 | 路径从尾部截断，280px 的列表里只剩 `src/points/ledger/serv…`，最要紧的文件名看不到 |
| 统一视图横向滚动 | 长行不折行，窄栏里大半行看不到；横向滚动时标题栏和分段头跟着滚走 |
| 换文件不回顶部 | diff 区域没换组件，上一个文件滚到哪，下一个文件就从哪开始 |
| “进行中”被截掉 | 状态接在标题后面一起截断，标题一长就看不出这一轮还在跑 |
| 删除的文件 | “在文件夹中显示”指向不存在的文件，点了没反应；并排视图右半边整片空白 |
| 统一 / 并排不记 | 每次进会话都回到统一 |

### 怎么验收

用 Mock 内核：`KITS_KERNEL=mock KITS_MOCK_SCENARIO=changes pnpm dev`，首页发任意一句话，等完成。

1. 右侧页签顺序是“文件、改动 5”，默认打开文件（很多工作目录不是 Git 仓库，改动常常是空的，文件用得更多）。点对话里改文件的步骤仍跳到改动；关掉产出页签回到文件。点“改动”继续下面几步。
2. 窄栏：改动列表 5 个文件，目录灰色在前、文件名在后；`src/points/ledger/service/ledger_service.py` 显示成 `src/points/ledger… ledger_service.py`，文件名完整。轮次标题很长时，“进行中”（运行中才有）不会被截掉。
3. 点 `ledger_service.py`：行号 `9998`～`10004` 对齐、不重叠；代码有语法高亮（`def`、`return` 着色），新增行绿底、删除行红底；`+` `−` 不进选区，选中复制出来是干净的代码。
4. 点 `config/points.yaml`：超长的一行折行显示，没有横向滚动条。
5. 在 `ledger_service.py` 的 diff 里往下滚一点，再点别的文件：新文件从顶部开始。
6. 点中列表里的一个文件后按 ↑ / ↓：在所有轮的文件之间切换，焦点跟着走。
7. 标题栏右边三个图标：`@` 把路径填进输入框（接在已输入的内容后面）；“查看完整文件”切到文件页签并展开它所在的目录；“在文件夹中显示”在访达 / 资源管理器里选中。`legacy_cache.py`（已删除）只有 `@`。
8. ⌘\ 放大，切“并排”：`config/points.yaml` 左旧右新；`tests/points/test_idempotent.py`（新建）和 `legacy_cache.py`（删除）仍按统一视图显示。关掉应用再开，还是“并排”。
9. 深色主题下高亮配色正常。
10. 超过 2000 行的 diff 先显示前 2000 行，底下“还有 N 行没显示 · 全部显示”。（Mock 里没有这么大的文件，可以让真实 Agent 生成一份长文档验收。）

### 主要改动

- `session/panels/patch.ts`：新增 `gutterChars`（按最大行号算行号栏宽度）、`oneSided`（只有新增或只有删除）、`highlightSource`（diff 两侧各拼一段代码交给高亮，再按行取回）、`splitPath`。
- `session/panels/Workbench.tsx`：
  - 文件行和标题栏的路径改成“目录 + 文件名”，空间不够先截目录；完整路径另给读屏一份（两段是 flex 子项，读屏会在中间多读一个空格）。
  - diff 两种视图都折行（`pre-wrap` + `break-all`，保留缩进）；标题栏移出滚动区。
  - diff 按“轮次:路径”换组件，换文件回到顶部。
  - 复用文件预览的 shiki 高亮（`lib/highlight.ts`）；超过 5000 行或 30 万字符不高亮。高亮结果和算它的那份 patch 绑在一起，同一个文件的 patch 刷新后先显示纯文本，不会显示旧内容。
  - 单侧的改动并排时按统一视图显示；超过 2000 行先截。
  - 方向键换文件；标题栏的引用、查看完整文件、在文件夹中显示（删除的文件只留引用，工作目录外的文件不能在文件页签看）。
- `pages/session/SessionPage.tsx`、`Workbench.tsx`：页签改成文件在前、默认打开文件；关掉产出页签回到文件。
- `lib/ui-store.ts`：`diffView` 记在 localStorage（`kits.diff.view`）。
- `index.css`：diff 的 token 在深色主题下取 `--shiki-dark`（`.k-tok`）。
- `packages/kernel/src/mock/scenarios.ts`：新场景 `changes`（长路径、五位数行号、超长行、新建、删除）。
- 列表底下的说明缩成两行：“改动已经写进工作区。 / 要留就 Git 提交，不要就 Git 丢弃或让 Agent 改回。”
- 原型 `session.html`：文件行、标题栏图标、折行、轮次状态单独显示、说明文案；页签文件在前、默认打开文件。
- 配置项、数据库 schema 没有变化。

### 测试

- 单元测试：`patch.test.ts` 补 12 个（行号栏宽度、单侧判断、高亮的行映射、路径拆分；同一个文件的 patch 刷新后或超过高亮阈值时不用旧 token，review 发现）。
- E2E：`workbench.spec.ts` 新增 `walks through several changed files and jumps from a diff to the file`（五位数行号、方向键、删除的文件没有查看和显示、引用、查看完整文件）；`shows the changed files…` 改成先断言页签顺序和默认页签；`output.spec.ts` 关掉产出后回到文件。

### 新增依赖

无。

### 已知问题

- 高亮按 diff 两侧各拼一段代码：分段之间断开的地方如果正好在多行字符串、块注释中间，后面几行颜色可能不对，内容不受影响。
- 改动页签的计数还是按“轮 × 文件”算，同一个文件改了两轮算 2 个，和原型一致。
- diff 来自内核每轮前后的快照，工作区不是 Git 仓库时 OpenCode 不做快照，这一轮结束后改动列表会变空（进行中时按编辑步骤列出的文件也随之消失）。这次没改，待定方案。
- 还没有“合并所有轮”的视图，也不能展开分段之间没显示的上下文（要读文件全文，下一步再看）。
