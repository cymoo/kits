# 原型

| 目录 | 放什么 |
|---|---|
| `app/` | **产品原型**，当前要实现的样子，只有一份。几个可交互的 HTML 页面，`runtime.js` 是它们的极简运行时。界面改动先改这里。 |
| `explore/<YYYY-MM-DD>-<slug>/` | **探索**，用 `claude-design` 技能画的画板，一个想法一个目录（`explore/2026-11-10-review-table/`）。定稿后并入 `app/`，目录可以删。 |

## app/ 的页面

| 页面 | 内容 |
|---|---|
| `onboarding.html` | 首次引导，一页：模型网关（先配一个）和工作目录（不选就用 `~/kits-workspace`）；MCP 在设置里配 |
| `index.html` | 首页：输入任务；`/` 列出命令，`@` 列出可引用的文件和需求 |
| `session.html` | 会话：对话流 + 工作区面板（改动 / 产出 / 命令 / 上下文）。`?s=` 切换演示状态：`streaming` 运行中、`permission` 命令确认、`question` Agent 提问、`done` 完成、`error` 重试与出错、`context` 上下文接近上限、`changes` 改动面板放大、`output` 结构化产出放大 |
| `history.html` | 会话历史，按状态筛选 |
| `settings.html` | 设置：`#general` 通用、`#model` 内核与模型、`#mcp` MCP 服务、`#skills` 技能与记忆、`#agent` Agent |
| `shell.js` | 共用的侧栏（⌘B 折叠）、拖动改栏宽的手柄 `.k-rz`、输入框（含 `/` 和 `@` 菜单、各个下拉）、⌘K 面板，以及它们用的演示数据 |

预览：`python3 -m http.server 8765 --directory designs/app`，或 Claude Code 的 `app` 预览配置。

深色：任一页加 `?theme=dark`（设置页“通用”里选深色也行，会记住；`?theme=light` 切回）。`theme.js` 按用途把原型里的浅色值换成深色令牌，和 `apps/desktop` 的 `index.css` 一致；新画的页面照常写浅色值就行，要保持原样的小块（比如主题选项的预览图）加 `data-theme-keep`。

## 规则

- 原型只画必要的状态（空、加载、正常、出错），不堆功能；评审结论写回需求。
- 新页面先在 `explore/` 里画，评审过了再进 `app/`；`app/` 里不留废弃页面。
- `app/` 里的页面统一引 `runtime.js` 和 `shell.js`，侧栏、输入框、⌘K 面板和会话列表的演示数据只在 `shell.js` 里改。
- 原型是给人看的，不是产品代码，不要往里加业务逻辑。
