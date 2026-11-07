# 交付说明：session

## 2026-11-04　会话主流程：输入框 → 会话页流式回复 → 停止 → 接着说

> 日期：2026-11-04　PR：见本分支 `feat/session-stream`　作者：Claude Code

### 原始需求

[phase1-implementation.md](../plans/phase1-implementation.md) 第 8 节 PR7：5.2 节 SessionService 核心、5.4 节数据库 schema；首页输入框（目录 / Agent / 权限 / 模型四个浮层，先只有发送）→ 会话页：用户消息、工作过程、正文、状态行、停止；侧栏会话列表；E2E `session-stream`。原型：[designs/app/index.html](../../designs/app/index.html)、[session.html](../../designs/app/session.html)（`?s=streaming`、`?s=done`）、[shell.js](../../designs/app/shell.js)（输入框和侧栏）。

做到什么程度算完：在首页输入任务、回车，进入会话页看到这一轮实时进来的思考、工作步骤和正文，结束后状态变“已完成”；运行中能停止；完成后能在同一个会话里接着说；侧栏按天分组列出会话。

### 怎么验收

1. `pnpm check` 全绿；`pnpm build && pnpm test:e2e` 全部通过，其中 `session-stream.spec.ts` 3 个是本 PR 的（Mock 内核，不调模型）。
2. 用 Mock 内核手动走一遍：`KITS_KERNEL=mock KITS_MOCK_SCENARIO=streaming pnpm dev`。
   - 先在设置 · 内核与模型里随便加一个网关（Mock 内核不连它），回到首页。输入框下面一排是 `+` 以外的四个浮层：目录（没选过时写“选择工作目录”，蓝色提示）、Agent（assistant）、权限（执行前确认 / 只读 / 全部自动，每项带一句说明）、内核与模型（上面切 OpenCode / CodeAgent，下面按网关分组的模型）。没选目录或没有模型时发送按钮灰着，悬停提示缺什么。
   - 选一个目录，输入任务，回车。进入会话页：右上角“运行中 · 第 1 轮 · 0:0x”在走，用户消息在右边气泡里，下面“第 1 轮 · 工作过程”展开着，思考、读取文件、修改文件一步步出现，正在跑的那步带转圈；等模型首字或工具在跑、2 秒没有新内容时出现灰色状态行“等待模型回复 / 正在执行命令：…”和秒数；正文按 Markdown 渲染（表格、行内代码），流式时末尾有闪烁的光标。
   - 回复结束：顶栏变绿色“已完成 · 1 轮”，工作过程自动收起（点开能看每一步，思考可展开）；侧栏“今天”下面出现这个会话。
   - 在底部输入框里接着说，回车，出现第 2 轮。会话页的输入框显示这个会话的目录、Agent、权限和模型，只读。
   - 换 `KITS_MOCK_SPEED=3` 再开一个会话，运行中按顶栏的“停止”或 ⌘.（Windows Ctrl+.），顶栏变“已停止”。
   - 换 `KITS_MOCK_SCENARIO=crash`：这一轮以红色出错块结束，写着“内核进程退出了…”，侧栏这个会话带红点和“出错”。
3. 用真实内核（`.env` 里的测试网关）：在设置里配好网关和默认模型，不设 `KITS_KERNEL`，首页发一句“列出当前目录的文件”，会话页能看到真实的工具步骤和回复。需要执行命令时（`bash` 在“执行前确认”下要询问）这一轮会停在“等你确认”，确认卡片在 PR8。

### 主要改动

- 数据库（`apps/desktop/src/main/db/schema.ts`，迁移 `drizzle/20261103181825_little_leo`）：`sessions` 补齐内核会话 id、模型、权限模式、状态、轮次、更新时间、最近错误；新增 `messages`、`parts`、`attachments`、`outputs`、`permission_log`；`parts` 除了按消息的索引，还有 `(session_id, created_at, seq)` 索引给打开会话用。旧库直接迁移（新列都有默认值）。
- `packages/core/src/session.ts`：会话、消息、part 的视图类型；`ipc.ts` 新增 `session.create / list / get / prompt / abort`、`workdir.pick`、`agents.list`，推送 `session.changed / message / part / activity`。
- `apps/desktop/src/main/sessions/`：
  - `thread.ts`：一轮的事件 → 消息和 parts 的纯函数（正文 / 思考按内核 partId 合并，工具一个 part 从 running 到 completed / error，权限请求让会话进入 waiting，出错的轮次留一个出错 part）。
  - `session-store.ts`：读写和视图转换；启动时把上次退出时还在跑的会话标成中断，没结束的助手消息一起收尾（`finishReason: error`）并留一个“应用退出时这一轮还没做完”的出错块，没回复的确认标成过期。
  - `session-service.ts`：建会话（标题取任务前 40 字）、发一轮（第一轮在内核里建会话，权限按 Agent 和会话模式算好随建会话一起发）、事件落库并推给界面（正文增量 50 ms 一批）、kits 工具的调用登记到关联表、停止。配置不全时这一轮以“配置不完整：…”结束。一轮从发出那一刻就登记，内核冷启动期间再发会被拒绝；这期间点停止，内核起来后这一轮直接以“已停止”结束，不会再发给内核。
  - 只有进内核配置的设置（网关、默认模型、关闭的技能）变了才重启内核；记最近目录、改外观不动内核（`kernel-config.ts` 的 `kernelSettingsKey`）。
  - 建会话时工作目录取真实路径：macOS 的 `/var` 等是软链接，内核按真实路径判断目录内外（PR2 契约测试发现）。最近用过的目录记进设置（最多 10 个）。
- `apps/desktop/src/renderer/src/`：
  - `shell/Composer.tsx`：输入框，自动长高（最多 220px），↵ 发送、⇧↵ 换行（输入法组字时不发送），四个浮层；`lib/composer-prefs.ts` 记住本次的选择（不写回设置）；模型按“手动选的 → Agent 配的 → 全局默认”取，指向的网关删了或停用了就往下退，都不能用就空着、发送置灰。发送失败（比如最近的工作目录被删了）时在输入框里说原因，草稿留着。会话页的输入框按会话隔离，草稿不会跟到别的会话。
  - `session/thread/derive.ts`：parts → 块（用户消息、工作过程、正文、状态行、出错）。工具名换成原型里的动作名（读取文件、搜索、执行命令、修改文件、新建文件、记忆、提交产出、调用平台…），工作目录下的路径显示成相对路径（先统一分隔符，Windows 的 `C:\repo` 也认）。
  - `session/thread/Blocks.tsx`、`Markdown.tsx`：各块的样子照原型；正文用 react-markdown + GFM，链接交给系统浏览器。
  - `pages/session/SessionPage.tsx`：顶栏、对话流（新内容来了滚到底，用户往上翻了不打扰，换会话重新跟随）、底部输入框。
  - `shell/SessionList.tsx`：侧栏会话列表，按自然日分组；过了午夜、窗口回到前台时重新分组（`lib/use-today.ts`）；运行中的会话给读屏补“运行中”。会话列表请求在路上时收到的推送记下来，快照回来后按顺序重放上去（不靠时间戳比新旧），后台会话做完的状态不会被旧快照盖回运行中。建会话时内核名在主进程里再校验一次。
  - `lib/sessions.ts`：会话列表随推送更新；打开的会话先拿快照再合并推送，离开后不再留它的数据（下次打开重新拿快照）。快照请求在路上时收到的推送先缓冲，快照装好后按顺序重放，比快照旧的按版本跳过（`lib/session-merge.ts`）；正文的 Markdown 组件按内容记忆化，流式时历史回复不重新解析。
  - `apply_patch` 步骤从 `patchText` 里读出目标文件，工作过程里显示路径、按文件去重计数；输入框“内核与模型”顶上的内核切换改成菜单自己的单选项，键盘能走到。
  - 正文的 Markdown 列表恢复圆点和编号（Preflight 清掉了），任务列表不加圆点；macOS 上顶栏的“停止”浮在拖动窗口的那条区域之上。
- 原型没画到、按风格补的：没选目录 / 没有模型时输入框上的提示；会话页输入框的只读标签；出错块现在是简化版（完整的出错卡片在 PR8）。
- 这一版没有：确认卡片、提问卡片、重试条、排队发送（PR8）；右侧面板和总结卡片（PR9）；导出（PR10）；附件和 `@`（PR11）；`/` 技能（PR13）；首页建议和“继续上次”（PR15）。

### 测试

- 单元测试：`thread.test.ts`（7 个：增量合并、工具状态、权限进出 waiting、用量累加、结束原因）；`session-service.test.ts`（8 个：Mock 内核跑完整一轮落库、推送通道、等确认再继续、停止、配置不全、第二轮复用内核会话、kits 工具登记）；`derive.test.ts`（7 个：工作过程和正文的划分、状态行三种文字、出错块、MCP 工具名）；`session-groups.test.ts`（按自然日分组，夏令时那天也对）；`composer-prefs.test.ts`（选过的模型失效时回退）；`kernel-config.test.ts`（哪些设置会重启内核）；`session-service.test.ts` 补内核启动期间重复发送被拒、停止后不再发给内核、退出时没结束的消息收尾；`derive.test.ts` 补 Windows 路径。
- E2E：`session-stream.spec.ts`：首页发送 → 流式 → 已完成、点开工作过程看到步骤、侧栏出现会话；⌘. 停止；同一会话接着说出现第 2 轮；做完一个会话马上新建下一个，内核不重启。

### 新增依赖

| 依赖 | 版本 | 用途 | 许可证 |
|---|---|---|---|
| react-markdown | 10.1.0 | 回复正文的 Markdown | MIT |
| remark-gfm | 4.0.1 | 表格、任务列表等 GFM 语法 | MIT |

都在 `apps/desktop` 的 devDependencies，打进渲染进程，纯 JS。

### 已知问题

- 等确认的会话在这一版没有确认入口（PR8 已补上）。
- 会话的标题先用任务的前 40 个字，第一轮完成后改成内核标题在 PR15 做历史页时一起看。
- 代码块没有高亮（PR9 加 shiki）。

## 2026-11-04　对话里的卡片：命令确认、Agent 提问、重试条、出错卡片、运行中排队

> 日期：2026-11-04　PR：见本分支 `feat/session-cards`　作者：Claude Code

### 原始需求

phase1-implementation PR8：会话里 Agent 要你动手的地方都在对话流里给卡片，照原型 `designs/app/session.html`（`?s=permission`、`?s=question`、`?s=error`）。

做到什么程度算完：执行前确认的命令能允许一次（⌘↵）、本会话允许（带规则）、拒绝并写原因（Esc）；`ask_user` 的提问能点选项或自己写，阻塞的提问 Agent 等回答，不阻塞的回答作为下一条消息发过去；网关断开时有重试条，可以“不等了”；内核退出或出错时有出错卡片，能“继续这一轮”、复制诊断信息、打开内核日志；Agent 运行中输入框可以继续说，消息在这一轮结束后发出。

### 怎么验收

用 Mock 内核，不需要模型。每条命令启动一次应用（`pnpm --filter @kits/desktop dev`，或 `pnpm build` 后直接跑 E2E）：

1. `KITS_KERNEL=mock KITS_MOCK_SCENARIO=permission`：首页发任意任务。对话里出现黄色卡片“执行命令前需要你确认”，黑底代码块里是 `$ uv run pytest tests/points -q`，工作目录写成 `~/…`；顶栏是“等你确认”。按 ⌘↵（Windows 是 Ctrl+↵），卡片消失，最后出现“12 个测试全部通过”，状态“已完成”。点开“第 1 轮 · 工作过程”，“执行命令”一行标“已允许”。
2. 同一场景再来一次，按 Esc：卡片里出现原因输入框并已聚焦，填“先别跑”回车。卡片消失，Agent 回“好的，不跑测试了…”，工作过程里这条命令标“已拒绝”。
3. 同一场景，输入框里写“顺便看下日志”回车：输入框上方出现虚线框“这一轮结束后发送”。点“允许一次”，这一轮结束后自动出现第 2 轮，用户消息是“顺便看下日志”。
4. `KITS_MOCK_SCENARIO=question`：出现蓝色卡片“Agent 提问 · 在哪个环境复现的？”，右上角“Agent 在等你回答”，顶栏“等你回答”；“测试环境”一项标“Agent 的假设”。点“预发环境”，卡片变成“已回答：预发环境”，Agent 接着说“明白了，按这个环境查网关日志”。
5. `KITS_MOCK_SCENARIO=retry KITS_MOCK_SPEED=5`：出现黄色重试条“模型网关断开，正在重试 · 第 1 次 · N 秒后重试”，点开看到原因 `Connection reset by server`；点“不等了，停在这里”，状态变“已停止”。
6. `KITS_MOCK_SCENARIO=crash`：出现红色卡片“这一轮没有完成”，里面是退出码和 panic 信息。点“复制诊断信息”，剪贴板里有 kits 版本、内核、模型、会话 id、工作目录和错误；点“打开内核日志”打开日志目录；点“继续这一轮”出现第 2 轮，用户消息“继续”，旧的出错卡片不再有按钮。没配网关就发任务（这一轮还没发到内核就失败了）：出错卡片的按钮是“重新发送”，配好后点它把原任务再发一次，而不是只发“继续”。

### 主要改动

