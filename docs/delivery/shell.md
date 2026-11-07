# 交付说明：shell

## 2026-11-04　应用外壳：令牌和主题、路由、基础件、IPC 契约、配置读写

> 日期：2026-11-04　PR：见本分支 `feat/shell-foundation`　作者：Claude Code

### 原始需求

[phase1-implementation.md](../plans/phase1-implementation.md) 第 8 节 PR4，对应 6.1～6.3 节和 5.5 节：设计令牌和主题（浅色 + 深色变量占位）、路由、Radix 基础件、文案表、IPC 契约和 preload 生成、zustand / TanStack Query、`ConfigService` 读写 `~/.kits/settings.json`、密钥存储、侧栏和 ⌘K 的骨架、E2E 的环境变量。原型：[designs/app/shell.js](../../designs/app/shell.js)（侧栏、⌘K）、[index.html](../../designs/app/index.html)（首页）、[settings.html](../../designs/app/settings.html)（设置页外框）。

做到什么程度算完：应用打开是原型里的首页和侧栏，⌘K、⌘B、⌘N、⌘, 可用，设置分区能直达，设置读写落到 `~/.kits/settings.json`，改主题立刻生效。各页面的业务内容在后续 PR。

### 怎么验收

1. `pnpm check` 全绿；`pnpm build && pnpm test:e2e` 5 个用例通过（`smoke`、`shell` 4 个）。E2E 每次用临时的 `KITS_CONFIG_DIR` 和 `KITS_USER_DATA_DIR`，不碰本机的 `~/.kits`。
2. 手动看：`KITS_CONFIG_DIR=/tmp/kits-try pnpm dev` 打开应用。
   - 首页是“要做什么？”和输入框，左边侧栏有“新会话 ⌘N”“搜索 ⌘K”“还没有会话”“设置 ⌘,”。
   - 按 ⌘B（Windows 用 Ctrl+B）侧栏折叠成图标栏，再按展开；关掉重开，折叠状态还在。
   - 按 ⌘K 打开面板，输入“内核”，只剩“新会话：‘内核’”和“设置 · 内核与模型”两项；按 ↓ 再按 ↵ 跳到设置的“内核与模型”。Esc 关闭面板。
   - 按 ⌘, 进设置：侧栏自动折叠，左边是 7 个分区，底部写“kits 0.1.0 · 配置文件在 /tmp/kits-try”。分区内容先是“这一页还在做”。
   - 打开开发者工具执行 `await kits.settings.update({ general: { theme: 'dark' } })`，界面立刻变深色，`/tmp/kits-try/settings.json` 里出现 `"theme": "dark"`。
   - 把 `/tmp/kits-try/settings.json` 改成不合法的 JSON，重启应用，进设置页顶部出现红色提示和文件路径；再保存一次设置，原文件被备份成 `settings.json.broken-<时间>`。

### 主要改动

- `packages/core/src/ipc.ts`（新，`@kits/core/ipc` 子路径）：IPC 契约。一个对象字面量声明 `app`、`settings`、`secrets` 三个域的方法和入参、返回值类型；`KitsInvoke` 是渲染进程看到的 `window.kits.<域>.<方法>`，`IpcHandlers` 是主进程要实现的处理函数，少一个或类型不对编译报错；推送通道 `settings.changed`。这个文件只有类型导入，打进 sandbox 的 preload。
- `apps/desktop/src/main/`：
  - `config/config-service.ts`：`~/.kits/settings.json` 读写（`KITS_CONFIG_DIR` 可覆盖）。没有文件用默认值，第一次保存才创建；写文件先写临时文件再改名；补丁过一遍 schema，坏值不落盘；文件坏了不覆盖，先用默认值跑、在设置页提示，保存时先备份。
  - `config/secrets.ts`：密钥表 `{userData}/secrets.json`，值用 Electron `safeStorage` 加密；系统不支持加密时退化成标了 `plain` 的 base64，以后在设置页提示。先写文件、成功了再改内存里的表，写失败时读到的还是旧值；文件坏了时先备份，备份失败就拒绝保存（不拦启动），不会把还能恢复的旧密钥盖掉。
  - `index.ts`：同一份用户数据只允许一个实例（`requestSingleInstanceLock`），第二个实例退出并把已有窗口叫到前面，避免两个实例互相覆盖密钥表和数据库。
  - `ipc/register.ts`：按契约逐个 `ipcMain.handle`，`push()` 推给所有窗口。
  - `index.ts`：开发时 `app.setName('kits')`（不设的话 userData 落在 `…/Electron`）；版本号从 `package.json` 编进来（开发时 `app.getVersion()` 返回的是 Electron 的版本）。
  - `platform.ts`：加 `openPath`、`encryptor`；`openExternal` 只放行 http(s)。
