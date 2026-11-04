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
