# 交付说明：notify

## 2026-11-04　系统通知、关窗收到托盘 / 菜单栏、程序坞角标

> 日期：2026-11-04　PR：见本分支 `feat/desktop-notify-tray`　作者：Claude Code

### 原始需求

phase1-implementation PR18：系统通知（待确认 / 提问 / 出错 / 完成，窗口在前台不发）；关窗收到托盘 / 菜单栏，⌘Q 退出；点通知打开对应会话。开关在设置 · 通用（PR17 已经做了界面）：“需要我处理时发系统通知”“会话完成时发系统通知”“关闭窗口后继续运行”。

做到什么程度算完：窗口不在前台时，会话有命令等确认、Agent 提问、出错各弹一次通知，点了窗口回到前面并打开那个会话；开着“继续运行”时关窗不退出、运行中的会话不中断，托盘 / 菜单栏能重新打开或退出。

### 怎么验收

1. 设置 · 通用里“需要我处理时发系统通知”开着（默认开）。发一个会跑命令的任务（Mock 内核用 `KITS_MOCK_SCENARIO=permission`），切到别的应用：弹出“有命令等你确认 · <会话标题>”，正文是命令。点通知：kits 回到前面，打开这个会话。同一个确认只弹一次；kits 在前台时不弹。
2. Agent 提问时弹“Agent 有个问题 · …”；一轮出错时弹“出错了 · …”，正文是错误原因。
3. 打开“会话完成时发系统通知”：一轮做完、窗口不在前台时弹“完成了 · …”。应用启动时已经做完的会话不会补发。
4. macOS 程序坞图标的角标显示有几个会话在等你确认或回答，处理完就消失。
5. “关闭窗口后继续运行”开着（默认开）：点窗口的关闭按钮，窗口藏起来，应用还在（运行中的会话继续跑）；菜单栏（macOS）/ 托盘（Windows）出现 kits 图标，菜单里有“打开 kits”、几个会话在运行或等你处理、“退出 kits”。macOS 点程序坞图标也能叫回窗口。⌘Q 或菜单里的“退出”才真正退出。
6. 关掉“关闭窗口后继续运行”：托盘图标收起；关窗按平台习惯走（Windows 退出，macOS 应用留在程序坞）。

### 主要改动

- `apps/desktop/src/main/desktop/notifier.ts`：看会话服务的推送决定发不发通知（`session.part` 里待确认的权限和提问，`session.changed` 里从运行中 / 等处理变成出错、完成），同一件事只发一次，前台不发；顺带算等人处理的会话数给程序坞角标。
- `apps/desktop/src/main/desktop/tray.ts`：关窗时设置开着就 `hide()`，第一次藏起来时建托盘；`before-quit` 之后不再拦。菜单每次打开时现做（会话数是最新的）。
- `apps/desktop/resources/tray/`：托盘图标（macOS 模板图 `trayTemplate.png` / `@2x`，Windows 带底色的 `tray.png` / `@2x`），用一段 Python 直接画的 PNG，没加依赖。
- `apps/desktop/src/main/index.ts`：会话服务的推送先过一遍通知；`createWindow` 返回窗口并挂上关窗逻辑；`activate` 叫回藏起来的窗口；点通知 → 窗口到前面 + 推 `app.navigate`。
- `packages/core/src/ipc.ts`：推送通道 `app.navigate`；`shell/Layout.tsx` 收到就跳路由。

### 测试

- 单元测试：`notifier.test.ts`（6 个）：等确认只发一次、前台不发、出错发、完成看开关、启动时已完成的不补发、等人处理的数量。
- E2E：`desktop.spec.ts`（2 个）：开着“继续运行”时关窗只是藏起来、`activate` 叫回来；关掉后 macOS 关窗不留窗口、再 `activate` 新开一个。系统通知本身没法在 E2E 里点（系统界面），点通知之后的跳转走 `app.navigate`，和通知无关的部分在单测里覆盖。

### 新增依赖

无。

### 已知问题

