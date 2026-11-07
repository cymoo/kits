# kits

一个本地运行的 AI 测试作业平台：测试设计、用例开发、测试执行、结果分析都在一个工具里完成。

- 开发约定和流程：[AGENTS.md](AGENTS.md)（人和 AI 工具都先读这份）
- 文档：[docs/](docs/README.md) — 当前计划是 [docs/plans/2026-11-dev-plan.html](docs/plans/2026-11-dev-plan.html)
- 原型：[designs/](designs/README.md) — 产品原型在 [designs/app/](designs/app/index.html)

## 环境

- Node 24（版本在 `.node-version`，推荐用 [fnm](https://github.com/Schniz/fnm) 或 Volta 管理；低于 22.16 的 Node 跑不了 `node:sqlite` 相关的测试）
- pnpm 12，用 corepack 启用：`corepack enable`。Windows 上 Node 装在 `C:\Program Files\nodejs` 时要用管理员终端，否则报 `EPERM`；没有管理员权限就 `npm i -g pnpm@12.16.1`（和 `package.json` 的 `packageManager` 保持一致）
- Windows：clone 前 `git config --global core.symlinks true`，`.claude/skills/` 是软链接；创建软链接要打开“开发者模式”或用管理员终端

## 开发

```bash
pnpm install
```

```bash
pnpm dev
```

```bash
pnpm check
```

`pnpm check` 跑 lint、类型检查和单测。E2E 先构建再跑：

```bash
pnpm build && pnpm test:e2e
```

E2E 的窗口默认全透明，跑测试时不影响用电脑。要看窗口就在命令前加 `E2E_HEADED=1`。

## 打包和发布

先把内核拷到 `vendor/`，再打包，产物在 `apps/desktop/release/`。`vendor:kernel` 只拷本机平台和架构的内核，所以一般在目标平台上打；`vendor/` 里没有目标平台的内核时打包会直接失败。

```bash
pnpm vendor:kernel && pnpm --filter @kits/desktop package
```

- 带上 CodeAgent：打包前设 `KITS_CODEAGENT_BIN` 指到 CodeAgent 的可执行文件，`vendor:kernel` 会一起拷进去；不设的话安装包里只有 OpenCode，设置页显示 CodeAgent“未安装”。
- 只想看一眼打出来的应用、不要 dmg / 安装程序：`pnpm --filter @kits/desktop package:dir`。
- Windows 便携版（单个 exe，不用安装）：在 Windows x64 上先跑 `pnpm vendor:kernel`，再跑 `pnpm --filter @kits/desktop package:portable`，产物是 `apps/desktop/release/kits-<版本>-win-x64-portable.exe`。直接用 `node_modules` 里的 Electron，打包不连 GitHub。便携版不做自动更新。
- 发版：版本号和更新日志的规则见 AGENTS.md“版本和发版”。推一个 `v*` 的 tag，`.github/workflows/release.yml` 在 mac（arm64、x64 各一台）和 Windows（x64）上打包，产物挂到一个草稿 release 上。
- 签名：现在 mac 是 ad-hoc 签名，Windows 未签名。证书到位后要的是：
  - mac：Developer ID Application 证书（`.p12`），放进仓库 Secrets 的 `CSC_LINK`（base64）和 `CSC_KEY_PASSWORD`；公证再加 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。`apps/desktop/electron-builder.yml` 里删掉 `mac.identity`，`mac.hardenedRuntime` 和 `mac.notarize` 改成 `true`。
  - Windows：代码签名证书（`.pfx`），同样放 `CSC_LINK` / `CSC_KEY_PASSWORD`（Windows 那台 runner 用）。
- 自动更新：electron-updater 的 generic provider，更新地址是一个静态目录，里面要有 `latest.yml` 和它引用的安装包（`.blockmap` 可选，有了能增量下载）。
  - 默认地址在打包时用 `-c.publish.url=<地址>` 打进安装包；仓库里的 `electron-builder.yml` 是占位地址，等于没配。运行时 `KITS_UPDATE_URL` 优先，其次是 `~/.kits/settings.json` 的 `updateUrl`，写 `"off"` 关掉。
  - 更新说明来自 `CHANGELOG.md` 里这个版本的一节，打包时自动带上。
  - 排查看 `{userData}/logs/updater.log`（Windows 是 `%APPDATA%\kits\logs\updater.log`）。

## 目录

```
apps/desktop       Electron 应用：main / preload / renderer
packages/core      统一配置模型、事件类型、kits 本机 MCP 工具（ask_user / submit_output）
packages/kernel    AgentKernel 接口、OpenCode 系适配器、内核二进制查找
e2e/               Playwright 端到端测试，直接启动 Electron
evals/             评测集（JSONL）和脚本
scripts/           构建辅助脚本
designs/           原型
docs/              文档
.agents/           技能和 Agent 定义
```

## 预览原型和文档

```bash
python3 -m http.server 8765 --directory designs/app
```

```bash
python3 -m http.server 8766 --directory docs
```

然后打开 http://localhost:8765 和 http://localhost:8766/plans/2026-11-dev-plan.html。Claude Code 里可以直接用 `.claude/launch.json` 里的 `app`、`docs` 配置。