- `packages/core`：part 新增 `question` 类型；`SessionSummary.queued`（排队的消息，不落库）；IPC 新增 `session.respondPermission`、`session.answerQuestion`；`app.info` 多给 `homeDir`。
- `apps/desktop/src/main/sessions/`：
  - `thread.ts`：`question / answer`；有未回复的确认或阻塞提问时会话保持 waiting；这一轮结束时没回复的确认、阻塞提问标成 `expired`（不阻塞的提问之后还能回答）。
  - `session-service.ts`：`respondPermission`（转给内核、更新 part、写 `permission_log`）；`askUser` 接到 kits 工具服务——阻塞的提问等 `answerQuestion`，不阻塞的直接按假设返回，回答作为下一条消息“关于“…”：…”发出；运行中 `prompt` 进队列，这一轮结束后合成一条发出；停止清空队列并让在等的提问返回。
  - `session-store.ts`：`questionPart`、`logPermission`。
- `apps/desktop/src/renderer/src/`：
  - `session/thread/derive.ts`：新块 `permission`（待确认）、`question`、`retry`（最后一个 part 是重试时）、出错块带 `last`；回复过的确认标在对应的工具步骤上（已允许 / 本会话允许 / 已拒绝）；`ask_user` 不再作为步骤出现；等确认、等回答、重试时不显示状态行。
  - `session/thread/Cards.tsx`：四种卡片，样子照原型。同时有几张待确认卡片时只有第一张响应 ⌘↵ / Esc；焦点在底部输入框时不抢快捷键。按钮点下去到主进程返回前不能再点，出错时卡片上提示。
  - `pages/session/SessionPage.tsx`：渲染卡片；顶栏在等回答时写“等你回答”；输入框运行中也能发，排队的消息显示在输入框上方。
  - `index.css`：卡片用的颜色令牌（warn / accent / danger 的描边、底色、图标底、深色字，代码块底色），深色值先占位（PR17 定稿）。
- 原型没画到、按风格补的：阻塞提问的“Agent 在等你回答”；过期提问的灰色状态；排队消息的虚线框；出错卡片没有原型里“用 OpenCode 继续”（PR19 有两个内核后再加）。

### 测试

- 单元测试：`thread.test.ts` 补 4 个（阻塞提问进出 waiting、不阻塞的不等、还有待确认时回答后仍 waiting、结束时过期）；`session-service.test.ts` 补 9 个（回复权限、写日志、拒绝带原因、阻塞提问回答后继续、停止时提问过期、不阻塞的回答作为下一条消息、排队后合并发送、停止清空队列、内核启动期间发的消息排队）；`derive.test.ts` 补 8 个（待确认卡片、回复标到步骤、拒绝后没工具步骤、提问代替步骤、重试条出现和消失、只有最后一轮能继续、`permissionSubject`）。
- E2E：`session-cards.spec.ts`（6 个）：⌘↵ 允许、Esc 拒绝写原因、回答阻塞提问、重试条“不等了”、出错后继续、运行中排队。会话类 E2E 的准备挪到 `e2e/tests/session.ts` 共用。

### 新增依赖

无。

### 已知问题

- 重试条没有原型里的“立即重试”：OpenCode 没有跳过等待的接口，只能“不等了”停下。
- 本会话允许后，同一会话里规则命中的命令不再问；规则只存在内核会话里，界面上还没有地方查看或撤销（原型右侧“本会话的允许规则”在 PR9 面板里做）。
- 侧栏的状态只分“等确认”，等回答的会话在侧栏也显示“等确认”。
- “本会话允许”的规则由内核给（OpenCode 的 `always`），内核没给时不显示这个按钮。

## 2026-11-04　产出面板：回复正文编辑、自动保存、导出；结构化产出 JSON

> 日期：2026-11-04　PR：见本分支 `feat/session-output`　作者：Claude Code

### 原始需求

phase1-implementation PR10（5.4 节 `outputs` 表、6.4 节产出页签）：一轮做完，Agent 的产出可以在右侧“产出”页签里改、自动保存，导出 Markdown；有输出格式的 Agent 用 `submit_output` 交的结构化结果能看 JSON、导出 JSON。AI 原稿和人工修改分开存，以后导出评测数据用。原型 `designs/app/session.html?s=output`。

做到什么程度算完：没有输出格式的 Agent，每轮正常结束后回复正文就是这一轮的产出；编辑后 600 ms 自动保存，底部说改了几处；能还原为 AI 原稿；导出到 `{userData}/exports/`，能在文件夹中显示，也能复制；结构化产出这一版只能看和导出（逐条审核在后续）。总结卡片第三格换成“产出”。

### 怎么验收

用 Mock 内核（`KITS_KERNEL=mock`）：

1. `KITS_MOCK_SCENARIO=done`：首页发任意任务。完成后总结卡片第三格是“产出 · 回复正文 · 可以编辑后导出”，点它打开右侧“产出”页签，编辑框里是回复正文（Markdown 源码）。
2. 在末尾加一句。顶上变成“回复正文 · Markdown · 已编辑”，底部“改了 1 处，和 AI 原稿的差异会记下来 · 自动保存”。切到别的会话再回来，改的内容还在。
3. 点“导出 → 导出 Markdown 文件”：出现“已导出到 20261104-<标题>.md · 在文件夹中显示”，点后者在访达 / 资源管理器里选中文件，内容是改过的版本。“复制到剪贴板”复制同样的内容。
4. 点“还原为 AI 原稿”：编辑框回到原稿，“已编辑”消失。
5. 结构化：在 `~/.kits/agents/` 放 `api-reviewer.md`（frontmatter 写 `output: findings.schema.json`）和对应的 schema，`KITS_MOCK_SCENARIO=output-structured`，选这个 Agent 发任务。完成后“产出”页签是“结构化结果 · JSON”，导出 JSON 文件内容就是 Agent 交的结果。
6. 同一个会话接着说第 2 轮：产出页签右上能切“第 1 轮 / 第 2 轮”，导出文件名带“-第N轮”。

### 主要改动

- 数据库：`outputs` 加 `turn` 列（每轮一份，id 是 `<会话 id>:<轮次>`），迁移 `drizzle/20261103202521_ordinary_sunfire`。
- `packages/core`：`OutputView`；IPC `output.list / save / export`、`app.revealPath`；推送 `session.output`。
- `apps/desktop/src/main/sessions/`：
  - `thread.ts`：`answerText()`，最后一个工具之后的正文。
  - `session-service.ts`：一轮正常结束、Agent 没有输出格式时把回复正文存成这一轮的 text 产出；`outputSchema / onOutput` 接到 kits 工具服务，`submit_output` 校验通过后存成 structured 产出（同一轮再交一次就替换，人工修改作废）；`saveOutput`（改回和原稿一样就当没改）；`exportOutput` 写到 `{userData}/exports/<日期>-<标题>[-第N轮].md|json`（重名时加 `-2`、`-3`，不覆盖之前导出的），记下导出时间和格式。
  - `session-store.ts`：产出的读写。
- `apps/desktop/src/main/platform.ts`：`revealPath`（`shell.showItemInFolder`）。
- `apps/desktop/src/renderer/src/session/panels/`：`OutputPanel.tsx`（产出页签；导出前先把编辑框里没存的改动存掉，复制取编辑框里的最新内容，还原时先撤掉待发的自动保存、等在路上的保存落地，不会被旧保存写回来）、`edits.ts`（按行对齐算“改了几处”）；`Workbench.tsx` 加“产出”页签；`Summary.tsx` 第三格换成产出。
- 原型没画到、按风格补的：导出后的提示条；多轮时的轮次切换；结构化结果的只读 JSON 视图（原型是逐条审核，那是后续）。原型顶栏完成后的“导出”按钮没做，导出放在产出页签里。

### 测试

- 单元测试：`session-service.test.ts` 补 5 个（回复正文成为产出、修改和原稿分开存 / 改回原稿、导出 Markdown 到 exports、submit_output 存成结构化产出并导出 JSON、文件名）；`edits.test.ts`（3 个）。
- E2E：`output.spec.ts`（2 个）：改回复正文 → 自动保存（原稿不变）→ 导出 Markdown → 还原；有输出格式的 Agent 交的 JSON → 导出。

### 新增依赖

无。

### 已知问题

- 结构化产出不能改，只能看和导出；逐条审核、Excel 导出、推送到缺陷平台在后续。
- 导出到固定的 `exports/` 目录，没有“另存为”。
- 评测数据（原稿 + 修改的 JSONL）的导出入口还没有，数据已经分开存好。

## 2026-11-04　附件和 @ 引用：上传、拖进来、转文本，@ 工作目录里的文件

> 日期：2026-11-04　PR：见本分支 `feat/session-attachments`　作者：Claude Code

### 原始需求

phase1-implementation PR11：输入框能带附件（需求文档、用例、日志），Word 和 PDF 转成文字随消息发给 Agent；能拖文件进输入框；`+` 菜单里有“上传文件”和“引用文件”；打 `@` 弹出工作目录里的文件。原型 `designs/app/shell.js` 的 `+` 浮层和 `@` 菜单。

做到什么程度算完：首页和会话页的输入框都能加附件、去掉附件；Word（.docx）、PDF、Markdown 和纯文本类文件转成文字发给内核，读不了的文件说清楚是哪个、草稿和附件都留着；用户消息下面有附件芯片；`@` 菜单按路径搜工作目录里的文件，↑↓ 选、↵ 引用、Esc 关。

### 怎么验收

用 Mock 内核（`KITS_KERNEL=mock KITS_MOCK_SCENARIO=done`）：

1. 首页点输入框左下的 `+` → “上传文件”，选一个 .docx 和一个 .md。输入框上方出现两个附件芯片（名字和大小），点 × 能去掉。
2. 写任务回车：会话页的用户消息下面有这两个附件。`{userData}/attachments/<会话 id>/` 里有原文件和转出来的 `.txt`。
3. 把一个 .txt 文件拖进输入框：拖的时候输入框出现“松开添加附件”，松开后多一个芯片。再拖一张 .png 进去发送：输入框里提示“shot.png：这一版只支持 Word（.docx）、PDF、Markdown 和纯文本类文件”，没有建会话，草稿和附件都还在。
4. 工作目录里放 `src/points/redeem.py`，在输入框打 `看下 @red`：弹出“工作目录里的文件”，只有 `src/points/redeem.py`（`node_modules` 之类的目录不搜），回车后输入框变成 `看下 @src/points/redeem.py `。`+` → “引用工作目录里的文件”也会插一个 `@` 并弹出菜单，Esc 关掉。
5. 真实网关：带一份 PDF 需求让 Agent 总结，回复里能看到 PDF 里的内容。

### 主要改动

- `packages/core`：`AttachmentInput`（名字、类型、字节）和 `AttachmentView`；`CreateSessionInput.attachments`、`session.prompt` 的 `attachments`；`SessionDetail.attachments`；IPC `files.search`；推送 `session.attachments`。
- `apps/desktop/src/main/attachments/extract.ts`：附件转文本。Word 用 mammoth 取正文，PDF 用 pdfjs-dist 逐页取文字（不渲染，不装 `@napi-rs/canvas`），Markdown / 纯文本 / 代码 / 日志 / CSV / JSON 按 UTF-8 读；单个附件超过 20 万字截断并注明；图片和其他二进制文件报错。
- `apps/desktop/src/main/files/search.ts`：列工作目录里的文件（跳过 `.git`、`node_modules`、`dist`、`.venv` 等，最多 2 万个，缓存 30 秒），按“文件名开头 > 文件名包含 > 路径包含”排序，返回 30 个。
- `apps/desktop/src/main/sessions/session-service.ts`：建会话、接着说时先把附件存到 `{userData}/attachments/<会话>/`（原文件 + `.txt`），读不了就报错、会话不建；这一轮的用户消息建好后写 `attachments` 表；转出来的文字随消息发给内核（适配器包成 `<attachment name="…">` 段）；运行中排队的消息带着附件，合并时一起发。单个附件上限 20 MB。一批里有一个读不了就整批的文件都删掉；转附件期间点了停止，这条追问作废、文件删掉；停止时丢掉的排队消息，附件也删掉。读不了的错误都带文件名。
- `apps/desktop/src/renderer/src/shell/Composer.tsx`：`+` 菜单（上传文件、引用工作目录里的文件）、拖放、附件芯片、`@` 菜单；`shell/composer-at.ts` 是 @ 查询和替换的纯函数（只吃掉紧跟的一个空格，换行留着）。发送期间新加的附件不会被清掉；@ 结果还没回来时回车不发送；输入框按组合框标注（`aria-activedescendant` 指向选中的文件），读屏能读出当前选项。
- `session/thread/Blocks.tsx`：用户消息下面的附件芯片。
- `pnpm-workspace.yaml`：`overrides` 去掉 `@napi-rs/canvas`（pdfjs-dist 的可选原生依赖，只在渲染页面时用）。
- 原型没画到、按风格补的：拖放时的“松开添加附件”遮罩；读不了附件时的报错；`+` 菜单里原型还有“本次会话可用的平台”开关，那是 PR12 的 MCP。

### 测试

- 单元测试：`extract.test.ts`（5 个：Word、PDF、Markdown 换行、超长截断、图片报错，fixture 是仓库里的 `requirement.docx` 和 `spec.pdf`）；`files/search.test.ts`（3 个：跳过的目录、排序、缓存）；`composer-at.test.ts`（5 个）；`session-service.test.ts` 补 3 个（附件落库并随消息发给内核、读不了不建会话、排队消息带附件）。
- E2E：`attachments.spec.ts`（3 个）：上传 Word 和 Markdown → 芯片 → 发送 → 用户消息下的附件和存下来的文件；拖进来、拖一张图被拒；`@` 引用和 `+` 菜单的引用。

### 新增依赖

| 依赖 | 版本 | 用途 | 许可证 |
|---|---|---|---|
| mammoth | 1.13.0 | Word（.docx）取正文 | BSD-2-Clause |
| pdfjs-dist | 6.5.438 | PDF 取文字 | Apache-2.0 |

