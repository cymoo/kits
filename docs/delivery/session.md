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
- `apps/desktop/src/main/sessions/session-service.ts`：建会话、接着说时先把附件存到 `{userData}/attachments/<会话>/`（原文件 + `.txt`），读不了就报错、会话不建；这一轮的用户消息建好后写 `attachments` 表；转出来的文字随消息发给内核（适配器包成 `<attachment name="…">` 段）；运行中排队的消息带着附件，合并时一起发。单个附件上限 20 MB。
- `apps/desktop/src/renderer/src/shell/Composer.tsx`：`+` 菜单（上传文件、引用工作目录里的文件）、拖放、附件芯片、`@` 菜单；`shell/composer-at.ts` 是 @ 查询和替换的纯函数。
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