- `apps/desktop/src/preload/index.ts`：按契约生成方法，加 `on(channel, listener)` 订阅推送。
- `apps/desktop/src/renderer/src/`（原来的 `App.tsx` 换成下面这些）：
  - `index.css`：设计令牌。浅色取原型的值，深色是占位（PR17 先在原型里定稿）。Tailwind 4 的 `@theme inline` 引用变量，组件只用语义类名（`bg-raised`、`text-fg-muted`…）。`html[data-scale]` 切 12 / 13 / 14px 字号基准，组件字号都用 rem。
  - `app/`：`i18n.ts` 文案表（`t('palette.newWith', { q })`），`theme.ts` 把主题、字号、字体写到 `<html>` 上（`system` 跟随系统），`router.tsx`（hash 路由：`/onboarding`、`/`、`/s/:id`、`/history`、`/settings/:section`），`providers.tsx`。
  - `ui/`：按 Radix 封装的 Button、Kbd、Dialog、Tooltip、Menu、Popover、Switch、Segmented、Tabs，样式照原型。
  - `shell/`：`Nav`（侧栏，⌘B 折叠存 localStorage，设置页固定折叠）、`Palette`（⌘K，↑↓ ↵ Esc，动作：新会话、全部会话、7 个设置分区）、`Layout`（全局快捷键、外观、macOS 顶部拖动区）。
  - `lib/`：`kits.ts`（TanStack Query 的设置读写，推送直接写缓存）、`shortcuts.ts`（快捷键表，mac 用 ⌘、其他平台用 Ctrl）、`ui-store.ts`（zustand：侧栏折叠、面板开关）。
  - `pages/`：首页、设置外框，历史、会话、引导的占位。
- `e2e/tests/app.ts`：`launchApp(env, prepare)`，每次临时的配置和数据目录，`prepare` 可以在启动前放预置文件。
- 原型没画到、按风格补的：设置文件读不了时设置页顶部的红色提示；⌘K 面板里会话一栏的空状态（“还没有会话”）。
- 没有数据库 schema 改动。

### 测试

- 单元测试：`core/src/ipc.test.ts`（契约列表、类型：无入参的方法是零参调用；补丁合并）；`main/config/config-service.test.ts`（默认值不建文件、合并和落盘、坏补丁不落盘、坏文件提示和备份、手改后重读）；`main/config/secrets.test.ts`（加密存取、不能加密时退化、删除、写失败保留旧值、坏文件备份失败时拒绝保存）；`renderer/src/app/app.test.ts`（文案占位、主题解析、快捷键匹配）。
- E2E：`shell.spec.ts`：⌘K 跳设置分区；⌘B 折叠并记住；设置写入配置目录、主题立刻生效、设置页底部显示配置目录和版本；坏设置文件在设置页提示。

### 新增依赖

都在 `apps/desktop` 的 devDependencies（渲染进程打包进去，运行时不需要 node_modules），纯 JS，无原生依赖。

| 依赖 | 版本 | 用途 | 许可证 |
|---|---|---|---|
| react-router | 7.18.5 | 路由（hash 路由，设置分区直达） | MIT |
| radix-ui | 1.8.1 | 无样式原语（Dialog、DropdownMenu、Popover、Switch、RadioGroup、Tabs、Tooltip） | MIT |
| zustand | 5.0.16 | 界面状态 | MIT |
| @tanstack/react-query | 5.105.2 | 设置和列表的数据 | MIT |
| lucide-react | 1.66.0 | 图标 | ISC |

`radix-ui` 是官方的合并包，一个依赖带全部原语，比逐个装 `@radix-ui/react-*` 好管版本。

### 已知问题