都在 `apps/desktop` 的 dependencies，在主进程里用，纯 JS。pdfjs-dist 的可选依赖 `@napi-rs/canvas` 是原生模块，用 `overrides` 去掉了（只取文字用不到）。内网镜像要能装这两个包。

### 已知问题

- 图片还不能发（要走内核的文件 part，模型也要支持看图），这一版直接报错。
- 旧的 .doc、Excel、PPT 不支持；扫描版 PDF 没有文字层，取不到内容。
- `@` 只引用工作目录里的文件，引用需求平台、用例平台在 PR12 接 MCP 之后。
- 附件转出来的文字整段放进消息，很长的文档会占上下文；PR16 做上下文用量提示。

## 2026-11-04　会话历史、⌘K 全文搜索、删除会话、首页建议和“继续上次”

> 日期：2026-11-04　PR：见本分支 `feat/session-history`　作者：Claude Code

### 原始需求

phase1-implementation PR15（5.4 节 `sessions_fts`、6.3 节 `history.html` / `index.html` / `shell.js` ⌘K）：会话历史页（状态筛选、目录和 Agent 筛选、按时间分组）、⌘K 搜会话（标题 + 片段高亮，FTS）、删除会话、首页四条建议和“继续上次”三张卡。

做到什么程度算完：⌘K 能按回复正文里的词搜到会话并高亮；历史页筛选、删除可用；首页点建议填进输入框，“继续上次”把等人处理的排前面。

### 怎么验收

1. 用 Mock 内核（`KITS_KERNEL=mock`）建两个会话：“给兑换接口加幂等校验”“排查订单退款超时”。
2. ⌘K 输入 `idempotent`（只在回复正文里出现）：两个会话都列出来，正文片段里 `idempotent` 高亮，右边是目录和时间。输入 `退款`（两个字）：只剩标题里有“退款”的那个，标题里高亮；回车打开它。没输入时列最近 5 个会话；“新会话：“…””会把输入的话填进首页输入框。
3. 侧栏“搜索”旁边的“全部会话”或首页“全部会话”进会话历史：顶上“本机共 2 个”；“全部 / 进行中 / 等我处理 / 已完成”筛选，“等我处理”包括待确认、有提问和出错的；“所有目录”“所有 Agent”下拉筛选；按今天 / 昨天 / 本周 / 更早分组。
4. 鼠标移到一行，右边出现删除按钮，点一下变“确认删除”，再点删掉：历史页和侧栏都少了它，附件目录一起删。运行中、等确认的会话没有删除按钮（服务端也拒绝：“会话还在运行，先停止再删”）。
5. 首页：输入框下面四条建议，点了把完整的一句填进输入框；下面“继续上次”最多三张卡，等你处理的、出错的排在前面。
6. 升级已有数据库：迁移会把已有会话的标题、消息、回复正文写进搜索索引，老会话也能搜到。

### 主要改动

- 数据库：迁移 `20261103221509_sessions_fts`（手写 SQL）建 FTS5 虚表 `sessions_fts(session_id, title, content)`，分词器 `trigram`（中文也能子串匹配），并回填已有会话。`node:sqlite`（Node 24、Electron 内置的 SQLite 3.53）都带 FTS5，实测过。
- `main/sessions/session-store.ts`：`reindex`（标题 + 用户消息 + 回复正文，按时间连起来）、`search`（每个词都不少于 3 个字走 FTS 的 `MATCH`、`highlight`、`snippet`、按相关度排；否则走 `LIKE`，自己标命中和截片段；引号、`%`、`_` 当普通字符）、`remove`。命中部分用控制字符 `\u0001…\u0002` 标出。
- `main/sessions/session-service.ts`：用户发消息、一轮结束时更新索引；`search`、`remove`（运行中拒绝，删附件目录）。IPC `session.search`、`session.remove`。
- 渲染进程：`pages/history/HistoryPage.tsx`；`pages/home/HomePage.tsx`（建议、继续上次）；`shell/Palette.tsx` 接会话搜索（输入停 120ms 再查，会话和动作一起用 ↑↓ 选）；`ui/Highlight.tsx`；`lib/session-labels.ts`（“12 分钟前 / 昨天 14:05 / 周一”、状态字和颜色、筛选、继续上次的排序）；`lib/ui-store.ts` 的 `fillHome`（往首页输入框填一句话）。
- 原型没画到、按风格补的：删除按钮（悬停出现、点两下）；“等我处理”加上出错的；历史行的第二行是“N 轮 · Agent”，出错时显示错误，等处理时说明在等什么（原型里的“改了 5 个文件 · 16 个测试通过”要统计每个会话的改动和测试结果，这版没做）。首页建议换成了测试工作相关的四条。

### 测试

- 单元测试：`session-store.test.ts`（6 个：正文命中和高亮、只有标题命中、短查询走 LIKE、多个词都要命中、引号和通配符当普通字符、删除后搜不到）；`session-service.test.ts` 补 2 个（一轮结束后能搜到、运行中不能删）；`session-labels.test.ts`（5 个）。
- E2E：`history.spec.ts`（3 个）：⌘K 按正文搜到并打开；历史页筛选、删除；首页建议填入和继续上次。

### 新增依赖

无。

### 已知问题

- 删除只删 kits 自己的记录和附件，内核数据目录里的会话记录还在（内核没有提供删会话的接口给 kits 用；它只在 kits 的数据目录里，不影响别的工具）。
- 搜索只搜标题、用户消息和回复正文；工具的输出（命令结果、读到的文件）、附件内容不搜。
- 两个字以内的查询走 LIKE，会话很多时会慢一些（逐行扫描），几千个会话以内感觉不到。

## 2026-11-04　上下文用量、接近上限提示、手动压缩；记忆（remember、设置页列表、注入内核）

> 日期：2026-11-04　PR：见本分支 `feat/session-context`　作者：Claude Code

### 原始需求

phase1-implementation PR16（3.5 节记忆、6.4 节会话页的上下文、原型 `session.html` 的 context 场景、`settings.html#skills` 下半的记忆）：上下文用量按模型的 `contextWindow` 算，接近上限时提示，能手动压缩，压缩后对话里留一条分隔线；Agent 用 kits 工具 `remember` 记下约定，写进项目或个人的 `memory.md`，设置页能看、改、删、手动加，两份文件注入每次会话。

做到什么程度算完：上下文过八成时输入框上方出现提示，点“现在压缩”后出现“前 N 轮已压缩成摘要”的分隔线、能展开看摘要，用量从摘要重新算；`remember` 调用后文件里多一条，设置页能看到并编辑。

### 怎么验收

1. 设置 → 内核与模型，把模型的上下文窗口改小（比如 25K），用 Mock 内核（`KITS_KERNEL=mock`）发一个任务：这一轮用了 21K，输入框上方出现黄色提示“上下文已用 21K / 25K。……”，右边两个按钮。
2. 点“现在压缩”：对话里先出现“正在把前 1 轮压缩成摘要…”，然后变成分隔线“前 1 轮已压缩成摘要 · 时间”，点开是 Markdown 摘要；提示消失；右侧“上下文”页签的用量变成 1K / 25K。压缩期间发的消息排到压缩之后发。
3. 右侧“上下文”页签也有“压缩上下文”按钮（运行中不能点），还多了一行“记忆：项目 N 条 · 个人 N 条”。
4. 提示里的“带着结论新开会话”：回到首页，目录和 Agent 跟原会话一样，输入框里先写好“接着会话“…”继续：”。
5. 用真实内核让 Agent 记一条（比如说“记住：测试命令是 uv run pytest”）：`<工作目录>/.agents/memory.md` 多一行 `- 测试命令是 uv run pytest <!-- session:<会话 id> 日期 -->`；下一个会话里 Agent 知道这条。
6. 设置 → 技能与记忆，下面“记忆”卡片：项目 / 个人切换；每条显示来源（会话“…” / 手动添加 / 在文件里手写的）和日期；“编辑”“删除”直接改文件（文件里的标题、空行、手写的说明原样保留）；“手动加一条”；“打开文件”用系统程序打开（没有就先建一个空的）。
7. 个人记忆文件第一次建出来时内核按新配置重启（之后的会话才读得到）。

### 主要改动

- 内核：`AgentKernel.summarize` 改成返回摘要正文和 token 数（`CompactionResult`）。OpenCode 适配器 `POST /session/{id}/summarize`（等它做完，最长 5 分钟）后读 `summary: true` 的那条助手消息；Mock 给一份固定摘要。契约测试用真实 OpenCode 1.19.5 跑过：压缩请求走假网关，返回的摘要就是网关回的那句。
- `main/sessions/session-service.ts`：`compact(id)`。压缩记成一条单独的助手消息（只有一个 `compaction` 块，`finishReason: compaction`，`contextTokens` 是摘要的大小），期间会话显示运行中、发的消息排队；失败时块标出错、会话回到原来的状态、把原因抛给界面。`sessionFor(ctx)` 给 `remember` 找会话。IPC `session.compact`。
- `main/memory/memory-service.ts`：读写两份 `memory.md`（`list / add / update / remove / ensure`），同样的话不重复记；个人文件第一次建出来时通知内核重启。`index.ts` 把 `remember` 接到它，按会话的工作目录写项目记忆。IPC `memory.list / add / update / remove / open`。
- 内核配置的 `instructions`：个人记忆用绝对路径（存在才列），项目记忆写相对路径 `.agents/memory.md`，内核按会话目录往上找。
- 渲染进程：`session/thread/derive.ts` 的 `compaction` 块和 `Blocks.tsx` 的 `CompactionDivider`；`pages/session/SessionPage.tsx` 的 `ContextBanner`（八成以上、不在运行、刚压缩过不显示）；`session/panels/Workbench.tsx` 上下文页签的压缩按钮和记忆条数；`pages/settings/skills/MemorySection.tsx`。
- 原型没画到、按风格补的：压缩失败的分隔线；“带着结论新开会话”填进输入框的那句话；记忆的编辑框和“在文件里手写的”来源。原型上下文用量条分三段（系统提示 / 前面几轮 / 最近一轮），内核不给这个拆分，这版还是一段。

### 测试

- 单元测试：`memory-service.test.ts`（5 个：写项目记忆带来源日期、不重复、个人文件第一次建出来通知重启、改删保留非列表行、没工作目录不能写项目记忆）；`session-service.test.ts` 补 3 个（压缩后存摘要并从摘要算上下文、运行中不能压缩、压缩期间发的消息排到之后）；`opencode-family.test.ts` 补“读回摘要正文和大小”；契约测试补“真实内核压缩并返回摘要”。
- E2E：`context-memory.spec.ts`（2 个）：接近上限提示 → 现在压缩 → 分隔线和摘要 → 用量重算；设置页加、改、删项目记忆，切到个人再加一条。

### 新增依赖

无。

### 已知问题

- 内核自己触发的自动压缩只显示“内核自动压缩了前面的对话”，没有摘要正文（事件里不带）。
- 上下文页签的记忆条数在打开页签时读一次，会话里新记的要切一下页签才更新。
- 删除记忆按文件里的第几条来删：设置页开着时人在编辑器里改了文件，先刷新再删（序号对不上时会提示“这条记忆已经不在了”）。

## 2026-11-04　会话置顶、跳转至底部、细滚动条，去掉完成后的总结卡片

> 日期：2026-11-04　PR：见本分支 `feat/session-pin-and-jump`　作者：Claude Code

### 原始需求

用户提的五点：

1. 会话能置顶。
2. 对话能跳转至底部。按钮不常驻，只在需要时出现。
3. 滚动条太粗。
4. 每次完成后的“这个会话做了什么”卡片不是必须的，右侧面板都有，有时造成视觉干扰。

5. 消息底部的“复制回复”文字换成图标，中间的回复也要能复制。

第 4 点的结论是去掉：三格内容和面板页签重复，点了也只是切页签，改动和命令的数量页签上有角标。只留“复制回复”，这个面板里没有。消息时间评估后不加：侧栏有更新时间，每轮有耗时，常驻时间是新的干扰。

原型：[designs/app/shell.js](../../designs/app/shell.js)（`.kn-row`、`.kn-pin`、滚动条）、[session.html](../../designs/app/session.html)（`.k-jump`）、[history.html](../../designs/app/history.html)。

### 怎么验收

准备：配好模型，至少建两个会话，其中一个发三四轮消息。

1. 鼠标移到侧栏的一个旧会话上，行尾出现图钉。点它：侧栏最上面出现“置顶”分组，这个会话移进去，它的“最后更新时间”不变。
2. 再置顶一个，后置顶的排在上面。给置顶的会话发一条消息，它的位置不动，不会掉回“今天”。
3. 关掉应用再打开，置顶还在。启动时打开的仍是最近更新的会话，不是置顶的那个。
4. 打开“全部会话”：最前面也有“置顶”分组，行尾在删除按钮左边有图钉。点它取消置顶，分组消失，侧栏同步。
5. 打开长对话。在底部时看不到跳转按钮。往上滚，输入框上方出现圆形向下箭头；滚回底部，按钮自动消失。
6. 往上滚后点按钮：立刻到底部，按钮消失，之后的新内容继续自动跟随。
7. 让 Agent 跑一轮，运行中往上滚：不被拉回底部，按钮一直在。不动的时候按钮不闪。
8. 往上滚一小段，把窗口拉高到看见底部：按钮消失，之后的新回复继续自动跟随。
9. 滚动条：对话、右侧面板、侧栏的滚动条都是约 4px 的细条，鼠标移上去加深；深色主题同样。
10. 一轮结束后，对话末尾没有总结卡片。最后一条回复下面一直有复制图标，点了变成对勾约 1.5 秒，粘贴出来是这条回复的 Markdown 原文。
11. 发两轮以上：前面的回复平时不显示图标，鼠标移到回复上才出现，点了复制的是那一条。回复还在流式输出时没有图标。

