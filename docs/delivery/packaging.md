# 交付说明：packaging

## 2026-11-04　安装包、内置资源、自动更新、发版流程

> 日期：2026-11-04　PR：见本分支 `build/packaging`　作者：Claude Code

### 原始需求

phase1-implementation PR20：electron-builder 出 mac dmg（arm64 / x64）、win nsis（x64），`vendor/` 两种内核，`builtin/` 和 `drizzle/` 进 resources；electron-updater generic provider，更新地址从 `settings.json` 的 `updateUrl` 或 `KITS_UPDATE_URL` 读，没配就不检查；CI `release.yml` 打 tag 出未签名包；签名和公证的配置项留好并在 README 写需要什么。

### 怎么验收

1. 本机（mac arm64）：`pnpm vendor:kernel && pnpm --filter @kits/desktop package:dir`，打开 `apps/desktop/release/mac-arm64/kits.app`：
   - 能进首页；设置 → 内核与模型里 OpenCode 显示“已安装 1.19.5”（来自 `Resources/bin/opencode`），CodeAgent“未安装”并给出安装说明；
   - 设置 → 技能与记忆里有内置的 `/code-review`、`/explain`、`/test-plan`，设置 → Agent 里有内置的 `assistant`（来自 `Resources/builtin`）；
   - 关窗后菜单栏有 kits 图标（来自 `Resources/tray`）；数据库迁移正常（来自 `Resources/drizzle`）。
   这些在本机用 Playwright 起打包后的应用核对过：内核 `[opencode, 已安装, 1.19.5]`、`[codeagent, 未安装]`，内置技能 `code-review,explain,test-plan`，Agent `assistant:builtin`，检查更新 `disabled / no-url`。
2. `pnpm --filter @kits/desktop package`（去掉 `:dir`）出 `kits-0.1.0-mac-arm64.dmg` 和 zip；Windows 上同样的命令出 `kits-0.1.0-win-x64.exe`。
3. 设置 → 通用 → 版本与更新：没配地址时说明怎么配；配了 `updateUrl`（打包后的应用）点“检查更新”显示“已经是最新版本 / 有新版本 x.y.z / 检查失败：原因”；开发版本显示“开发版本不检查更新”。
4. 推一个 `v0.1.0` tag：`release.yml` 在 macos-latest（arm64）、macos-13（x64）、windows-latest（x64）上打包，产物挂到草稿 release。

### 主要改动

- `apps/desktop/electron-builder.yml`：extraResources 加上 `builtin/`、`tray/`、CodeAgent（`vendor/codeagent/<os>-<arch>`，空目录就不带）；mac `dmg + zip`、win `nsis`，架构由命令行定；产物命名 `kits-<版本>-<平台>-<架构>`；`notarize: false` 留好开关。
- `apps/desktop/resources/icon.png`：1024×1024 应用图标（和托盘同一个 k，留了 macOS 要的边距），electron-builder 自己转 icns / ico。
- `scripts/vendor-kernel.mjs`：`KITS_CODEAGENT_BIN` 设了就把 CodeAgent 一起拷进 `vendor/`。
- `apps/desktop/src/main/updater.ts`：generic provider，地址 `KITS_UPDATE_URL` → `settings.updateUrl`；只在打包后检查，启动 30 秒后一次、之后每 6 小时；下载好由 electron-updater 发通知、退出时安装。IPC `app.checkForUpdates`；设置 · 通用加了“版本与更新”。
- `.github/workflows/release.yml`：tag 触发，三台 runner 各打自己的架构，未签名；证书的 Secrets 名字写在注释和 README 里。
- `README.md`：“打包和发布”一节（本机打包、带 CodeAgent、发版、签名要什么、自动更新怎么配）。

### 测试

- 本机打包 + Playwright 起打包后的应用核对资源（见“怎么验收”第 1 步）。
- E2E、单测照旧（更新只在打包后检查，开发版本返回 `disabled`）。
- `release.yml` 只能推 tag 时跑，这次没推。

### 新增依赖