- 首页输入框只有样子，目录 / Agent / 权限 / 模型四个浮层和发送在 PR7 接；侧栏会话列表和 ⌘K 的会话搜索在 PR7、PR15。
- 字体：原型用 Google Fonts 的 Inter 和 JetBrains Mono，内网加载不了，现在按系统字体回退（mac 上是苹方，Windows 上是微软雅黑）。要统一观感的话，把两个字体文件放进 resources 打包，等 PR17 做字体设置时一起定。
- 深色配色是占位，PR17 先改原型再定。
- `KITS_SKIP_ONBOARDING` 还没有作用：首次启动门控在 PR17。

## 2026-11-04　整体走查：对着原型逐页过一遍

> 日期：2026-11-04　PR：见本分支 `fix/ui-polish`　作者：Claude Code

### 原始需求

所有功能做完后整体检查界面和交互，对照 `designs/app` 逐页过：间距、对齐、各状态的文案和原型是否一致，“功能 OK 的同时保证极佳的 UI 和 UX”。

### 怎么验收

1. 按 1440×900 打开应用，逐页对照原型（`designs/app/*.html`）：首页、会话（完成 / 等确认）、⌘K、会话历史、设置七个分区、首次引导。结构、间距、文案应和原型一致；原型里有、这版没做的写在下面“已知问题”。
2. 首次引导：左边三步下面的小字随配置变化——配了网关显示“已连接 · <默认模型>”，选了目录显示目录，接了 MCP 显示“已接入 N 个服务”；第 1 步底部也有“第 1 步，共 3 步”。

### 主要改动

- `pages/onboarding/OnboardingPage.tsx`：步骤导航显示每步的配置结果；第 1 步底部补上步数（和第 2、3 步一致）。
- 走查中顺手修掉、已经在前面几个 PR 里的：设置页侧栏和红绿灯的间距（PR5）、首页建议芯片过长挤成一列（PR15）、侧栏展开 / 收起动画时文字换行（PR17）、深色下开关和状态点的写死颜色（PR17）、Agent 页 `external_directory` 溢出（PR14）。

### 测试

- 走查截图：按 1440×900 起应用（Mock 内核）逐页截图，和原型并排对照；首次引导相关的 E2E（`settings-general`、`settings-mcp`、`settings-model`）通过。

### 新增依赖

无。

### 已知问题

- 原型里有、这版没做：会话页顶栏的“导出”按钮（导出在产出面板里）、回复下面的“结果靠谱吗？👍👎”、首页“继续上次”卡片里的改动 / 测试统计、设置页侧栏底部的账号（kits 没有账号）。
- 界面语言只有中文。

## 2026-11-04　字号、侧栏折叠、首页和页签文案的调整

> 日期：2026-11-04　PR：见本分支 `fix/ui-type-and-nav`　作者：Claude Code

### 原始需求

用户走查时提的五条，参照 Claude Code 桌面版的界面：

1. 界面字体偏小，大一号。
2. 设置页点侧栏的折叠 / 展开按钮没反应。
3. 输入框不用显示“⇧↵ 换行”：回车发送、快捷键换行是 mac 和 Windows 上 Agent 工具的默认习惯。
4. 首页的“继续上次”多余。
5. 右侧面板的“终端”有歧义。

原型：[designs/app/](../../designs/app/) 已先改，字号、侧栏、输入框在 `shell.js`，首页在 `index.html`。

### 怎么验收

1. 打开应用，界面字号比之前大一号；设置 → 通用的“界面字号”，小 / 标准 / 大分别显示 13px / 14px / 15px 基准，标准是默认。
2. 进设置页，侧栏收成图标栏。点左上角按钮（或 ⌘B），侧栏展开，提示变成“折叠侧栏”；切到别的设置分区仍是展开的；再点收起。
3. 展开后回首页，侧栏恢复进设置之前的样子（设置页里的展开不改记住的状态）。
4. 会话页 ⌘\ 放大工作区，同样能用按钮和 ⌘B 展开、收起侧栏；展开后切到另一个会话或进设置页，侧栏收起。
5. 输入框右下角没有“⇧↵ 换行”。回车发送，⇧↵ 换行；设置 → 通用的快捷键表里还能查到。
6. 首页只有标题、输入框和建议，垂直居中，没有“继续上次”。侧栏多了“全部会话”，点了进会话历史。
7. 会话页右侧的页签是“改动 / 产出 / 命令 / 上下文”，点总结卡片的“命令”跳到这个页签。
8. 窗口缩到最小（900px）：会话页顶栏不折行、“停止”不竖排；确认卡片的长路径不溢出；输入框工具条换行时发送按钮靠右。