### 主要改动

- `sessions` 表加可空列 `pinned_at`（迁移 `20261104073523_session_pinned`，纯加列，老数据都是未置顶）。`SessionSummary` 加 `pinnedAt`。
- 新 IPC `session.setPinned`，改完经 `session.changed` 推回。不更新 `updatedAt`：否则置顶会把旧会话算成今天，取消后也回不到原分组。
- `groupSessions` 加 `pinned` 组，后置顶的在上。排序只在分组里做，`session.list` 的顺序不变，所以“打开上次的会话”不受影响。
- `SessionList`：每行包一层，图钉是链接的兄弟节点（`<a>` 里不能放按钮）。`PinButton` 和全部会话页共用。全部会话页时间列加宽给图钉让位。
- `session/thread/follow-bottom.ts`（新增）：把 `SessionPage` 里的跟随逻辑搬出来。两处行为变化：
  - 只有往上滚才算翻走。内容变高时 `scrollTop` 不变，以前可能被误判成翻走，现在继续跟随。
  - 用 `ResizeObserver` 盯尺寸，展开卡片、输入框变高时也能贴住底部，按钮状态也能更新。窗口变高或内容变少回到底部时不会有 scroll 事件，也在这里恢复跟随。
- 跳转用瞬时滚动，不用平滑滚动：流式输出时平滑滚动的终点会过期，长对话里动画也久。
- `index.css` 全局 `::-webkit-scrollbar`，颜色用现有令牌，不加新令牌。
- 删除 `session/panels/Summary.tsx` 和 19 条文案。新增 `session/thread/CopyReply.tsx`，放在 `TextBlock` 里，每条回复一个。原型同步去掉卡片，“复制”换成图标。配置项没变。

### 测试

- 单元测试：分组（置顶优先、后置顶在上）、跟随判定（往上滚、内容变高、回到底部）、`setPinned` 不改 `updatedAt` 并推送。`pnpm test`。
- E2E：`history.spec.ts` 覆盖置顶、重启保留、全部会话取消置顶；`session-stream.spec.ts` 覆盖按钮出现和消失、窗口变高回到底部后恢复跟随、完成后没有总结卡片、复制图标的显隐和复制内容。`workbench`、`output` 两个用例改成从面板页签进入。先 `pnpm -F @kits/desktop build`，再 `pnpm test:e2e`。

### 新增依赖

无。

### 已知问题

- 全量跑 E2E 时 `shell.spec.ts` 的“resizes the sidebar by dragging”失败过一次（拖动的中间鼠标事件丢失，宽度停在 260），单独重跑 3 次都通过，和这次改动无关，是用例在高负载下不稳。
- 原型里完成态的“重新生成”和评价按钮一直没有实现，这次没动。

## 2026-11-05　工具结果在对话里就地看，命令步骤带模型写的描述

> 日期：2026-11-05　PR：见本分支 `feat/session-inline-tool-results`　作者：Claude Code

### 原始需求

工具结果放在右侧“命令”页签有几个问题：步骤和结果连不上，只有 bash 有结果可看，窄栏里终端输出折得很碎，退出码非 0 的命令在步骤上看不出失败，一屏“执行命令”看不出每步在做什么。参考 Claude、Codex、lovia 的做法，改成在对话里就地展开，并给命令加一句话描述。

评审结论：结果就地展开；“命令”页签去掉，审计记录有需要时再加；本会话允许规则移到“上下文”。原型 `designs/app/session.html`（`?s=done` 展开第 2 轮，`?s=streaming`、`?s=question`、`?s=error`）。

做到什么程度算完：所有工具的结果都能在步骤上点开看，失败一眼能看到，模型写了描述就用描述当标题，内网连不上 npm 时内核不被插件拖慢，Agent 跑的 `npm install`、本地 MCP 的 `npx` 不受影响。

### 怎么验收

用 Mock 内核：`KITS_KERNEL=mock KITS_MOCK_SCENARIO=<场景> pnpm dev`，首页发任意任务。

1. 场景 `done`：完成后“第 1 轮”标题是“读 1 个文件 · 改 1 个文件 · 运行 1 条命令”，右边是耗时。点开，“跑 points 的测试”是标题，下面小字是 `uv run pytest tests/points -q`，右边“1.2 秒”。
2. 点这一行：下面展开 `$ uv run pytest tests/points -q`、输出 `12 passed`、“自动允许”，小字那行消失。鼠标移到命令或输出上，右上角出现复制图标，点了变绿色对勾，剪贴板里没有 `$`。
3. 点“修改 src/points/redeem.py”：右侧切到“改动”并选中这个文件。先点右上角收起面板再点，面板会打开。
4. 右侧只有“改动 / 产出 / 上下文”三个页签。
5. 场景 `command-failed`：标题右边红字“1 步失败”。点开，命令行的图标和“退出 1”是红的，已经自动展开，只有结尾 12 行，框底写“0.9 秒 · 自动允许”；点“显示前面 2 行”看到全部。
6. 场景 `permission`：等确认时步骤右边写“等待确认”；点“本会话允许”，完成后点开这一步，框底写“本会话允许”，“上下文”页签底部“允许规则”列出 `uv run pytest *`。拒绝时步骤右边写“已拒绝”，不算失败。
7. 按 Tab 能走到轮次标题、步骤、“显示前面”、复制图标，都有焦点框，回车可以操作。
8. 真实模型（`.env` 的网关）：让 Agent 跑几条命令，每条命令的标题是一句中文描述。读文件、搜索的步骤点开是文件内容和命中行，路径相对工作目录，右边是行数、处数；改文件的步骤右边是 `+N −M`。

### 主要改动

- `packages/kernel`：
  - 新增 `generate/describe-bash-plugin.ts`，写到配置目录的 `plugins/kits-describe-bash.js`。OpenCode 1.19.5 的 bash 没有 `description` 参数，配置也加不了，只能用 `tool.definition` 钩子改模型看到的参数表。内核的校验不变，模型漏写时命令照常跑，界面显示命令本身。`input` 本来就落库，事件映射和数据库都不用为描述改。
  - 内核启动时会往每个配置目录 `npm install @opencode-ai/plugin`，有插件时加载前要等它结束，实测 registry 连不上时卡 70 秒以上。`node_modules` 在、`package-lock.json` 根包声明了这个依赖时它就跳过，所以启动前在 kits 的配置目录和内核的全局配置目录放好这两样（`skipPluginInstall`）。插件不依赖这个包。不用 npm 离线环境变量：子进程的环境变量会传给 Agent 跑的命令和本地 MCP，`npm install`、`npx -y` 都会失败。
  - 插件只发给 OpenCode。CodeAgent 真机没验过，加载前等 npm 的话内网会卡启动，先不发。
  - 事件映射取 `metadata.filediff`（edit 的增删行）、`matches`（grep）、`count`（glob）、`display.totalLines`（read）。Mock 加 `command-failed` 场景。
- `packages/core`、`apps/desktop/src/main/sessions/thread.ts`：`tool-end` 事件和工具 part 加 `additions`、`deletions`、`count`。JSON 字段，数据库 schema 没变。
- 渲染进程：
  - `session/thread/derive.ts`：步骤带图标、动词、描述、输出、失败标记、框底信息。退出码非 0 算失败（以前步骤上看不出来），拒绝、中断不算。去掉给模型看的 `<shell_metadata>`、read 的 `<path>`/`<content>` 包装、grep 的 “Found N matches”，grep 的文件名和 glob 的结果转成相对路径；源码、命中行、MCP 返回的正文不动，看到和复制的都是原文。`clipOutput` 按 12 行截，命令留结尾，其余留开头。
  - 新增 `session/thread/Steps.tsx`：步骤行和结果框。`Blocks.tsx` 的轮次标题改成摘要单行截断，失败数和耗时不被挤掉。
  - `session/panels`：去掉“命令”页签和 `deriveCommands`；选中的文件提到 `SessionPage`，对话里能跳过来；允许规则进“上下文”。
  - `ui/Spinner.tsx` 合并了两份转圈组件。`CopyReply.tsx` 抽出 `CopyIcon`。
- 配置项：无新增。
- 原型没画到、按风格补的：网页、子任务、计划、技能的图标；过程中说明文字的步骤（多行时能点开看全文）；运行中的命令显示已运行时长，等确认时显示“等待确认”。
- 和原型的差别：允许规则没有“撤销”按钮，现在没有对应接口，以前的页签里也没有。

### 测试

- 单元测试：`thread/derive.test.ts` 的 `tool steps`（描述和回退、耗时和允许方式、非 0 退出码、失败计数、拒绝不算失败、中断、运行中计时、等待确认、输出清理、正文里的工作目录不被改、改文件跳转、失败的改文件展开、MCP 参数、多行说明、状态行）和 `clipOutput`；`events.test.ts` 的四种工具数字；`opencode.test.ts` 的跳过安装、不设 npm 环境变量；`codeagent.test.ts` 不发插件；`opencode-config.test.ts` 的插件文件。`pnpm test`。
- 契约测试：`opencode-family.contract.test.ts` 校验真实内核把 `description` 送到了模型的参数表，其余参数还在，事件里的 `input` 带描述。这组测试的 registry 指到连不上的地址，内核等 npm 的话用例会超时（去掉 `skipPluginInstall` 确认过）。
- E2E：`workbench.spec.ts` 覆盖点开步骤看输出、跳到改动、失败默认展开和显示前面的行、复制反馈、等待确认和允许规则；`session-cards.spec.ts`、`session-stream.spec.ts` 跟着改。`pnpm build && pnpm test:e2e`。

### 新增依赖

无。

### 已知问题

- CodeAgent 没有验证过，本机没有二进制。现在不发插件，步骤显示命令本身；真机核对后再打开，已记进 `docs/references/codeagent-checklist.md` 第 25 项。
- Windows 没有实测。代码里 bash 工具的 id 和参数表各平台共用同一份。
- 插件要写死 bash 的完整参数表，升级内核时要对一遍。契约测试只校验这几个参数还在，内核新增参数时测不出来。
- 工作目录里有 `.opencode/`、没有装过依赖、又连不上 registry 时，内核还是会等 npm。这个目录在用户的仓库里，kits 不往里写文件。
- 输出要等工具结束才有，运行中的命令点开只有“运行中，结束后显示输出”。
- 步骤多时没有把连续同类步骤合并成一组。
- 这次动过的旧会话：`additions`、`count` 是新字段，旧会话的步骤右边没有数字，描述和输出不受影响。

## 2026-11-05　看得到计划和它的进度

> PR：#46　作者：Claude Code

### 原始需求

Agent 调 `todowrite` 时界面上只有一行“更新计划”，看不到清单，也看不到进度（第 2 张截图）。原型见 `designs/app/session.html?s=plan`。

### 怎么验收

1. Mock：`KITS_KERNEL=mock KITS_MOCK_SCENARIO=plan pnpm dev`，发一句话。预期：输入框上方出现“计划 1/2”卡片，标题下有进度条，已完成的项打勾划线，进行中的项转圈、整行高亮；对话里等你确认。
2. 点卡片标题收起：一行显示进度和当前项。再点展开。
3. 点“允许一次”：这一轮结束，卡片消失。
4. 展开“第 1 轮”：三条“更新计划”，右边分别是 `0/2`、`1/2`、`2/2`，点开看到当时的清单，不再是 JSON。
5. 真实模型：发“用 todowrite 列个计划，然后逐项做完”，卡片跟着 Agent 的更新变。

### 主要改动

- `session/thread/derive.ts`：`todosOf`、`todoProgress`、`deriveTodos`；“更新计划”步骤带清单和进度。
- `session/thread/Plan.tsx`：`TodoList`、`PlanCard`。`Steps.tsx` 的步骤点开放清单。
- `pages/session/SessionPage.tsx`：输入框上方放卡片。
- `designs/app/session.html`：新场景 `plan`。
- `packages/kernel/src/mock/scenarios.ts`：新场景 `plan`。

样式参考 lovia：进度条和高亮当前项。位置没有学它浮在右上角，浮层会盖住对话；放在输入框上方，和 Codex 一样。

几个取舍：清单直接从 `todowrite` 的参数取，不用内核的 `todo.updated` 事件，历史里每一步的快照也有了，不用改事件和数据库。卡片只跟着正在跑的这一轮，这一轮不写计划就不显示，免得上一轮没做完的计划一直挂着。取消的项不算进度。

配置项、数据库 schema 没有变化。

### 测试

- 单元测试：`derive.test.ts` 的 `todos`（解析、进度、步骤、取最后一份、结束后没有卡片）。
- E2E：`session-cards.spec.ts` 的 `follows the plan above the composer and keeps each update in the steps`。

### 新增依赖

无。

### 已知问题

- 子任务里的 `todowrite` 不进卡片（内核默认不给子任务这个工具）。
- CodeAgent 的工具名没有真机核对，不是 `todowrite` 的话走不到这里。

## 2026-11-05　子任务运行时看得到它在做什么

> PR：#47　作者：Claude Code

### 原始需求

子任务运行时只有一个 spinner 和“正在子任务……”，看不到它派了什么、走到哪一步（第 1、5 张截图）。原型见 `designs/app/session.html?s=subagent`。依赖 #44（子会话的识别）。

### 怎么验收