没有新的三方库：`electron-builder@26.18.0`（MIT，devDependency）和 `electron-updater@6.8.11`（MIT）在脚手架时就加了，这次第一次真正用上 `electron-updater`。

### 已知问题

- 未签名：mac 第一次打开要右键“打开”，Windows 有 SmartScreen 提示；自动更新在 mac 上要求签名，签名前 mac 的自动更新不会生效（Windows 可以）。
- 应用图标是代码画的占位，设计稿出来后替换 `apps/desktop/resources/icon.png` 就行。
- `release.yml` 没有实跑过；`macos-13`（Intel）runner 如果被 GitHub 下线，要换成交叉 vendor 的方式。

## 2026-11-04　修 mac 签名、发版流水线和缺内核时的静默打包

> 日期：2026-11-04　分支：`fix/packaging-signing-and-release`　作者：Claude Code

### 原始需求

本机实际打包时发现四个问题，这次都修掉：

- mac 包的签名校验不过（`codesign --verify` 失败），发给别人后可能提示“已损坏”。
- `release.yml` 的 `pnpm package -- --publish never --<架构>` 里，`--` 之后的参数全被 electron-builder 丢掉。
- `release.yml` 用的 `macos-13` runner 已被 GitHub 下线。
- `vendor/` 里没有目标平台的内核时只打警告，能打出没有内核的包（比如在 mac 上 `--win`）。

做到什么程度算完：mac 包签名校验通过并能启动；流水线的参数生效；缺内核时打包失败并说清楚怎么办。

### 怎么验收

1. 在 mac arm64 上运行 `pnpm vendor:kernel && pnpm --filter @kits/desktop package`，日志里有 `signing ... identityName=-`。
2. 运行 `codesign --verify --deep --strict apps/desktop/release/mac-arm64/kits.app`，退出码是 0，没有输出。
3. 打开 `apps/desktop/release/mac-arm64/kits.app`，能进首页。如果 `pnpm dev` 开着，单实例锁会让它一启动就退出，先关掉 dev。
4. 在 `apps/desktop` 下运行 `pnpm exec electron-builder --config electron-builder.yml --win --x64`，打包失败，报 `OpenCode binary not found at .../vendor/opencode/win-x64/opencode.exe; run pnpm vendor:kernel on a win x64 machine first`，不产出 exe。
5. 在 GitHub Actions 手动运行 `release`（`gh workflow run release.yml --ref <分支>`）：三个任务都绿，mac 任务的日志里有 `signing ... identityName=-`，产物里有 dmg、zip 和 Windows 的 exe。

### 主要改动

- `apps/desktop/electron-builder.yml`：`mac.identity: "-"`（ad-hoc 签名）。electron-builder 没有证书时不会自动 ad-hoc，要显式打开。`mac.hardenedRuntime` 改成 `false`，ad-hoc 加 hardened runtime 会因为库校验启动失败。新增 `beforePack` 钩子。
- `apps/desktop/scripts/check-kernel.mjs`：`beforePack` 钩子，`vendor/opencode/<os>-<arch>/` 里没有内核就让打包失败。`apps/desktop/vitest.config.ts` 把 `scripts/` 纳入单测。
- `.github/workflows/release.yml`：
  - 去掉 `pnpm package` 后面的 `--`。
  - `macos-13` 换成 GitHub 推荐的 `macos-15-intel`。
  - 去掉 `CSC_IDENTITY_AUTO_DISCOVERY=false`，它会连 ad-hoc 签名一起跳过。
  - 没配 Secrets 时 unset 空的 `CSC_LINK`，否则 electron-builder 把空字符串当路径读，报 `not a file` 退出。
- `README.md`：写明 mac 现在是 ad-hoc 签名和打开方式；证书到位后要改 `mac.identity`、`mac.hardenedRuntime`、`mac.notarize` 三项；Windows 包不能在 mac 上交叉打。

配置项和数据库 schema 没有变。

### 测试