### 主要改动

- **字号**：`index.css` 的 html 基准从 12 / 13 / 14px 改成 13 / 14 / 15px，组件里的 rem 字号跟着等比变大；`--spacing` 改按 14px 算，默认档下 4px 网格、32px 行高不变，只有字变大。侧栏 232px → 248px，给变大的会话标题留宽度。原型里的字号按 14/13 等比换算，取到 0.5px。
- **代码字号默认值**：`codeFontSize` 12 → 13，跟正文同步。只影响没存过这一项的配置，已有的 `settings.json` 保持原值，要变大到设置里改。
- **侧栏折叠**：`Layout` 算出 `autoCollapse`（设置页、放大工作区），这时折叠按钮和 ⌘B 只切当前页的展开状态，不写 `kits.nav.collapsed`，离开就还原。“当前页”按范围算：设置各分区共用一个，放大的会话一个会话一个，所以从放大的会话切到另一个会话或设置页也会收起。放大工作区的按钮之前也是没反应的，一起修了。`Nav` 改成受控组件，按钮提示随状态显示“折叠 / 展开侧栏”。
- **输入框**：去掉换行提示，发送和换行的按键没变。
- **首页**：去掉“继续上次”和 `continueCards`，内容垂直居中。
- **“终端”改名“命令”**：这个页签列的是 Agent 跑过的命令和输出，不能在里面敲命令，和总结卡片的“命令”也统一了。内部的 `terminal` 标识没动。
- 配置项、数据库 schema 都没变。
- 原型没画到、按风格补的：
  - 侧栏的“全部会话”入口。去掉“继续上次”后，历史页只剩 ⌘K 能进，图标和 ⌘K 里的一致。
  - 字号变大后 900px 宽窗口的修补：会话页顶栏的目录和模型单行截断，“停止”不折行，确认卡片的标题行可换行、路径 `break-all`、“本会话允许”按钮不超出卡片；发送按钮 `ml-auto`。

### 测试

- 单元测试：删掉 `continueCards` 的用例，其余不变。`pnpm test`。
- E2E：`shell.spec.ts` 新增设置页展开、收起和离开后还原；`history.spec.ts` 改成从侧栏进全部会话；`workbench.spec.ts` 页签改名，新增放大工作区时切会话、进设置页后侧栏收起。
- 浅色下逐页截图核对过 1280 和 900 两个宽度：首页、会话（完成、等待确认、放大）、会话历史、设置、⌘K、首次引导。深色没有逐页看，这次没改颜色。

### 新增依赖

无。

### 已知问题

- 字号用 rem 换算，默认档下有非整数字号（如 12.9px），渲染没问题，要整数得把各处的 rem 重写一遍，这次没做。
- 窗口 900px 且侧栏展开时，对话栏只有约 270px，输入框工具条会折成三行。要更宽松可以收起侧栏。

## 2026-11-04　输入框菜单不再被窗口遮住，侧栏间距

> 日期：2026-11-04　PR：见本分支 `fix/composer-menu-and-nav-spacing`　作者：Claude Code

### 原始需求

用户走查时提的两条：

1. 首页输入 `/` 或 `@`，菜单顶部被遮住，长技能名还折行被截断。
2. 侧栏“新会话”“搜索”这些项之间的间距太小，高亮时几乎贴在一起。

原型：[designs/app/shell.js](../../designs/app/shell.js)、[settings.html](../../designs/app/settings.html)。

### 怎么验收

验收数据：在 `~/.kits/skills/` 下放十几个技能，其中几个名字较长（比如 `baoyu-article-illustrator`）。

1. 窗口 1280×800，首页输入 `/`：菜单向上开，整个在窗口内；“技能”标题和底部提示不动，中间的列表滚动；长名字完整显示在一行，描述列对齐。
2. 窗口缩到最矮（900×600）再输入 `/`：上方放不下，菜单向下开，仍在窗口内。输入 `@` 同样。
3. 菜单打开时改变窗口高度，菜单跟着调整。
4. 会话页的输入框在窗口底部，菜单照常向上开。
5. 侧栏的新会话、搜索、全部会话之间有 4px 间距，会话列表 2px；设置页的分区导航 4px。