1. Mock：`KITS_KERNEL=mock KITS_MOCK_SCENARIO=subagent pnpm dev`，发一句话。预期：工作过程标题是“子任务 1 个”；“子任务 跑 points 的测试”这一行自动展开，里面有“任务”（派给它的话）和“过程”（它的每一步，可以点开看结果）；行右边是步数和耗时。
2. 确认卡片标题旁写着“来自子任务：跑 points 的测试”。“允许一次”后这一轮结束。
3. 展开“第 1 轮”，点子任务：多了“结果”，是子任务的结论，没有 `<task>` 这类包装；行右边是“2 步 · 2 秒”。
4. 真实模型：发“用 task 工具派一个子任务看看这个仓库”。超过 8 步时只放最后 8 步，上面有“显示前面 N 步”；状态行写到它当前那一步，比如“正在子任务：探索仓库结构 · 运行 看目录”。

### 主要改动

- `packages/kernel/src/adapter/events.ts`：子会话的工具 part 映射成 `tool-start` / `tool-end`，带 `parentCallId`（派它的 task 的 callId）。callId 写成 `<task>/<callID>`，不同会话的 callID 可能撞。权限请求的 callId 同样改写，确认结果标得到子任务的那一步上。
- `packages/kernel/src/adapter/opencode-family.ts`：断线补齐时逐个拉子会话的消息。
- `packages/core`：`tool-start`、工具 part 多 `parentCallId`；权限 part 多 `subagent`。都在 part 的 JSON 里，数据库 schema 没有变。
- `session/thread/derive.ts`：子任务里的工具挂到 task 步骤下面；`<task_result>` 去包装；工作过程标题数子任务；状态行带当前一步；确认卡片带子任务名。
- `session/thread/Steps.tsx`：子任务的步骤有“任务 / 过程 / 结果”三段，在跑时默认展开。`Cards.tsx`、`Blocks.tsx` 跟着改。
- `designs/app/session.html`：新场景 `subagent`。`mock/scenarios.ts` 的 `subagent` 场景补了子任务的步骤。

### 测试

- 单元测试：`events.test.ts`（工具挂到 task 下、权限指到子任务的步骤、正文和用量不算进这一轮）、`opencode-family.test.ts`（断线补齐子任务步骤）、`thread/derive.test.ts` 的 `subagents`。
- 契约测试：`opencode-family.contract.test.ts`，真实 opencode 里子任务的 bash 带 `parentCallId`。
- E2E：`session-cards.spec.ts` 的 `shows what a subagent is doing and asks for its commands`。

### 新增依赖

无。

### 已知问题

- 子任务的正文和思考不显示，只显示工具步骤和最后的结果。
- 子任务用的 token 和费用不算进会话的统计。
- 子任务里模型网关在重试时，界面没有重试条。

## 2026-11-05　其他内置工具的步骤

> PR：#48　作者：Claude Code

### 原始需求

检查 `todowrite`、`task` 之外的内置工具是否需要专门的界面。逐个对了 OpenCode 1.19.5 的工具（`bash read glob grep edit write apply_patch task webfetch todowrite websearch skill`）、kits 工具（`ask_user submit_output remember`）和内核的 `invalid`：

| 工具 | 现状 | 结论 |
|---|---|---|
| `bash` `read` `glob` `grep` `edit` `write` `apply_patch` `webfetch` `kits_ask_user` | 有各自的行、结果或卡片 | 不用改 |
| `websearch` | 没有适配，只显示 `websearch` 这个词，看不到搜什么 | 改：显示搜索词 |
| `invalid` | 只显示 `invalid`，模型调错工具时还算成功 | 改：显示想调的工具，算失败 |
| `skill` | 点开是带 `<skill_content>` 包装和内核说明的原文 | 改：只留技能正文 |
| `kits_remember` | 点开只有“已记住” | 改：行上写记到哪，不再能点开 |
| `kits_submit_output` | 行上什么都没有，点开只有“已提交” | 改：写校验结果，通过的跳到“产出”，不通过的展开错误 |

原型：`designs/app/session.html?s=output`（提交产出）、`?s=question`（搜索网页）。

### 怎么验收

1. `KITS_KERNEL=mock KITS_MOCK_SCENARIO=output-structured pnpm dev`，发一句话，展开工作过程。预期：“提交产出”右边是“通过校验”，点它切到“产出”。
2. 真实模型，发“用 skill 工具加载 code-review 技能”，展开这一步：看到技能正文，开头没有 `<skill_content>`，结尾没有 `Base directory`。
3. 发“记住：测试用 uv 跑”：“记下 …”右边是“项目记忆”，这一行点不开。
4. 单测覆盖 `websearch`、`invalid`、产出校验失败（默认权限拒绝 `websearch`，Agent 要放开才调得到）。

### 主要改动

- `session/thread/derive.ts`：`describeTool` 加 `websearch`、`invalid`；`cleanOutput` 加 `skill`；`toolStat`、`toolStep` 处理两个 kits 工具。
- `session/thread/Steps.tsx`、`Blocks.tsx`、`pages/session/SessionPage.tsx`：步骤可以跳到“产出”。
- `designs/app/session.html`：`提交产出` 和 `搜索网页` 的步骤。原来提交产出的说明行改成点开看错误。

配置项、数据库 schema 没有变化。

### 测试

- 单元测试：`thread/derive.test.ts` 的 `tool steps`。
- E2E：`output.spec.ts` 的提交产出步骤跳到“产出”。

### 新增依赖

无。

### 已知问题

- 命令运行时看不到实时输出，要等结束：内核在 `metadata.output` 里有，要新加一种事件。
- `websearch` 的结果格式没有实测（内网用不上，默认拒绝），按原文显示。

## 2026-11-05　权限确认：修 404，减少重复确认

> 日期：2026-11-05　PR：见本分支 `fix/session-permission-replies`　作者：Claude Code

### 原始需求

内网用户反馈两个问题：

- 确认 `external_directory` 时报错：`POST /permission/per_…/reply returned 404`，`Permission request not found`。
- 会话中反复确认执行权限，影响体验。

404 的原因：回复一个请求时，内核会连带处理同一会话里的其他请求（拒绝一个就全拒绝，“本会话允许”覆盖到的一起放行），并发 `permission.replied`。kits 没接这个事件，第二张卡片留在界面上，再点就是 404。Agent 并行读同一个目录下的文件时很容易碰到。工具调用被打断时，内核还会直接移除请求，什么事件都不发。

反复确认的原因：只读白名单只有 Unix 命令，Windows 上的 `dir`、`Get-Content`、`Select-String` 都要确认；“本会话允许”只存在内核内存里，内核重启后失效。

做到什么程度算完：同一批请求回复一次，其余卡片自己收起，不报错；Windows 上只读命令不用确认；点过“本会话允许”的规则在内核重启后还有效。“全部自动”下访问工作目录以外的路径仍然询问，这条安全边界不动。

### 怎么验收

1. 真实模型，工作目录外放一个有几个文件的目录，发“同时读这个目录下的 a.txt 和 b.txt”。出现两张确认卡片时点第一张的“本会话允许”。预期：两张卡片都收起，没有报错，两个读取都完成。
2. 同样的操作，点第一张的“拒绝”。预期：两张都收起，两个步骤都标“已拒绝”。
3. Windows 上发“列出当前目录，看一下 package.json 的前 20 行”。预期：`dir`、`Get-Content`、`Get-ChildItem`、`Select-Object -First 20` 这类命令不弹确认；`Remove-Item`、带重定向的命令、带 `{ }` 脚本块的 `Where-Object` 仍然确认。
4. 让 Agent 跑一条不在白名单里的命令，点“本会话允许”。退出重开 kits，在同一个会话里让它再跑同类命令。预期：不再弹确认。
5. 开一个新会话跑同类命令。预期：要确认，kits 记住的规则只跟着点过它的会话走。

### 主要改动

- `packages/core`：新增事件 `permission-replied`；`readonlyCommandPatterns` 加 Windows 命令，不收 `gc`、`sls` 这类别名（在别的平台是别的程序）；`Select-Object`、`Where-Object`、`Sort-Object` 带 `{` 时回到询问，脚本块里的 .NET 调用内核拆不出来；`matchPattern` 和内核对齐：`?` 匹配一个字符、结尾的 ` *` 可以没有、反斜杠当斜杠。
- `packages/kernel`：`permission.replied` 映射成新事件（含子会话）；`respondPermission` 改成返回 `boolean`，内核回 404 时返回 `false`，不再抛错。
- `apps/desktop/src/main/sessions`：`thread.ts` 按内核的回复更新卡片，请求已经不在时标成 `expired`；`session-store.ts` 的 `alwaysRules` 读出这个会话点过的“本会话允许”；`session-service.ts` 碰到匹配的请求直接替用户回复，不弹卡片。

配置项、数据库 schema 没有变化。`docs/references/codeagent-checklist.md` 加了第 28 项。

### 测试

- 单元测试：`adapter/events.test.ts`、`thread.test.ts`、`session-service.test.ts`（请求已不在时不报错、记住本会话允许）、`config/permission.test.ts`（Windows 命令、通配和内核一致）。
- 契约测试：`opencode-family.contract.test.ts` 用真内核跑并行两个请求，点“本会话允许”后第二个由内核处理，再回复返回 `false`，这是 404 的复现。

### 新增依赖

无。

### 已知问题

- Windows 上的验收步骤还没有实跑，开发机是 macOS，CI 也停着。
- 反馈没有说明是哪个工具在反复弹，这里按代码分析修。修完还频繁的话，看 `permission_log` 表里的 `tool` 和 `input`。
- 模型写的 `powershell -Command "…"` 是一整条命令，白名单放行不了，仍然询问。放行整条命令不安全。
- 内核连带处理的请求不写 `permission_log`，这张表只记用户亲手回复的。
- 内核把“本会话允许”记在工作目录级别，同目录的其他会话在内核重启前也生效，这是内核的行为。

## 2026-11-05　运行中插话，排队消息能编辑、删除

> 日期：2026-11-05　PR：见本分支 `feat/session-interject`　作者：Claude Code

### 原始需求

Agent 运行中发的消息只能等这一轮结束，发错了也改不了。参考其他 harness 的“排队 + 插话发送”，要求默认行为符合习惯，非默认多点一次，文字尽量少。

评审结论：回车排队，点“插话”才在下一步送达；占位文字只留“接着说…”。原型：`designs/app/session.html?s=queued`。

### 怎么验收

用 OpenCode 内核，发一个要跑一阵的任务：

1. 运行中输入文字按回车。预期：输入框上方出现“1 条排队消息 · 这一轮结束后发送”，消息不进对话流。
2. 鼠标移到这一行，点编辑。预期：消息回到输入框，已有的草稿不被覆盖；附件也一起回来。再按回车排回去。
3. 点删除。预期：这一条消失，队列空了面板就没了。
4. 排一条，点“插话”。预期：面板收起，对话流里出现这条消息，下面写“下一步送达”；这一步结束后标签消失，后面接一张“第 N 轮 · 继续”，模型的回复回应了这条消息。这一轮不会多算一轮。
5. 排两条，点“全部插话”或在空输入框按 `⌘↵`（Windows 是 `Ctrl+Enter`）。预期：两条都进对话流。
6. 输入文字直接按 `⌘↵`。预期：这条不排队，直接插话。
7. 有确认卡片时在输入框里按 `⌘↵`。预期：只插话，不批准命令。
8. 排两条，点停止。预期：两条用空行隔开回到输入框，没有丢，不会自动开新的一轮。点完“插话”马上点停止，结果一样。
9. 不插话，让这一轮跑完。预期：和以前一样，排队的消息合成一条发出。
10. 切到 CodeAgent 内核。预期：有排队面板，没有“插话”按钮，`⌘↵` 和回车一样排队。

### 主要改动

- `packages/kernel`：`AgentKernel.interject()` 把消息发给还在跑的这一轮。方言层新增 `interject`，OpenCode 开，CodeAgent 关。映射器看到助手消息回的用户消息变了就发 `interject-delivered`。
- `apps/desktop/src/main/sessions`：排队的消息有了 id；新增 `dequeue`、`interject`；停止时排队消息退回输入框，不再删掉。插话是助手消息里的 `interject` part，状态 `pending` / `sent`，模型看到时才定位置。
- 改动面板：插话在内核里是单独一条用户消息，`kernelTurns` 把它算回所在的那一轮，同一轮同一文件的改动合成一份。
- 界面：新增 `QueuePanel`；`deriveBlocks` 在插话处切开工作过程；输入框新增 `onInterject` 和退回草稿的 `restore`。
- 停止：还在送的插话和排队的一起退回；停止请求失败也退回；等待期间切了会话，草稿放回原来的会话（`held-drafts.ts`）。输入框发送完成时只去掉发出去的文字，等待期间退回或新打的内容留着（`composer-draft.ts`）。
- IPC：`session.abort` 返回退回的草稿；新增 `session.dequeue`、`session.interject`；`SessionSummary.queued` 从字符串数组改成对象数组，新增 `canInterject`。

配置项、数据库 schema 没有变化（新的 part 类型存在原来的 JSON 列里）。

### 测试

- 契约测试（真内核）：插话在下一步送达且仍是同一轮；模型写最后回复时插话，内核接着做，只结束一次；插话后停止，下一轮模型能看到。
- 单元测试：`thread.test.ts`、`session-service.test.ts`、`derive.test.ts`、`events.test.ts`、`held-drafts.test.ts`、`composer-draft.test.ts`。其中停止和插话的竞态、断线补齐误判送达、确认卡片被隐藏，都是先写复现用例再修的。
- E2E：`session-cards.spec.ts` 新增插话、全部插话、编辑删除和停止退回。

