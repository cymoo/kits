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
