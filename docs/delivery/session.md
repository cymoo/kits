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
  - `shell/SessionList.tsx`：侧栏会话列表，按自然日分组；过了午夜、窗口回到前台时重新分组（`lib/use-today.ts`）；运行中的会话给读屏补“运行中”。会话列表的快照回来时按 `updatedAt` 和查询期间的推送合并，后台会话做完的状态不会被旧快照盖回运行中。
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

- 等确认的会话在这一版没有确认入口（PR8），用真实内核时遇到要确认的命令只能停止。Mock 场景里避开了。
- 会话的标题先用任务的前 40 个字，第一轮完成后改成内核标题在 PR15 做历史页时一起看。
- 代码块没有高亮（PR9 加 shiki）。