### 主要改动

- `shell/composer-menu.ts`（新增）：`placeMenu` 按输入框上下的空间决定往哪边开、最高多少。向上还能放下 220px 就向上开，和会话页方向一致；再矮才看哪边地方大。
- `shell/Composer.tsx`：打开菜单、文本变化、窗口变化时重新量；菜单改成标题 + 可滚动列表 + 底部提示三段；技能名一列用 subgrid 按最长的算，上限 45%，太长截断并带 `title`，不再折行。修掉了长名字被压进 38px 行高、互相盖住的问题。
- macOS 上窗口顶部留 40px，避开隐藏标题栏后的拖动区。
- `Nav`、`SessionList`、`SettingsPage` 的间距。
- 配置项、数据库 schema 都没变。

### 测试

- 单元测试：`composer-menu.test.ts`，向上、缩小、向下、两边都不够四种情况。
- E2E：`shell.spec.ts` 新增矮窗口下 `/` 和 `@` 菜单都在窗口内，预置了足够多的技能和文件，没有这些菜单不够高，复现不了。

### 新增依赖

无。

### 已知问题

- 菜单向下开时会盖住首页的建议，关掉菜单就恢复。

## 2026-11-05　侧栏会话的菜单：重命名和删除

> PR：#49　作者：Claude Code

### 原始需求

侧栏的会话要能删除和重命名：点行右边的 `…` 弹出菜单选动作。原型见 `designs/app/shell.js`，任一页面的侧栏都能点。

### 怎么验收

1. 鼠标移到侧栏一个会话上：右边出现 `…`，点开有“置顶 / 重命名 / 删除”。右键这一行是同一个菜单。键盘 Tab 到 `…` 也能打开。
2. 重命名：行变成输入框，标题全选。回车或点别处保存，Esc 放弃，清空不保存。打开的会话顶栏标题跟着变，⌘K 能用新标题搜到。改名后会话不跳到“今天”分组。
3. 删除：弹确认框，默认焦点在“取消”。确认后从列表消失。删的是正在看的会话时回到首页，删别的会话留在当前页。
4. 运行中、等确认的会话：“删除”是灰的，右边写“运行中”。

### 主要改动

- `packages/core/src/ipc.ts`、`apps/desktop/src/main/sessions/session-service.ts`：新增 `session.rename`，连续空白压成一个空格，空标题报错，更新搜索索引，不改 `updatedAt`。
- `apps/desktop/src/renderer/src/shell/SessionRow.tsx`：新组件，一行会话：链接、菜单、就地改名、删除确认。
- `ui/Menu.tsx`：`MenuItem` 加 `disabled`、`danger`，`MenuContent` 加 `onCloseAutoFocus`。`ui/Button.tsx`：加 `danger`。
- `designs/app/shell.js`：菜单、改名输入框、确认框。原来行上的置顶按钮收进菜单，“全部会话”页的置顶按钮不变。

配置项、数据库 schema 没有变化。

### 测试

- 单元测试：`session-service.test.ts` 的 `SessionService rename`（不算更新、推送、搜索索引、空标题、没有这个会话）。
- E2E：`history.spec.ts` 的 `renames a session in place from its menu`、`deletes a session after confirming and leaves its page`，置顶用例改走菜单。

### 新增依赖

无。

### 已知问题

- 删除不能撤销，靠确认框兜底。
- “全部会话”页没有重命名，只在侧栏。

## 2026-11-05　界面改版：方案和原型

> PR：见分支 `docs/ui-refresh`　作者：Claude Code

### 原始需求

用下来发现六个问题：两个“第 3 轮”、已有会话的输入框里有改不了的东西、侧栏看不出工作区、整体观感要向 DeepSeek Harness 靠拢、右侧页签太多、没有文件面板。这次只交方案和原型，代码按 [plans/2026-11-ui-refresh.md](../plans/2026-11-ui-refresh.md) 拆成 8 个 PR 再做。

已确认的决策：产出改成对话里的卡片；已有会话能换模型，下一条消息起生效；移除工作区连同会话一起删除；文件预览含 PDF 和 Word，不含 Excel。

### 怎么验收

起原型：`python3 -m http.server 8765 --directory designs/app`，打开 <http://localhost:8765/session.html>。