- 单测：`apps/desktop/scripts/check-kernel.test.ts` 覆盖平台和架构到 vendor 路径的映射、缺内核时报错、有内核时通过。`pnpm check` 全过（469 个用例）。
- 本机（mac arm64）：用和 `release.yml` 相同的脚本和空的 `CSC_LINK` 打包成功；`.app` 和 zip 解出来的 `.app` 都通过 `codesign --verify --deep --strict`；用 Playwright 起打包后的应用能进首页，内核和内置资源都在 `Resources` 下。
- 缺内核：`--win --x64` 和 mac 上的 `--x64` 都按预期失败，同时证明 `--x64` 这个参数生效了。

### 新增依赖

无。

### 已知问题

- `release.yml` 还没有在 GitHub 上实跑过，Windows 和 x64 mac 的打包都没有实测。
- 没有在另一台 Mac 上验证下载后的打开流程。ad-hoc 不是 Developer ID 签名，Gatekeeper 仍会拦，只是校验不再失败，打开方式见 README。
- ad-hoc 包的 mac 自动更新仍不生效，要等 Developer ID 证书。
- 上一节“已知问题”里的“右键打开”和“换成交叉 vendor”以本节为准。

## 2026-11-04　Windows 便携版和安装说明

> 日期：2026-11-04　PR：见本分支 `feat/packaging-win-portable`　作者：Claude Code

### 原始需求

要在另一台 Windows 机器上装好依赖，并打出单个可执行文件。那台机器的 Node 是 24.14.1，`corepack enable` 报 `EPERM: operation not permitted, open 'C:\Program Files\nodejs\pnpm'`。

做到什么程度算完：README 写清楚这个报错怎么处理；一条命令打出便携版，文件名和安装包不冲突。

### 怎么验收

在 Windows x64 机器上操作：

1. 普通用户终端运行 `npm i -g pnpm@12.16.1`，再运行 `pnpm -v`，输出 `12.16.1`。
2. 在仓库根目录运行 `pnpm install --frozen-lockfile`，无报错。
3. 运行 `pnpm vendor:kernel`，`vendor/opencode/win-x64/opencode.exe` 出现。
4. 运行 `pnpm --filter @kits/desktop package:portable`，出现 `apps/desktop/release/kits-0.1.0-win-x64-portable.exe`。
5. 把这个 exe 拷到另一个目录双击运行（未签名，SmartScreen 提示时点“更多信息 → 仍要运行”），能进首页，设置页显示 OpenCode 已安装。
6. 运行 `pnpm --filter @kits/desktop package --x64 --publish never`，出现 `apps/desktop/release/kits-0.1.0-win-x64.exe`，第 4 步的便携版还在。

### 主要改动

- `apps/desktop/package.json`：新增 `package:portable` 脚本，固定打 Windows x64 便携版，不发布。
- `apps/desktop/electron-builder.yml`：新增 `portable.artifactName`，产物带 `-portable` 后缀。不改的话和 NSIS 安装包同名，后打的覆盖先打的。
- `README.md`：写明 corepack 的 `EPERM` 怎么处理、Windows 创建软链接的前提、便携版怎么打和有什么限制。

默认的 `package` 脚本、`release.yml` 和 NSIS 配置都没动，发版产物不变。数据库 schema 没有变。

### 测试

- 没有新增逻辑，不加单测。`pnpm check` 全过。
- 本机（mac arm64）：在 `vendor/opencode/win-x64/` 放占位文件后运行 `package:portable`，打包成功，产物是 `kits-0.1.0-win-x64-portable.exe`（约 112 MB）。这只验证脚本和命名，占位内核跑不起来，试打后已删掉占位文件。

### 新增依赖

无。

### 已知问题

- 没有在真实 Windows 机器上打包和运行过，上面的验收步骤要在 Windows 上走一遍。
- `updater.ts` 不区分便携版。配了 `updateUrl` 的便携版仍会检查更新，所以 README 写明不要配。
- 配置和数据不跟着 exe 走，这个便携版只是免安装，不能带着数据换机器。

## 2026-11-04　便携版打包不再依赖 GitHub

> 日期：2026-11-04　分支：`fix/packaging-portable-local-electron`　作者：Claude Code

