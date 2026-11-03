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
  - `config/secrets.ts`：密钥表 `{userData}/secrets.json`，值用 Electron `safeStorage` 加密；系统不支持加密时退化成标了 `plain` 的 base64，以后在设置页提示。
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

- 单元测试：`core/src/ipc.test.ts`（契约列表、类型：无入参的方法是零参调用；补丁合并）；`main/config/config-service.test.ts`（默认值不建文件、合并和落盘、坏补丁不落盘、坏文件提示和备份、手改后重读）；`main/config/secrets.test.ts`（加密存取、不能加密时退化、删除）；`renderer/src/app/app.test.ts`（文案占位、主题解析、快捷键匹配）。
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