1. `session.html?s=done`：对话里没有“第 N 轮”；步骤组是无边框的折叠行；顶栏只有工作区 / 标题、状态、`…`、面板按钮。
2. `session.html?s=queued`：点“插话”，插话前后是两段普通步骤组，没有“继续”字样。
3. 同一页输入框：没有工作区和 Agent；点权限、模型能改，对话里多一行留痕；模型菜单里没有内核切换。
4. 点用量环或 `…` → 查看上下文：弹出上下文对话框；`?s=context` 时用量环变色，输入框上方有提示。
5. 侧栏：会话按工作区分组，折叠后刷新不丢，当前会话所在的组不会被折叠；member-svc 有“显示其余 2 个”；组标题上有 `…` 和 `+`。
6. points-web 的 `…` → 移除工作区：确认框写明删 1 个会话和磁盘文件不受影响。member-svc 有运行中的会话，移除项是灰的。
7. `session.html?s=output`：对话里有产出卡片，产出页签可关闭，关闭后点卡片的“查看”能再打开。
8. `session.html?s=files`：目录树；点文件进预览，有返回按钮。`?s=files-wide`：左树右预览；Markdown 能切源码；筛选框能平铺匹配的文件。依次点 `R-1024.pdf`、`R-1031.docx`、`orders.csv`、`redeem-flow.png`、`cases.xlsx`、`order-svc.log` 看各种预览和不能预览的状态。
9. 任一页加 `?theme=dark` 看深色。

### 主要改动

- `docs/plans/2026-11-ui-refresh.md`：新方案。
- `designs/app/`：全部页面换令牌（颜色、系统字体、字号只用 12 / 13 / 14 / 16 / 20、圆角）；不再从网上取字体。`shell.js` 换侧栏和输入框；`session.html` 换顶栏、步骤组、面板，加 `…` 菜单、上下文对话框、产出卡片、文件面板；`theme.js` 的键跟着新颜色换。
- 界面文案统一成“工作区”。
- 产品代码没有改动。配置项、数据库 schema 没有变化。

### 测试

只改原型和文档，没有代码测试。原型用 Playwright 逐个状态截图核对过，页面没有脚本错误。

### 新增依赖

无。方案里的 `shiki` 在文件面板的 PR 里引入，引入前要在群里说一声。

### 已知问题

- 原型和 `apps/desktop` 暂时不一致，第 1 个代码 PR 开始收敛。
- 深色主题的取值没有调，只是跟着换了映射的键。
- CodeAgent 改权限只有 SDK 文档依据，OpenCode 1.19.5 实测过。

## 2026-11-05　界面改版 1：视觉令牌

> PR：分支 `feat/shell-visual-refresh`　作者：Claude Code

### 原始需求

[界面改版方案](../plans/2026-11-ui-refresh.md)的第 1 个代码 PR：字体、颜色、字号、圆角和步骤组样式向新原型收敛，不改行为。原型：`designs/app/session.html`。

### 怎么验收

1. `pnpm dev`，首页和会话页用的是系统字体（mac 上是苹方），不再是 Inter。
2. 发一条消息：回复正文 14px、行高 24px；步骤组没有边框，左边是折叠箭头，点开有一条细竖线；输入框圆角变大，发送按钮是圆的。
3. 设置 · 通用：字体默认项写“默认（系统字体）”；切换界面大小，字号和行距跟着缩放。
4. 切深色看一遍：层级和浅色一致，代码块、卡片看得清。

### 主要改动

- `index.css`：浅色令牌、字体栈、基础行高、`.k-md` 排版。
- 组件的字号收成 12 / 13 / 14 / 16 / 20（首页和引导的大标题除外），圆角收成 4 / 6 / 8 / 12 / 16，输入框 20。
- `Blocks.tsx`、`Steps.tsx`：步骤组改成无边框的折叠行。序号这个 PR 还在，下一个 PR 去掉。
- `SessionRow.tsx`：行高 32px。

配置项、数据库 schema 没有变化。

### 测试

样式改动，没有新增单测；`pnpm check` 和全部 E2E 通过。

### 新增依赖

无。

### 已知问题

无。

## 2026-11-06　界面改版 5：按工作区分组的侧栏

> PR：分支 `feat/shell-workspace-sidebar`　作者：Claude Code

### 原始需求