### 新增依赖

无。

### 已知问题

- 插话不会打断正在跑的命令或子任务，要等这一步结束，模型才看到。
- 送达后不能撤回。点了停止，这条消息留在内核历史里，下一轮模型会看到。
- CodeAgent 先关着：文档只说 `prompt_async` 进执行队列，核对清单第 29 项实测后再开。
- 内核刚结束这一轮的几毫秒内插话，这条回复可能不显示。契约测试里最后一步的插话都接住了，但这个窗口没法稳定复现。
- 这一轮的消息还没进内核时（内核冷启动）点插话，消息留在排队里，这一轮结束后发。
- 一条 `interject-delivered` 把所有等待中的插话都标成已送达；几乎同时发的两条，后一条的标签可能早一步消失。
- 插话请求已经到了内核、响应还没回来时点停止：这条会退回输入框，同时留在内核历史里，下一轮模型会看到。
- 切换会话时草稿放回原会话这一段只有单元测试，没有 E2E：Mock 内核的停止太快，切不进去。
- 同一文件的两份改动拼在一起显示，不是重新算的合并 diff。
- 排队的消息不落库，应用退出就没了，和以前一样。
- 没在 Windows 上跑过。

## 2026-11-06　界面改版 2：去掉轮次

> PR：分支 `feat/session-drop-rounds`　作者：Claude Code

### 原始需求

一次插话后对话里出现两个“第 3 轮”，轮次本身对用户也没有意义。见[界面改版方案](../plans/2026-11-ui-refresh.md)的决策 1。

### 怎么验收

1. 发两条消息：步骤组只有摘要和耗时，顶栏是“运行中 · 0:12”，结束后是“已完成 · 12 秒”。
2. 运行中插话：前后是两段普通的步骤组，没有“继续”。
3. 右侧“改动”按这一轮用户消息的第一行分组，过长时截断，鼠标移上去看全文。
4. 压缩上下文：分隔线写“前面的对话已压缩成摘要”。
5. “全部会话”的副标题不再有轮数；桌面通知写“这一轮做完了”；导出的产出文件名不带“第 N 轮”。

### 主要改动

- `Blocks.tsx`、`derive.ts`：去掉步骤组标题和 `resumed`，压缩块去掉 `turns`。
- `SessionPage.tsx`：状态胶囊不带序号，完成时显示刚结束这一轮的耗时（压缩不算）。
- `panels/derive.ts`：`Round` 加 `title`。
- `OutputPanel.tsx`：一个会话有多份产出时，按“第 N 份”切换。
- `session-service.ts`：`exportName` 去掉轮次参数，重名靠已有的序号区分。
- 数据库的 `turn` 字段不动，内部继续用它分组。配置项、schema 没有变化。

### 测试

- 单元测试：`panels/derive.test.ts` 新增分组标题；`exportName`、插话分段的用例跟着改。
- E2E：依赖“第 N 轮”文案的用例改用步骤组按钮和回复数量判断。

### 新增依赖

无。

### 已知问题

- 只发了附件没写字的一轮，改动分组标题是“这一轮的改动”。

## 2026-11-06　界面改版 4：输入框

> PR：分支 `feat/session-composer-chips`　作者：Claude Code

### 原始需求

已有会话的输入框里，工作区和 Agent 改不了却占着位置，权限和模型又是只读的。见[界面改版方案](../plans/2026-11-ui-refresh.md)的决策 2。

### 怎么验收

1. 打开已有会话：输入框左边是 `+` 和权限，右边是用量环、模型、发送；没有工作区和 Agent。
2. 点权限选“全部自动”：对话里多一行“权限改为“全部自动”，立即生效”。运行中改也一样，已经弹出的确认卡片还要回答。
3. 点模型换一个：菜单里没有内核切换；对话里多一行“模型切换到 xxx，下一条消息起生效”；再发一条，用的是新模型。
4. 用量环显示百分比，八成以上变黄；点它打开上下文。没配模型窗口时不显示。
5. 面板放大时输入框窄，用量环只留图形，发送按钮不换行。
6. 首页的输入框不变。

### 主要改动

- `Composer.tsx`：`locked` 时不显示工作区和 Agent；权限、模型菜单走 `onPermission`、`onModel`，改失败的错误显示在输入框里；新增 `ContextRing`。
- `SessionPage.tsx`：接上面的回调。用量环先打开右侧“上下文”页签，后面的 PR 换成对话框。

配置项、数据库 schema 没有变化。

### 测试

- E2E：`session-stream.spec.ts` 的 `changes the permission and model of an open session from the composer`。

### 新增依赖

无。

### 已知问题

无。

## 2026-11-06　权限说明一行，新会话聚焦输入框

> PR：分支 `fix/shell-composer-focus`　作者：Claude Code

### 原始需求

用的时候发现：权限菜单的说明折成两行；点“新会话”后要再点一下输入框才能打字。

### 怎么验收

1. 点权限：三项的说明都是一行，首页和会话页一样。
2. 点“新会话”、按 ⌘N、点工作区的 `+`：光标都在输入框里。已经在首页时再点也一样。

### 主要改动

- `Composer.tsx`：权限菜单不限宽度、说明不换行；首页输入框每次导航聚焦一次（看 `location.key`，同一页再点也会变）。
- 原型 `shell.js` 同步。

配置项、数据库 schema 没有变化。

### 测试

- E2E：`shell.spec.ts` 的 `puts the cursor in the composer when starting a new session`、`keeps each permission note on one line`。

### 新增依赖

无。

### 已知问题

无。


## 2026-11-06　放宽“窗口变高后恢复跟随”用例的准备步骤

> 日期：2026-11-06　PR：分支 `fix/session-e2e-stale-status`　作者：Claude Code

### 原始需求

内网 Jenkins（Linux）上 `follows again when a taller window brings the thread back to the bottom` 连续失败：滚到离底部 100px 后，“跳转至底部”按钮一直不出现。同一份代码在 GitHub CI（Windows）和本机 mac 上都通过。

做到什么程度算完：这个用例不再因为准备步骤里的一次性回弹失败；“窗口变高后恢复跟随”的断言不变，跟随逻辑坏了还能抓到。

### 怎么验收

1. 构建后跑这个用例：`pnpm -F @kits/desktop build`，再到 `e2e/` 下跑 `pnpm exec playwright test session-stream -g "follows again" --repeat-each=6`。预期 6 个都通过。
2. 在内网 Jenkins 上跑一次。预期这个用例通过；如果还失败，看下面“已知问题”。

### 主要改动

- `e2e/tests/session-stream.spec.ts`，只动这一个用例：
  - 每轮等回复出现再看状态。新一轮刚发出时，状态可能还是上一轮的“已完成”，回复要这一轮结束才有。
  - 滚动前等线程贴底。
  - 滚到离底部 100px 这一步改成可重试：被拉回底部就重新滚，直到按钮出现且离底部超过 60px，最多 15 秒。
- 窗口变高之后的断言没有改。

产品代码、配置项、数据库 schema 没有变化。

### 测试

都在本机 mac 上跑：

- 改后的用例，正常代码：6 次全部通过。
- 临时注入一次回弹：旧用例 3 次失败 2 次，报错和 Jenkins 相同；改后的用例 3 次全部通过。
- 临时去掉窗口变高后重新判断跟随的逻辑：改后的用例 2 次都失败在 `expect(jump).toHaveCount(0)`，说明它还能抓到这类 bug。

注入回弹和去掉逻辑都是临时改动，没有提交。

### 新增依赖

无。

### 已知问题

- Jenkins 失败的根因没有确认：手上没有 Linux 环境，也还没拿到失败时的 `error-context.md` 和 `trace.zip`。写库慢已经排除，加延时跑了 50 多次都没复现。
- 如果 Linux 上每次都被拉回底部，这次放宽不起作用，用例会在 15 秒后失败。这种情况要当成产品问题查，不要继续放宽。
- 窗口变高这一步（`win.setSize`）在 Linux 上的表现没有验证，失败可能挪到下一个断言。
- 按钮出现、用例检查过之后才发生的回弹，这个用例发现不了。

## 2026-11-06　在 Linux 上跳过“窗口变高后恢复跟随”用例

> 日期：2026-11-06　PR：分支 `fix/session-e2e-skip-linux`　作者：Claude Code

### 原始需求