- 通知文案和图标用系统默认样式；Windows 上未打包时通知的应用名是 Electron（打包后用 `appId`，见 PR20）。
- 托盘图标是手画的位图，设计稿出来后替换 `resources/tray/` 里的四张图就行。
- Linux 没有专门处理（不在第一阶段的目标平台里）。

## 2026-11-04　关窗后再次启动能叫回窗口

> 日期：2026-11-04　分支：`fix/desktop-reopen-hidden-window`　作者：Claude Code

### 原始需求

Windows 上关闭 kits 后再双击 exe 没有任何反应，打不开。这是严重问题，要修复。便携版启动慢不算痛点，这次不处理。

做到什么程度算完：开着“关闭窗口后继续运行”（默认开）时关窗，再次启动应用，原来的窗口回到前台；运行中的实例不受影响。

### 怎么验收

便携版在 Windows x64 上操作，打包方式见 `docs/delivery/packaging.md`；安装版第 1～3 步相同。

1. 双击打开 kits，进到首页后点窗口的关闭按钮。窗口消失，任务管理器里还有 kits 进程，托盘（可能在折叠区）有 kits 图标。
2. 再双击一次 exe。安装版窗口马上回来；便携版要等解压完（十几秒，期间没有界面），窗口回来。
3. 到设置 · 通用，“关闭窗口后继续运行”的说明写的是用菜单栏 / 托盘里的“退出 kits”彻底退出。
4. 便携版：第 2 步之后到设置 → 内核与模型，OpenCode 仍显示已安装；设置 → 技能与记忆里内置技能还在。
5. 从托盘菜单点“退出 kits”，进程消失；再双击 exe，能正常打开。

自动化：`pnpm build && pnpm test:e2e`，`desktop.spec.ts` 的 `shows the hidden window when the app is launched again` 真的再起一个进程。

### 主要改动

- `apps/desktop/src/main/index.ts`：第二个实例启动时走 `background.show()`，和点托盘、点程序坞同一条路。原来只调 `win.focus()`，它对隐藏的窗口不起作用，这个 bug 不分便携版和安装版，mac 上强开第二个实例（`open -n`）也会遇到；mac 上正常双击走 `activate`，一直是好的。窗口都不在时也会新建一个，原来直接返回。
- `apps/desktop/electron-builder.yml`：`portable.unpackDirName: true`，便携版每次启动解压到各自的临时目录。原来的目录是构建时定死的，启动前先清空，结束时再删一次，再双击一次会删掉运行中实例的 `builtin`、`drizzle` 等文件。electron-builder 文档写的是 `false`，但 26.18 的代码里 `false` 仍然生成固定目录，只有 `true` 生效。
- `设置 · 通用`的提示：`⌘Q` 在 Windows 上不适用，改成不分平台的说法。`designs/app/settings.html` 和 `i18n.ts` 一起改。
- `e2e/tests/app.ts`：`launchApp` 新增 `launchAgain()`，用同一份用户数据再启动一次。

配置项和数据库 schema 没有变。

### 测试

- E2E：新增上面那条用例，修复前连跑 4 次全部失败，修复后连跑 3 次全部通过。`pnpm test:e2e` 67 条全过（mac arm64）。这条用例改之前第一次跑时通过过一次，之后没有再出现，原因没查到。
- 单测：窗口行为按约定交给 E2E，没有新增。`pnpm check` 全过（488 个用例）。
- 便携版配置：本机用缓存的 Windows Electron 和占位内核试打成功，`makensis` 的参数里不再有 `UNPACK_DIR_NAME`，产物约 117 MB。占位内核跑不起来，试打后已删掉。

### 新增依赖

无。

### 已知问题

- 没有在真实 Windows 机器上跑过，上面第 1～5 步要在 Windows 上走一遍；CI 的 Windows E2E 会覆盖第二个实例这条路径。
- 便携版再次双击时，窗口要等壳解压完才回来，期间没有界面。便携版只在开发时用，这次不处理。
- 关窗时没有提示，用户不一定知道应用还在托盘里。
- 退出途中（内核启动中最多等 30 秒）再启动，新窗口会随着退出一起消失。
