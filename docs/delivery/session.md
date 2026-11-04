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