### 原始需求

在 Windows 上运行 `package:portable`，依赖都装好了，打包时报 `connect ETIMEDOUT 20.205.243.166:443`，这是 GitHub 的地址。electron-builder 不用 Electron 包自带的校验值，每次打包都要去 GitHub 取 `SHASUMS256.txt`，本地缓存里有 zip 也一样。

做到什么程度算完：在连不上 GitHub 的 Windows 机器上，`package:portable` 能打出便携版。

### 怎么验收

在 Windows x64 机器上操作，依赖和内核按上一节第 1～3 步准备好：

1. 运行 `Test-Path apps\desktop\node_modules\electron\dist\electron.exe`，输出 `True`。
2. 运行 `pnpm --filter @kits/desktop package:portable`，日志出现 `using custom unpacked Electron distribution`，没有 `ETIMEDOUT`，出现 `apps/desktop/release/kits-0.1.0-win-x64-portable.exe`。
3. 把这个 exe 拷到另一个目录双击运行，能进首页，设置页显示 OpenCode 已安装。

### 主要改动

- `apps/desktop/package.json`：`package:portable` 加上 `--config.electronDist=node_modules/electron/dist`，直接用已安装的 Electron，不下载。
- `apps/desktop/electron-builder.yml`：注释写明这个参数的原因和平台限制。
- `README.md`：便携版一条写明不用连 GitHub，只能在 Windows x64 上跑。

默认的 `package` 脚本和 `release.yml` 没动，发版产物不变。数据库 schema 没有变。

### 测试

- 没有新增逻辑，不加单测。`pnpm check` 全过。
- 本机（mac arm64）：解开 win32-x64 的 Electron zip，在 `vendor/opencode/win-x64/` 放占位文件，用 `package:portable` 的参数打包，只把 `electronDist` 换成解开的目录。打包成功，产物是 `kits-0.1.0-win-x64-portable.exe`（约 112 MB），日志显示用的是指定目录、没有下载 Electron。这只验证参数和命名，占位内核跑不起来，试打后已删掉占位文件。

### 新增依赖

无。

### 已知问题

- 没有在真实 Windows 机器上打包和运行过，上面的验收步骤要在 Windows 上走一遍。
- `package:portable` 只能在 Windows x64 上跑：`node_modules/electron/dist` 是本机平台的 Electron。上一节“测试”里在 mac 上直接跑这个脚本的做法不再适用。
- 用本地 Electron 时 electron-builder 不清理 `default_app.asar`，它会留在包里，不影响运行（Electron 优先加载 `app.asar`）。
- 默认的 `package` 脚本没改，在连不上 GitHub 的机器上打安装包，要手动在命令后加 `--config.electronDist=node_modules/electron/dist`。

## 2026-11-04　CI 只跑 Windows

> 日期：2026-11-04　分支：`chore/ci-windows-only`　作者：Claude Code

### 原始需求

kits 主要运行在 Windows 上，mac 只用于本地开发，CI 不需要再跑 macOS。

做到什么程度算完：PR 和 `main` 的 CI 只有一个 Windows job，lint、typecheck、单测、构建、E2E 都还在。

### 怎么验收

1. 开 PR 后，检查列表里只有 `check`，运行在 `windows-latest` 上，没有 `check (macos-latest)`。
2. E2E 失败时，运行页面的产物里有 `playwright-report`。

### 主要改动

- `.github/workflows/ci.yml`：去掉 `matrix`，直接用 `windows-latest`。检查名从 `check (windows-latest)` 变成 `check`。
- `AGENTS.md`、`.agents/skills/e2e-test/SKILL.md`：同步写明 CI 只跑 Windows，mac 上提交前在本机跑。

`release.yml` 没动，打 tag 时仍然出 mac 和 Windows 的包。配置项和数据库 schema 没有变。

### 测试

- 只改了 CI 配置，不加单测。工作流文件能解析，`pnpm check` 全过。
- 工作流本身要推到 GitHub 才能真正跑，本地验证不了。

### 新增依赖

无。

### 已知问题

