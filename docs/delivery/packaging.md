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