侧栏的会话是平铺的，看不出属于哪个工作区。见[界面改版方案](../plans/2026-11-ui-refresh.md)的决策 3、3a。

### 怎么验收

1. 侧栏：置顶单独一组放最前；其余按工作区分组，行尾是相对时间（刚刚、12 分钟、昨天、3 天）。
2. 点组标题折叠，重开应用还在；当前会话所在的组折不起来。折起来的组里有会话在运行或等处理时，组标题上有状态点。
3. 一个工作区超过 5 个会话时有“显示其余 N 个”。
4. 组标题的 `+`：进首页，输入框选好这个工作区。“工作区”标题右边的按钮添加新目录。
5. 组标题的 `…` 或右键：重命名（只改显示名，鼠标移到组标题上看路径）、在访达中显示。
6. 移除工作区：确认框写明要删几个会话，磁盘上的文件不动；确认后这些会话消失；正看着其中一个时回到首页。有会话在运行时这一项是灰的。
7. 界面上不再出现“工作目录”，右侧面板叫“面板”。

### 主要改动

- `lib/workspaces.ts`：工作区 = 设置里的目录和会话目录的并集，旧数据不用迁移。组的顺序按最近开始的会话算，后台会话有新内容时组不跳。
- `shell/WorkspaceGroup.tsx`、`SessionList.tsx`、`SessionRow.tsx`：分组、折叠、菜单、相对时间。就地改名抽成 `InlineRename.tsx`。
- `workdir.rename`、`workdir.remove` 两个 IPC；`SessionService.removeWorkdir` 先挡运行中的会话，再在一个事务里删。
- `settings.workdirs[].label`：新配置项，可选。最近使用的目录从 10 个放宽到 20 个，重新选中时保留改过的名字。
- `workdirKey`：比较路径前去掉末尾分隔符，Windows 不分大小写。
- 数据库 schema 没有变化。

### 测试

- 单元测试：`workspaces.test.ts`、`relative-time.test.ts`、`workdir.test.ts`，`session-service.test.ts` 的 `SessionService removeWorkdir`（含删到一半失败时全部保留）。
- E2E：`history.spec.ts` 的 `groups the sidebar by workspace and folds a group`、`removes a workspace together with its sessions after confirming`。

### 新增依赖

无。

### 已知问题

- 内核里的会话不删，和删单个会话一样。
- 按时间看会话走“全部会话”，侧栏只有工作区一种分组。

## 2026-11-06　工作区默认折叠，点组标题总能切换

> PR：分支 `fix/shell-workspace-fold`　作者：Claude Code

### 原始需求

用的时候发现：点工作区名称有时不能展开或收起；工作区最好默认折叠。

原因：当前会话所在的组之前是强制展开的，点它没反应。

### 怎么验收

1. 第一次打开：所有工作区都是折叠的，只展开当前会话所在的组。
2. 点任何一个组标题都能展开或收起，包括当前会话所在的组。
3. 从 ⌘K 或“全部会话”打开一个折叠组里的会话：这个组自动展开。
4. 展开状态重开应用还在。

### 主要改动

- `ui-store.ts`：`foldedWorkspaces` 换成 `expandedWorkspaces`，本机的键也换了，之前折叠的记录不再读。
- `WorkspaceGroup.tsx`：打开会话时展开一次，不再强制。
- 原型 `shell.js` 同步。

配置项、数据库 schema 没有变化。

### 测试

- E2E：`history.spec.ts` 的 `groups the sidebar by workspace and folds a group`。

### 新增依赖

无。

### 已知问题

无。


## 2026-11-07　E2E 拖动不再被真实光标打断