- mac 上的问题 CI 不再拦，全靠提交前在本机跑 `pnpm check` 和 `pnpm test:e2e`。
- 从 2026-11-04 起 CI 因 GitHub 账单没有运行，#36～#40 的 Windows E2E 都没跑过。CI 恢复后第一次运行要看这些改动在 Windows 上是否通过，尤其是 `desktop.spec.ts` 的 `shows the hidden window when the app is launched again`。

## 2026-11-05　未打包启动时不再构造 autoUpdater

> PR：见本分支

### 原始需求

`createUpdater` 在主进程启动链上同步调用，以前一进来就取 `autoUpdater`。electron-updater 构造实例时校验版本号，未打包启动（开发、E2E）时 `app.getVersion()` 可能不是合法 semver，构造直接抛 `ERR_UPDATER_INVALID_VERSION`，后面的窗口建不起来。

### 怎么验收

1. 未打包启动应用（`pnpm dev`）。预期：窗口正常打开，设置里的更新检查显示未启用。
2. 打包后的应用配上更新地址。预期：检查更新和之前一样。

### 主要改动

- `apps/desktop/src/main/updater.ts`：`autoUpdater` 推迟到 `check()` 里、确认已打包之后再取。这项改动来自内网，原样同步。

配置项和数据库 schema 没有变。

### 测试

- `updater.test.ts` 新增 `leaves electron-updater alone when the app is not packaged`，放到旧代码上会失败。

### 新增依赖

无。

### 已知问题

无。

## 2026-11-06　打包时检查 ripgrep

> PR：#85

### 原始需求

Windows 上测试时，grep、glob 工具报 `ripgrep execution failed`，PATH 里也没有 `rg`。kits 本该随包带 `rg.exe`，但打包有个漏洞：`vendor/ripgrep/win-x64` 不存在时 electron-builder 只打警告，`beforePack` 又只检查 OpenCode。在 #52 之前跑过 `pnpm vendor:kernel` 的机器，之后只跑打包命令，能打出没有 `rg.exe` 的包。

做到什么程度算完：Windows 包缺 `rg.exe` 时打包失败，错误里写明怎么修。

### 怎么验收

1. 在 Windows 仓库根目录删掉 `vendor\ripgrep`，跑 `pnpm --filter @kits/desktop package:dir`。预期打包失败，报 `ripgrep not found at ...\vendor\ripgrep\win-x64\rg.exe; check third_party/ripgrep/win-x64 and run pnpm vendor:kernel`。
2. 跑 `pnpm vendor:kernel` 后再打包。预期打包成功，`resources\bin\ripgrep\rg.exe` 存在。
3. 在 mac 上跑 `pnpm vendor:kernel && pnpm --filter @kits/desktop package:dir`。预期照常成功，mac 不随包带 ripgrep。

### 主要改动

- `apps/desktop/scripts/check-kernel.mjs`：新增 `assertRipgrep`。Windows 一定要有 `rg.exe`；其他平台在 `third_party/ripgrep/<os>-<arch>` 存在时才要求，以后加了 mac 版也管得到。

配置项和数据库 schema 没有变。

### 测试

- `check-kernel.test.ts` 覆盖：缺文件、空目录、已就绪、不带 ripgrep 的平台、有 `third_party` 没 vendor。
- 在 mac 上跑 `electron-builder --win --x64 --dir`，放一个占位的 `opencode.exe`、不放 `rg.exe`，打包在 `beforePack` 失败。这个检查没有留在仓库里。

### 新增依赖

无。

### 已知问题

- 这次只防打包漏带。那台 Windows 机器上的报错是不是这个原因，还要按定位结论在机器上确认；如果是 PATH 没传到内核或 `rg.exe` 被拦截，这个检查管不到。
- mac 不随包带 ripgrep，内网的 mac 用户仍然依赖本机的 `rg`。


## 2026-11-07　默认更新地址、侧栏新版本提示、更新说明

> 日期：2026-11-07　PR：见本分支 `feat/updater-default-url-and-badge`　作者：Claude Code