上一节放宽准备步骤后，内网 Jenkins（Linux）上这个用例仍然失败，也拿不到 `error-context.md`。先只在 Linux 上跳过，让 Jenkins 恢复可用，排查记在 [#82](https://github.com/cymoo/kits/issues/82)。

做到什么程度算完：Jenkins 上这个用例显示跳过；GitHub 的 Windows CI 和本机 mac 继续跑它。

### 怎么验收

1. 在内网 Jenkins 上跑一次。预期 `follows again when a taller window brings the thread back to the bottom` 显示跳过，不再失败。
2. 看 GitHub 的 Windows CI 日志。预期这个用例通过，不是跳过。

### 主要改动

- `e2e/tests/session-stream.spec.ts`：这个用例在 Linux 上跳过，跳过原因写了 #82。

产品代码、配置项、数据库 schema 没有变化。

### 测试

- 本机 mac 上用例照常跑并通过。
- 把跳过条件临时改成 mac，用例显示跳过，说明跳过语句有效。这个改动没有提交。

### 新增依赖

无。

### 已知问题

- Linux 上“窗口变高后恢复跟随”暂时没有 E2E 覆盖。kits 只发布 mac 和 Windows 版，发布版本不受影响。
- 失败原因还没查清，可能是环境问题，也可能是 Linux 上的产品问题，见 #82。修好后去掉 `test.skip`。

## 2026-11-06　权限漏洞修复：本会话允许、保护路径、硬拒绝、密钥文件、项目插件

> 日期：2026-11-06　PR：#84　作者：Claude Code

### 原始需求

[权限方案调研](../references/agent-permissions.md)用真实 OpenCode 1.19.5 测出 5 个漏洞，这次做方案里的 P0：

1. “本会话允许”盖得过 deny：允许过 `git push origin main` 后，配成 deny 的 `git push --force` 直接执行。
2. “本会话允许”按工作目录生效：同一目录新开的会话也不再询问。
3. 写 `.git/config` 再跑白名单里的 `git status`，全程不弹窗就能执行任意命令。
4. 工作目录里的 `.opencode/plugin` 在打开会话时就执行了。
5. 白名单命令能读 `~/.ssh` 这类密钥文件。

做到什么程度算完：这 5 个场景有回归测试，第 5 条只要求挡住密钥路径。分级漏斗（智能档、审查模型）不在这次范围内。

### 怎么验收

用“执行前确认”模式，工作目录是一个 git 仓库。用真实模型时让 Agent 执行下面的操作。

1. 让 Agent 跑 `git push origin main`，弹卡片时点“本会话允许”。再让它跑 `git push --force origin main`。预期不弹卡片，命令被拒绝，Agent 说明不能强推。
2. 在同一目录新建会话，让 Agent 再跑 `git push origin main`。预期又弹确认卡片。
3. 让 Agent 修改 `.git/config`。预期弹“修改文件前需要你确认”，“本会话允许”后面写的是 `.git/config`，不是 `*`。改 `src` 下的普通文件不弹。
4. 在工作目录放一个 `.opencode/plugin/p.js`，内容是模块加载时写一个文件。新建会话发一条消息。预期那个文件没有生成。
5. 让 Agent 跑 `cat ~/.ssh/config`，以及读 `.env`。预期两个都弹卡片，切到“全部自动”也一样。读 `.env.example` 不弹。
6. 工作目录放一个 `AGENTS.md`，写“回答开头加 OK”。发一条消息。预期回答开头有 OK。让 Agent 记一条项目记忆，下一轮问它记了什么，预期答得出来。
7. “全部自动”模式下让 Agent 跑 `git push --force`。预期被拒绝。跑普通的 `rm -rf build` 不弹。
8. 设置 → 权限：“全部自动”的说明写了读密钥文件要问、强推这类命令禁止，`edit` 那行写了 `.git`、CI 配置先问。

### 主要改动

- `packages/core/src/config/permission.ts`：
  - `edit` 改成带模式的规则：`.git`、`.opencode`、`.agents`、`.github/workflows`、`.husky`、`.vscode`、`opencode.json`、`.env*` 要问，只在“执行前确认”下生效。
  - `read` 补上 `.env` 询问：内核默认有这条，但 kits 的 `read: allow` 把它盖掉了，和 phase1 方案 4.5 节不符。
  - bash 加密钥路径规则：“执行前确认”和“全部自动”要问，“只读”拒绝。
  - 加硬拒绝规则：强推、删根目录和家目录、`mkfs`、`dd` 写磁盘、`format`、`diskpart`。所有模式生效，排在 Agent 覆盖后面。
  - 规则写在默认值里而不是只写在会话上：内核的子会话只继承 deny，ask 要靠全局规则才管得到子任务。
  - 新增 `alwaysScope`：内核给的 `always` 是 `*` 时收窄到这次请求的内容。不收窄的话，点一次“本会话允许”就开了所有保护路径。
- `packages/kernel`：`AgentKernel.respondPermission` 不再接受 `always`，类型上防止再发给内核。OpenCode 启动时设 `OPENCODE_DISABLE_PROJECT_CONFIG=1`，不读工作目录的 `opencode.json` 和 `.opencode`，也省掉了那个目录触发的 npm 安装等待。
- `apps/desktop/src/main/sessions/session-service.ts`：“本会话允许”只记在 kits，发给内核的是 `once`。内核不再帮忙放行并行的同类请求，改由 `answerCovered` 答掉新规则覆盖到的待确认请求。
- 设置页权限的两句说明。原型这一页只有占位，没有改。
- `docs/references/codeagent-checklist.md` 加第 31 项：CodeAgent 有没有关项目配置的办法。

没有新配置项，数据库 schema 没有变化。

- `apps/desktop/src/main/sessions/project-instructions.ts`（新增）：`OPENCODE_DISABLE_PROJECT_CONFIG` 连项目的 `AGENTS.md` 和 `.agents/memory.md` 也不读了，改由 kits 从工作目录往上找到仓库根，随消息带给模型。内核能力加 `projectInstructions` 标记，OpenCode 是 false，CodeAgent 是 true，后者不变。

**行为变化：** 工作目录里的 `opencode.json`、`.opencode/` 下的插件、命令、Agent、技能都不再加载。kits 的项目技能和项目 Agent 在 `.agents/` 下，不受影响，项目技能有契约测试。

### 测试

- 单元测试：`permission.test.ts` 补保护路径、密钥、硬拒绝、`alwaysScope`；`session-service.test.ts` 补 always 不发给内核、并行请求的处理、项目说明随消息带上；`project-instructions.test.ts` 是新增的；`events.test.ts`、`opencode.test.ts` 各补一条。
- 契约测试（真实 OpenCode 1.19.5）：写 `.git/config` 要问（主会话和子任务各一条）、强推被拒、白名单命令读密钥路径要问、工作目录插件不加载。修复前这 5 条都失败。另加一条：关了项目配置后 `.agents/skills` 的项目技能还在。原来验证 `always` 连带处理的用例改成验证 `reject` 的连带处理。
- E2E：全量跑过，没有新增。

### 新增依赖

无。

### 已知问题

- 子任务读不到项目的 `AGENTS.md` 和记忆：kits 只能给主会话的消息带 system，子任务由内核发起。之前子任务能读到，这是这次的代价。
- 读工作区外的普通文件仍然不问，比如 `wc -c /etc/hosts`。要等分类器比对路径（调研报告的 P1）。
- 规则按命令文本匹配，防的是模型顺手和误操作，不是有意绕过：`python -c`、变量拼路径、`-uf` 这种合并参数都拦不住。
- “本会话允许”的范围还是内核给的，`curl *`、`node *` 这类等于放开整个命令。P1 里不再对解释器和出网命令提供这个选项。
- Agent 文件在“执行前确认”下写的 `allow` 仍然优先于保护路径和密钥规则，只有硬拒绝压得住。项目里的 Agent 文件来自仓库，用户选了它就等于信任它，`.agents/` 列入保护路径防的是 Agent 自己改。
- macOS 文件系统不区分大小写，内核匹配区分：`.GIT/config` 这样写绕得过保护路径。Windows 上内核不区分大小写，不受影响。
- 本次在 macOS 上验证，Windows 上看 CI。CodeAgent 见核对清单第 31 项。

## 2026-11-06　权限重构：默认“智能”档，只问撤不回的操作

> 日期：2026-11-06　PR：[#87](https://github.com/cymoo/kits/pull/87)　作者：Claude Code

### 原始需求

根据 [agent-permissions.md](../references/agent-permissions.md) 重构权限方案，两个目标：用户友好，不再频繁弹审批；拦住最危险的命令。用户体验第一优先级，拦住最危险的就够了。和调研推荐方案的差异写在报告的“落地决定”一节，最大的一条：灰区直接放行，不做审查模型。

原型：[session.html](../../designs/app/session.html)（`?s=permission`）、[shell.js](../../designs/app/shell.js) 的权限菜单。

做到什么程度算完：默认档下日常开发和测试命令都不弹窗；推送、发布这类撤不回的操作弹窗并先说后果；强推、删根目录这类命令任何档位都跑不了。

### 怎么验收

用真实模型（`.env` 里的测试网关），工作目录是一个 git 仓库。让 Agent 按原样执行下面的命令。

1. 新装或升级后打开设置 · 权限：默认选中“智能（推荐）”，能看到“什么时候问你”和“始终拦住”两段说明。输入框的权限菜单是智能、只读、全部自动三项。
2. **不问：** `npm test`、`python3 -c "print(1)"`、`curl http://localhost:8080`、`ls ../`、`cat /etc/hosts`、`rm -rf build`、`git commit -m x`。都直接执行，没有卡片。
3. **改文件不问：** 让 Agent 新建 `src/a.txt`。没有卡片。工作目录换成不是 git 仓库的 `~/kits-workspace` 再试一次，也没有卡片。
4. **要问，并先说后果：** `git push origin main`，卡片标题是“这条命令会把提交推到远程仓库”，能选“本会话允许 `git push *`”。
5. **要问，没有“本会话允许”：** `sudo ls`、`curl -T a.txt http://localhost:9`，放开等于放开整个命令。
6. **工作区外写入要问：** 让 Agent 用改文件工具写 `../x.txt`，只弹一张卡片，标题是“这个操作会改工作区以外的文件”。
7. **密钥要问：** `cat ~/.ssh/config`、让 Agent 用读文件工具读 `~/.ssh/config`。
8. **拦下：** `git push --force origin main`。没有卡片，步骤里显示“被权限规则拦下了”，不是一大段 JSON，Agent 换做法。切到“全部自动”再试，一样被拦。
9. **全部自动：** 切过去后第 4、6、7 步都不再问。
10. **每次确认：** 设置页选它，新会话里 `npm test` 要问，和之前的“执行前确认”一样；输入框菜单里这时多一项“每次确认”。
11. **老会话：** 升级前建的会话权限不变，显示“每次确认”。
12. **Windows：** 看 PR 的 CI，`permission-windows.contract.test.ts` 在真实内核上过一遍 PowerShell 写法。真机上再试三条：`Remove-Item build -Recurse -Force` 不问，`Remove-Item $env:USERPROFILE\tmp -Recurse` 要问，`Remove-Item -Recurse -Force C:\ -WhatIf` 被拦。

### 主要改动

- `packages/core/src/config/permission.ts`：
  - `PermissionMode` 加 `smart`。bash 是“默认放行 + 风险清单问 + 硬拒绝”，`RISKY_COMMANDS` 按风险分组，同一份表既生成内核规则，也给卡片说明原因（`permissionRisk`）。
  - `external_directory` 放行，只有 `.ssh`、`.aws`、`.gnupg`、`.kube` 要问。工作区外写入改由 `edit` 的规则管：`../*`、`?:/*`，不在 git 仓库时按 `SessionPlace` 先问主目录、再放开工作区。
  - 硬拒绝补全：`rm -rf /*`、`rm -rf / tmp`、`"$HOME"`、系统目录、`--no-preserve-root`、`sudo` 和环境变量前缀、`git push origin +main`、写裸磁盘设备、改根目录权限、关机重启、Windows 的 `rd /s`。
  - “全部自动”真的什么都不问了：工作区外、MCP 写入、读密钥都放行，只留硬拒绝。用户在 MCP 页手动设成询问的工具照问。
  - Agent 文件的 `allow` / `ask` 在智能档也生效。
  - 只读白名单加 `cd`、`date`、`sleep`、`test`、`du`、`shasum`、`git cat-file`、`git rev-parse`、`git ls-files`。
- `packages/core/src/config/settings.ts`：默认档 `smart`，配置版本升到 2。**版本 1 文件里的 `ask` 升级时换成 `smart`**：分不清是不是用户选的，那时也没有智能档可选。升级后再选“每次确认”不受影响。
- `apps/desktop/src/main/sessions/thread.ts`：记下请求的 `risk`；`upload`、`script`、`sudo` 三类清空 `always`，不给“本会话允许”。
- `apps/desktop/src/main/sessions/session-service.ts`：把工作目录和主目录交给规则。
- **Windows：** 内核在 Windows 上按 PowerShell 语法拆命令，规则按真实内核给的文本写，不是按 bash 想的（报告“落地决定”一节有实测）。`Remove-Item`、`del`、`rd`、`rmdir` 和 `rm` 一样只问工作区外；`curl.exe`、`iwr`、`irm`、`Copy-Item` 到共享目录算传文件；`& git push`、`git.exe`、`cmd /c git push` 算推送；硬拒绝加 `C:\`、`C:\Windows`、`C:\Users`、`$env:USERPROFILE`、`Clear-Disk`、`vssadmin delete`。`matchPattern` 在 Windows 上不区分大小写，和内核一致。绝对路径写工作区里的目录不算工作区外。
- `packages/kernel/src/generate/opencode-config.ts`：全局配置的 bash 只留 `ask`，细则都在会话规则里。子任务要问的由 kits 回答，拒绝规则子任务继承。
- `packages/kernel/src/adapter/events.ts`：被规则拒绝时，内核的错误是几十 KB 的规则 JSON，给人看的换成一句话。
- 界面：卡片有风险时标题说后果；输入框菜单换成智能、只读、全部自动，当前是“每次确认”时才多列一项；设置页四档，多两段说明。“执行前确认”改名“每次确认”。
- 原型：权限卡片的演示换成 `git push`，权限菜单、测试命令的“本会话允许”改成“自动允许”。设置页权限在原型里只有占位，按现有风格补的，只改了占位文字。
- Mock 内核加 `permission-push` 场景。

没有新配置项，数据库 schema 没有变化。

### 测试

- 单元测试：`permission.test.ts` 按命令列出不问、要问（含原因）、硬拒绝；工作区内外的 `edit`，含非 git 和 Windows 路径；`settings.test.ts` 补迁移；`thread.test.ts`、`events.test.ts`、`session-service.test.ts` 各补几条。
- 契约测试（真实 OpenCode 1.19.5）：智能档下普通命令不问、推送要问、管道进 shell 要问、读工作区外不问、写工作区外只问一次，非 git 工作区内写不问、写外面要问。`permission-windows.contract.test.ts` 只在 Windows 上跑，把常见的 PowerShell 写法按放行、问、拒绝过一遍。
- E2E：`session-cards.spec.ts` 加风险卡片，全量跑过。

### 新增依赖

无。

### 已知问题

这些是有意接受的，换来的是不打扰：

- **智能档防的是误操作，不是有心绕过。** `bash -c '...'`、`python x.py` 内部做什么规则看不到；`echo x > ../y`、`cp a ../b`、`sed -i` 这类用命令写工作区外不问，只有 `rm` 和改文件工具管得到。
- 普通的 `curl`、`wget` 不问，包括对外网 POST 内联数据。真要防外传得靠网络出口白名单或沙箱。
- `bash <<EOF` 也会问（内核给的模式和 `| bash` 一样是裸的 `bash`），标题说“执行管道或内联传进来的脚本”。
- 子任务写工作区外不问：全局配置的 `edit` 没有工作区信息，只有主会话有。子任务的命令规则正常。
- 工作区不是 git 仓库时，工作区外的判断只到主目录：系统目录普通用户本来写不了，别的盘的路径也会问（`?:/*`）。
- Windows 上看不到目标的删除不问：`Get-ChildItem C:\x | Remove-Item -Recurse` 的目标在管道左边；`x | powershell -` 整段不在内核给的模式里。
- `cmd /c` 整段是一条，里面只认 `git push`、`rd /s`、`del /s`，别的命令不解析。
- Windows PowerShell 5.1 没有单独跑，CI 上是 pwsh，按源码语法是同一套。
- `doom_loop` 还是问，全部自动也一样：内核这条只看全局规则，而且卡住重试本来就该让人看一眼。
- 硬拒绝的 `* rm -*` 会误伤 `grep "rm -rf /" x` 这种命令，影响很小。
- 内核拒绝一次，模型收到约 16KB 规则（改之前约 17KB），全局配置的 bash 只留了 `ask`。硬拒绝和风险清单别再大幅加长。
- 调研里的合并卡片、规则管理页、总结卡、`permission_log` 记决策来源没有做，审查模型（P2）不做。
- Windows 上的命令文本是在 CI 的真实内核上摸出来的，`permission-windows.contract.test.ts` 跑在 Windows CI 上。没有在真机上用真实模型走过。CodeAgent 走同一套规则，`external_directory` 和 `edit` 路径的写法要在核对清单里确认。

## 2026-11-06　Windows 契约测试的路径断言，`.docker` 密钥目录

> 日期：2026-11-06　PR：#86　作者：Claude Code

### 原始需求

#84 合入后 `main` 的 Windows CI 失败，2 个契约测试的断言写死了 Unix 下的文本。保护本身生效：两个用例都弹了询问。

- 写 `.git/config`：Windows CI 的临时目录是 8.3 短路径，内核给的是 `..\..\...\.git\config`，不是 `.git/config`。
- `wc -c $HOME/.ssh/config`：内核的 PowerShell 解析把路径最后一段截掉，收到的是 `wc -c $HOME/.ssh`。

第二条暴露一个真问题：`.docker/config.json` 按文件写，截断后匹配不上，Windows 上不询问。

### 怎么验收

1. 看这个 PR 的 Windows CI。预期 `asks before writing into .git` 和 `asks before a whitelisted command reads a secret path` 通过。
2. 在“执行前确认”下让 Agent 跑 `cat ~/.docker/config.json`。预期弹确认卡片。

### 主要改动

- `opencode-family.contract.test.ts`：两处断言不再依赖平台上的具体文本。
- `packages/core/src/config/permission.ts`：`.docker` 改按目录匹配。

配置项和数据库 schema 没有变化。

### 测试

- `permission.test.ts` 补 `.docker` 两条。契约测试本机通过，Windows 看 CI。

### 新增依赖

无。

### 已知问题

- 内核在 PowerShell 下截断路径最后一段，比较深的写法仍然匹配不上，比如 `$HOME/backup/.ssh/id_rsa` 收到的可能只是 `$HOME/backup/.ssh`，这个能命中；再深一层的情况没有逐一验证。

## 2026-11-06　权限说明的文案收尾

> 日期：2026-11-06　PR：[#88](https://github.com/cymoo/kits/pull/88)　作者：Claude Code

### 原始需求

权限重构（#87）合入后清理遗留：几处文案还停留在旧档位上。

### 怎么验收

打开设置 · 权限，最下面一段标题是“只读命令”，说明写着只在“每次确认”和“只读”模式下自动允许。

### 主要改动

- 设置页“只读命令”一段的标题和说明。
- `permission.ts` 两处注释。
- 调研报告的“待决问题”去掉已定的三条。

没有新配置项，数据库 schema 没有变化，规则没有变化。

### 测试

只改文案和注释，没有新增测试，`pnpm check` 通过。

### 新增依赖

无。

### 已知问题

无。

## 2026-11-07　计划及时更新、步骤行右边对齐、首页提示收进输入框

> PR：[#89](https://github.com/cymoo/kits/pull/89)　作者：Claude Code

### 原始需求

朋友试用后反馈的三个问题：

1. 计划卡片一直停在第一项，全部做完才一起更新；本机测着又是正常的，要查清楚是否属实。
2. 读空文件时，这一行右边的“0 行”和上下行没对齐（`搜索 *`、`读取 README.md`、`子任务 …` 三行里，中间一行靠右多出一截）。
3. 新对话页把标题下面的提示收进输入框的 placeholder，文案要简洁。原型：`designs/app/index.html`。

### 查明的原因

- **计划**：属实，但不是界面或事件延迟。用真实内核（OpenCode 1.19.5）记下每次 `todowrite` 的时间：事件到达和模型调用是同一时刻，每次调用都进了卡片。卡片不动是模型没调：同一个任务（不提示逐项做）跑 6 次，有 4 次把两项以上攒到一起更新，其中一次 `deepseek-v4-pro` 从第一项直接跳到全部完成，和反馈一模一样。模型不同、任务不同，攒的程度就不同，所以本机看着正常。
- **对齐**：和平台无关。能点开的行尾有一个悬浮才显示的箭头，占 22 px；空文件的结果是空的，这一行点不开，没有这个位置，数字就靠右多出一截。本机读的文件都有内容，所以看不到。

### 怎么验收

1. 计划：配真实模型，发“这几个文件都缺文档和类型，帮我补齐，再写测试跑一下，分步做”。预期：计划卡片基本一项一项往前走。展开这一轮，“更新计划”的步骤右边能看到 `1/3`、`2/3` 这样逐步增加。这是提示词约束，模型偶尔还会并两项，见已知问题。
2. 对齐：`KITS_KERNEL=mock KITS_MOCK_SCENARIO=empty-read pnpm dev`，发一句话，等结束后展开这一轮。预期：`86 行` 和 `0 行` 右边对齐；空文件那一行点不开。
3. 首页：打开新对话。预期：标题“要做什么？”下面直接是输入框，没有那行提示；输入框里灰字是“发消息或创建测试任务，/ 调用指令，@ 引用文件”。工作区名字还在输入框左下角。

### 主要改动

- `packages/kernel/src/generate/opencode-config.ts`：新增 `PLAN_RULE`，随 `agentSystemPrompt` 每条消息带上，要求每做完一项马上更新计划。Agent 的工具列表里没有 `todowrite` 时不带。
- `session/thread/Steps.tsx`：点不开的行也留出行尾图标的位置。
- `pages/home/HomePage.tsx`、`app/i18n.ts`、`designs/app/index.html`：去掉提示行，换 placeholder。工作区名字输入框左下角已有，不再重复。
- `packages/kernel/src/mock/scenarios.ts`：新场景 `empty-read`。

没有新配置项，数据库 schema 没有变化。

### 测试

- 单元测试：`opencode-config.test.ts`（带计划规则、没有 `todowrite` 时不带）。
- E2E：`session-cards.spec.ts` 的 `lines up the numbers of a step that has nothing to expand`，去掉修复后这条会失败。
- 真实模型对比：同一个任务，不带规则 6 次里 4 次攒着更新，带规则 5 次里 2 次（都只并了两项，没有再出现从头跳到尾）。

### 新增依赖

无。

### 已知问题

- 计划的进度全靠模型自己报，这条规则只能减少攒着更新，不能杜绝。没法验证朋友用的模型和 CodeAgent 上的效果；还是不动的话，让朋友展开这一轮数“更新计划”有几行：只有两三行说明模型确实没调，行数够多而卡片不动才是界面的问题。
- 主 Agent 派并行子任务时，它要等子任务都回来才能更新计划，这段时间卡片不动是正常的。
- 每条消息多带约 60 个字的系统提示词。

## 2026-11-07　发图片给 Agent

> PR：[#90](https://github.com/cymoo/kits/pull/90)　作者：Claude Code

### 原始需求

支持上传图片，要处理好模型不支持视觉的情况。原型：`designs/app/index.html?image=1`（带图片）、`?image=blocked`（模型看不了）、`designs/app/session.html`（消息里的缩略图）、`designs/app/settings.html`（模型行的图片开关）。

### 怎么验收

准备：一个能看图的模型和一个不能的。本机网关里 `deepseek-flash` 能看，`deepseek-v4-pro` 不能。

1. 设置 → 内核与模型，展开网关点“刷新列表”。预期：`deepseek-flash` 的“图片”开关自动打开，`deepseek-v4-pro` 关着。
2. 选 `deepseek-flash`，截一张图，在输入框按 ⌘V。预期：输入框出现带缩略图的附件。也可以点 `+` → 上传文件，或直接拖进来。
3. 写“图里写了什么”发送。预期：消息下面有缩略图，回复说得出图里的文字。点缩略图看大图，Esc 关闭。重启应用再打开这个会话，缩略图还在。
4. 换成 `deepseek-v4-pro`，再粘贴一张图。预期：出现“deepseek-v4-pro 看不了图片”，发送键灰掉，回车发不出去，草稿和图片都在。点“换成 deepseek-flash”后能发；点“去掉图片”只去掉图片，别的附件留着。
5. 把所有模型的图片开关都关掉，再加一张图。预期：提示“还没有能看图片的模型”，点“去设置”跳到模型设置。
6. 把一个文本文件改名成 `broken.png` 发送。预期：提示 `broken.png 打不开`，没有发出去。
7. 选一张超过 5 MB 的图片。预期：提示超过 5 MB，不加进附件。
8. 带图聊过的会话换到 `deepseek-v4-pro` 接着说话。预期：正常回复，不报错。
9. 用 `deepseek-v4-pro` 发一个要跑一会儿的任务，运行中换成 `deepseek-flash`，粘贴一张图按 ⌘↵ 插话。预期：这条进排队，这一轮结束后用 `deepseek-flash` 发出，回复说得出图里的文字。换模型下一条才生效，这一轮的模型看不了图，所以不插话。
10. 任务运行中，到设置里打开一个模型的图片开关，回来用这个模型发图。预期：提示“图片开关要等正在跑的任务结束、内核重启后才生效”，草稿和图片都在；任务结束后再发能发出去。

### 主要改动

- 模型配置：`GatewayModel` 新增可选的 `vision`（在 `settings.json` 里）。没写过是“不知道”，按看不了处理。旧配置不用迁移，刷新一次模型列表或手动打开开关就行。
- `gateway-client.ts`：从模型列表和详情里读能不能看图，认 `input_modalities`、`architecture.input_modalities`、`modalities.input`、`supports_vision`、`capabilities`。列表缺上下文或图片信息时都查详情，两者冲突时以列表为准，超时和并发限制不变。列表不报图片能力的网关，测试连接时会多查一轮详情，总共最多多等 8 秒，显示的延迟不算这部分。刷新只填还没定过的模型，手动开关过的不动。
- `opencode-config.ts`：能看图的模型写 `attachment` 和 `modalities`。不写的话内核不发图，只告诉模型读不了。
- `opencode-family.ts`：图片作为 `file` part 发给内核。`events.ts`：内核解不开图片时，把堆栈换成一句话。
- `session-service.ts`：图片存原文件，不转文字，按文件头认类型，发的时候才读成 data URL。输入框挡过之后这里再查一遍模型、大小和类型。插话时按这一轮实际用的模型判断，看不了图就排队到这一轮结束。内核只认启动时写进配置的能力，所以 `KernelManager` 记下启动时的网关配置，等重启期间以它和最新设置都允许为准。新增 `session.attachmentImage` 取缩略图。
- `Composer.tsx`、`composer-image.ts`：粘贴、缩略图、看不了图的提示和一键换模型、发之前解一遍图片。模型菜单里能看图的模型带图标。
- `Blocks.tsx`：消息里的缩略图和大图。`ModelSection.tsx`：模型行的“图片”开关。
- `codeagent-checklist.md`：新增第 33 项。

支持 PNG、JPEG、WebP、GIF，单张 5 MB。5 MB 的理由：对话里每一步都要把图片再发给模型一次，有的网关也卡这个大小。

数据库 schema 没有变化（`attachments.text_path` 本来就能为空）。原型没画到、按风格补的：模型菜单里的图标、大图弹窗。

### 测试

- 单元测试：文件头识别、网关字段、`mergeModels`、`supportsImages`、内核配置、`composeParts`、内核解图失败的提示、会话服务的收发和拒绝。
- 契约测试：`opencode-family.contract.test.ts`，真实内核加假网关，能看图的模型收到图片，看不了的收不到。
- E2E：`attachments.spec.ts` 新增粘贴并发送、看不了图时的三条出路、坏图片、去设置打开开关。
- 真实链路（一次性跑的，不在 CI）：OpenCode 1.19.5 加真实网关走完验收第 1～4、8 步；PNG、JPEG、GIF、WebP 都能读出图里的文字。

### 新增依赖

无。

### 已知问题

- CodeAgent 没有真机核对，它认不认 `attachment`、`modalities` 不确定，见核对清单第 33 项。
- 网关没报能力时开关默认关着，要手动打开。开错了的话，有的网关会悄悄丢掉图片（实测模型回“图片没加载”），有的会报错。
- 只有图片没有文字不能发，和其他附件一样要写一句话。
- 打开图片开关后要等所有任务结束、内核重启才能发图，这期间不会自动重发，要用户再发一次。
- 排队中的图片消息，如果排队期间换成了看不了图的模型，这条不会被拦下，模型会回复说看不了。
- 换到看不了图的模型后，历史里的图片模型也看不到。
- 不压缩图片，超过 5 MB 要用户自己压。`@` 引用工作区里的图片还是只给路径。

## 2026-11-07　点消息里的文件名预览附件

> PR：[#95](https://github.com/cymoo/kits/pull/95)　作者：Claude Code

### 原始需求

上传文件后，用户消息下面的文件名（比如 `xxx.pdf`）点不了。评审结论：点击后在应用内弹窗预览，和图片点开看大图一致；弹窗里能用系统应用打开。

原型：`designs/app/session.html?s=done&open=attachment`。

### 怎么验收

1. 运行 `pnpm dev`，上传一个 PDF、一个 Word、一个 Markdown 和一个 CSV，发送。
2. 依次点用户消息下面的文件名。预期：弹窗分别显示 PDF 页面（能翻页）、Word 正文、渲染后的 Markdown（能切源码）、表格。
3. 按 Esc 或点右上角的关闭。预期：弹窗关闭，再点还能打开。
4. 点弹窗里的“用系统应用打开”。预期：用默认应用打开这个文件。
5. 上传 `run.sh` 或 `run.js` 并发送，打开预览。预期：按钮是“在文件夹中显示”，只选中文件，不运行。
6. 退出应用，删掉 `{userData}/attachments/<会话>/` 里的某个文件，再点它的文件名。预期：弹窗显示“文件已经不在了”，没有打开按钮。

### 主要改动

- `session.attachmentPreview`、`session.attachmentOpen`：新增 IPC，都只接收附件 id，路径由主进程查库得到。
- `files/browse.ts`：拆出 `previewFile(file, name)`，工作区文件和附件共用。格式按 `name` 判断，工作区传用户选的相对路径，所以 `report.pdf → objects/12345` 这样的软链接仍按 PDF 预览。
- `@kits/core` 新增 `canOpenAttachment`：只放行文档、数据和图片类型。脚本和网页只在文件夹里选中，避免 Windows 上 `.js` 这类文件打开即执行。
- `session/panels/FileBody.tsx`（新增）：从 `FilesPanel.tsx` 抽出预览内容，文件页签和附件弹窗共用。
- `session/thread/AttachmentPreview.tsx`（新增）、`Blocks.tsx`：文件名改成按钮，点开弹窗。弹窗打开时才读文件，关闭后不留缓存。
- 原型：附件芯片可点，新增附件预览对话框。

配置项、数据库 schema 没有变化。

### 测试

- 单元测试：`attachment.test.ts` 覆盖能打开和不能打开的类型；`session-service.test.ts` 覆盖预览、原文件没了、id 不存在。
- E2E：`attachments.spec.ts` 新增 `previews sent documents from the file name in the message`，覆盖 Markdown、PDF 重复打开、Word、脚本、原文件被删，并断言系统应用的调用。

### 新增依赖

无。

### 已知问题

- 用系统应用打开的是 kits 存的副本，文件名带 id 前缀，在外部改动后再发消息不会带上新内容。
- 旧版本的插话记录没有附件 id，文件名仍然不能点。
- 这次没有给输入框里还没发送的附件加预览，需求只提到用户消息下面的文件名。