> PR：[#91](https://github.com/cymoo/kits/pull/91)　作者：Claude Code

### 原始需求

`e2e/tests/shell.spec.ts` 的 `resizes the sidebar by dragging, remembers it and resets on double click` 偶发失败，拖完宽度不是 308。要查清是测试时序问题还是侧栏拖动的 bug，然后修掉，重复 30 次全过。顺带去掉 `mockScenarioNames` 里重复的 `'plan'`。

### 结论

**不是产品 bug，也不是测试时序问题，是 E2E 的透明窗口漏进了真实鼠标事件。** 侧栏拖动的代码没有改。

- 失败率：修之前 30 次失败 1 次，加埋点后 120 次里宽度不对 6 次（260、272、284、296 都出现过，正好是 5 步移动里断在第几步）。
- 根因：`setIgnoreMouseEvents` 只挡点击。真实光标在透明窗口范围内移动时，macOS 上还会有 `mouseLeave` 和不带按键的 `mouseMove` 进到页面。Chromium 见到不带按键的鼠标事件就认为按键松开了，释放 pointer capture，手柄不再收到后面的移动。这时 Playwright 的鼠标还按着，宽度停在断开的那一步。
- 证据：120 次里 7 次 capture 在 `pointerup` 之前丢失（其中 1 次已经是最后一步，宽度没错），触发事件的坐标都是小数，Playwright 发的是整数；再用系统光标位置比对，真实事件的屏幕坐标和光标差 0。
- 排除的方向：中间事件没有丢，5 次移动全部到了 window，只是目标不再是手柄；宽度按“起始宽度 + 总位移”算，不是增量累加，不受 React 渲染时机影响。
- 用户快速拖动没有这个问题：走真实输入通道、不留间隔地连发按下、8 次带按键移动、松开，150 次全部准确。真实拖动时事件都带按键，所以不会触发。不带按键时结束拖动本来就是对的，因此 `ResizeHandle.tsx` 不用动。

### 怎么验收

以下都在 macOS 上做，先 `pnpm -F @kits/desktop build`。

1. 运行下面的命令，同时把光标放在屏幕中间来回移动。预期：60 条全部通过。

   ```bash
   pnpm -F @kits/e2e exec playwright test tests/shell.spec.ts -g "resizes the sidebar" --repeat-each=60
   ```

2. 运行下面的命令。预期：5 条全部通过，这条不依赖光标。

   ```bash
   pnpm -F @kits/e2e exec playwright test tests/shell.spec.ts -g "keeps a drag going" --repeat-each=5
   ```

3. 运行 `pnpm dev`，手动快速拖动侧栏再松手。预期：宽度停在松手的位置，和以前一样。

### 主要改动

- `apps/desktop/src/main/stray-mouse.ts`（新增）：判断哪些事件要挡。`mouseLeave` 一律挡；按键按着时，不带按键的 `mouseMove` 也挡。
- `apps/desktop/src/main/index.ts`：只在 `KITS_HIDDEN_WINDOW=1` 时用 `before-mouse-event` 接上这个判断，正常运行的应用不受影响。
- `packages/kernel/src/mock/scenarios.ts`：去掉 `mockScenarioNames` 里重复的 `'plan'`。

配置项、数据库 schema 没有变化。界面没有改动，不涉及原型。

### 测试

- 单元测试：`stray-mouse.test.ts`，覆盖挡和放的各种情况。
- E2E：新增 `keeps a drag going when the real cursor crosses the hidden test window`，拖到一半用 CDP 发一个不带按键的移动。去掉过滤时 5 次全失败（宽度 268），加上后 5 次全过。
- 修完的结果：原用例重复 60 次全过；带埋点再跑 150 次全部 308，期间光标在动（采样 400 次有 128 个不同位置），拦下 35 个真实事件（33 个 `mouseLeave`、2 个 `mouseMove`），capture 没有再中途丢失。全量 E2E 93 条通过，`pnpm check` 通过。

### 新增依赖

无。

### 已知问题

- 没按键时的真实 `mouseMove` 还会进页面：测试自己的悬停也长这样，分不出来源。它们不影响拖动，但理论上可能影响依赖悬停状态的用例，目前没见过。
- 新用例发的是 `mouseMove`，CDP 发不了 `mouseLeave`，`sendInputEvent` 又不经过 `before-mouse-event`，所以 `mouseLeave` 只有单测覆盖，真实光标的验证在上面的 150 次里。
- `E2E_HEADED=1` 时窗口是正常窗口，没有这层过滤，这时动鼠标仍然会干扰测试。
- 过滤器靠 `mouseUp` 复位按键状态。Playwright 做 HTML5 拖放时不发 `mouseReleased`，状态会卡住，之后的悬停移动都被挡掉。现在应用里没有 `draggable`，走不到；以后加了要一起处理。
- 只在 macOS 上验证过，这个泄漏也只在 macOS 上看到。Windows 上有没有同样的现象没有实测，CI 上没有真实光标，碰不到。