### 原始需求

内网用 Jenkins 打包，安装包放在 Jenkins 的归档页，每次发布都要用户自己去下载，不友好。要做到：

- 自动更新复用 Jenkins（`userContent` 静态目录），不另搭服务器。
- 客户端不用手配更新地址：安装包自带默认地址，用户可以在 `settings.json` 里改或关掉。
- 有新版本时给一个显著但不打扰的提示，能看到这个版本改了什么；版本号按 SemVer，更新内容来自 CHANGELOG。

原型：`designs/app/shell.js`（侧栏底部的新版本标签和浮层，`?update=ready` / `?update=busy`）、`designs/app/settings.html#general`（“版本与更新”卡片，`?update=latest|downloading|ready|busy|error`）。评审结论：

- 只在下载好之后提示；下载中、检查失败只在设置里看得到，检查失败不标红。
- 不弹窗、不发系统通知、不自动重启；标签一直留在侧栏，退出 kits 时自动装上。
- 有会话在运行、等确认或有排队消息时，“重启并更新”不可点，说明为什么。
- 浮层里直接列出这个版本的全部更新内容（多了可以滚动），不再链到别处。

### 怎么验收

不连更新服务器也能看界面（E2E 用的假更新）：

1. `pnpm build`，然后 `cd e2e && pnpm exec playwright test tests/update.spec.ts`。预期 2 个用例通过，截图在 `e2e/test-results/update-popover.png`、`update-busy.png`、`update-settings.png`。
2. 或者手动：`KITS_UPDATE_MOCK=ready pnpm dev`，半秒后侧栏底部出现“新版本 0.1.1”，点开是三条更新内容和“重启并更新”。`KITS_UPDATE_MOCK` 换成 `downloading`、`latest`、`error` 看设置 · 通用里“版本与更新”的其他状态。

真实更新（Windows，Jenkins 按 README“自动更新”一节配好之后）：

3. 打一个 0.2.0 的包装上。设置 · 通用 · 版本与更新：更新地址是 Jenkins 的 `userContent/kits`，标“安装包自带”；30 秒后显示“已经是最新版本”。
4. 仓库里版本号升到 0.2.1、CHANGELOG 加 `## [0.2.1]` 一节，合入后 Jenkins 打包并发布。预期 `userContent/kits/latest.yml` 的 `releaseNotes` 是这一节的内容。
5. 在 0.2.0 上点“检查更新”。预期显示下载进度，下载完侧栏底部出现“新版本 0.2.1”，点开的更新内容和 CHANGELOG 一致。
6. 有会话在等确认时点开标签：“重启并更新”不可点，有黄色说明。会话结束后点“重启并更新”：kits 退出、静默安装、重新打开，版本是 0.2.1。
7. 再验一次不重启的路径：下载好后直接退出 kits（托盘或菜单里的“退出 kits”），再打开。预期已经是新版本。
8. `~/.kits/settings.json` 写 `"updateUrl": "off"`。预期卡片显示“自动更新已关闭”，地址显示“已关闭”，不再检查。

### 主要改动

- `apps/desktop/src/main/updater.ts`：地址按 `KITS_UPDATE_URL` → `settings.json` 的 `updateUrl` → 安装包自带（`resources/app-update.yml`）取，任一处写 `off` 关闭；占位地址 `updates.invalid` 当作没配。状态机 idle / checking / latest / downloading / ready / error 推给界面（`app.update`）；下载好后不再被后续检查或出错覆盖。去掉 `checkForUpdatesAndNotify` 的系统通知。`latest.yml` 的 `releaseNotes` 解析成“分类 + 一句话”的列表。“重启并更新”调 `quitAndInstall(true, true)`：静默安装后重新打开。运行中改了更新地址或写了 `off`：旧地址正在下的取消、下好的作废，“退出时自动装上”只在接受了当前地址下好的版本时打开；换成新地址后先等旧的检查和下载结束，再马上查一次。顺带接住了 `downloadPromise` 的 reject（以前下载失败会留下未处理的 Promise 拒绝）。
- `apps/desktop/src/main/updater-mock.ts`：`KITS_UPDATE_MOCK` 的假更新，只给 E2E 和界面开发用，和 `KITS_KERNEL=mock` 一样。
- `packages/core/src/ipc.ts`：`app.updateStatus`、`app.checkForUpdates`（改为返回完整状态）、`app.installUpdate`、`app.openSettingsFile`，推送 `app.update`。
- 打包：`beforePack` 换成 `apps/desktop/scripts/before-pack.mjs`，先做原来的内核和 ripgrep 检查，再用 `release-notes.mjs` 从仓库根目录的 `CHANGELOG.md` 取出这个版本的一节写成 `apps/desktop/resources/release-notes.md`（已加进 `.gitignore`），electron-builder 放进 `latest.yml`。没有 CHANGELOG 或没有这个版本的一节就不带说明。Jenkins 直接调 electron-builder 也会走这个钩子。
- `electron-builder.yml`：`publish.url` 的注释写明它是客户端默认地址，内网打包用 `-c.publish.url=` 覆盖，内网地址不进仓库。
- 界面：`shell/UpdateBadge.tsx`（侧栏标签和浮层）、`shell/UpdateNotes.tsx`、设置 · 通用的“版本与更新”卡片重写，卡片放在快捷键下面（和原型一致）；`ui/Popover.tsx` 支持从右边弹出和 `aria-label`。
- 原型按评审结论去掉了浮层里的“完整的更新说明”链接，改成列表可滚动。
- 原型里“已经是最新版本 · 10 分钟前查过”的时间写法，实现成：一小时内写“N 分钟前”，当天写时刻，更早写日期。

`settings.json` 的 schema 没变（`updateUrl` 多了 `off` 这个取值），数据库 schema 没变。

### 测试

- 单元测试：`updater.test.ts`（地址优先级和 off、读 app-update.yml 和占位地址、更新说明解析、状态流转、下载好后不被出错覆盖、只取错误第一行、下载好之前不能安装；关掉更新后退出不再安装、换地址后丢掉旧地址的更新并查新地址、下载中关掉会取消且之后的事件不算数——这四条放到改之前的代码上会失败）；`scripts/release-notes.test.ts`（取版本一节、去掉链接定义、0.2.10 不算 0.2.1、没有一节时删掉旧文件）；`lib/update-labels.test.ts`（哪些会话算忙、发布日期、检查时间）。`pnpm check` 全过。
- E2E：`e2e/tests/update.spec.ts` 两条：下载好后侧栏出标签、浮层里有更新内容、会话等确认时不能重启；设置页显示“已是最新”和地址来源，写 `off` 后关闭。另跑了 settings-general、shell、smoke、desktop，全过。
- 在 mac 上用 scratch 工程跑 `electron-builder --win --x64`（`-c.extraMetadata.version=0.2.1 -c.publish.url=...`，带一份 CHANGELOG）：`latest.yml` 带上了这一节的 `releaseNotes`，`app-update.yml` 的 `url` 是传进去的地址。
- 在本机 Electron 45 上确认：kits 的 `will-quit` 拦下退出、清理完 `app.exit(0)` 之后，electron-updater 监听的 `quit` 事件照样触发，所以“退出时自动装上”能走到。

### 新增依赖

无。

### 已知问题

- 真实的下载和安装（验收第 3～7 步）没有在 Windows 上走过，要在内网机器上确认，特别是静默安装后能不能自动重新打开。
- mac 的自动更新没有验证：Squirrel.Mac 要求正式签名，现在是 ad-hoc 签名，大概率装不上。内网主要是 Windows，这次不处理。
- 已经装了 0.1.x 的人没有默认地址，要手动装一次带默认地址的新包，之后才能自动更新。
- 便携版不该自动更新。打便携版时如果也传了 `-c.publish.url`、包里也带了 `app-update.yml`，它会去检查（没验证便携版会不会生成这个文件）；便携版用户可以在 `settings.json` 里写 `"updateUrl": "off"`。发版流水线不出便携版，这次不单独处理。
