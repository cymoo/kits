# kits

一个本地运行的 AI 测试作业平台：测试设计、用例开发、测试执行、结果分析都在一个工具里完成。

- 开发约定和流程：[AGENTS.md](AGENTS.md)（人和 AI 工具都先读这份）
- 文档：[docs/](docs/README.md) — 当前计划是 [docs/plans/2026-11-dev-plan.html](docs/plans/2026-11-dev-plan.html)
- 原型：[designs/](designs/README.md) — 产品原型在 [designs/app/](designs/app/index.html)

## 环境

- Node 24（版本在 `.node-version`，推荐用 [fnm](https://github.com/Schniz/fnm) 或 Volta 管理；低于 22.16 的 Node 跑不了 `node:sqlite` 相关的测试）
- pnpm 12，用 corepack 启用：`corepack enable`（装不上就 `npm i -g pnpm@12`）
- Windows：clone 前 `git config --global core.symlinks true`，`.claude/skills/` 是软链接

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

## 打包和发布

安装包在本机架构上打（内核二进制按架构来）：先把内核拷到 `vendor/`，再打包，产物在 `apps/desktop/release/`。

```bash
pnpm vendor:kernel && pnpm --filter @kits/desktop package
```

- 带上 CodeAgent：打包前设 `KITS_CODEAGENT_BIN` 指到 CodeAgent 的可执行文件，`vendor:kernel` 会一起拷进去；不设的话安装包里只有 OpenCode，设置页显示 CodeAgent“未安装”。
- 只想看一眼打出来的应用、不要 dmg / 安装程序：`pnpm --filter @kits/desktop package:dir`。
- 发版：推一个 `v*` 的 tag，`.github/workflows/release.yml` 在 mac（arm64、x64 各一台）和 Windows（x64）上打包，产物挂到一个草稿 release 上。
- 签名：现在是未签名包（mac 打开时要右键“打开”，Windows 会有 SmartScreen 提示）。证书到位后要的是：
  - mac：Developer ID Application 证书（`.p12`），放进仓库 Secrets 的 `CSC_LINK`（base64）和 `CSC_KEY_PASSWORD`；公证再加 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`，并把 `apps/desktop/electron-builder.yml` 的 `mac.notarize` 改成 `true`。
  - Windows：代码签名证书（`.pfx`），同样放 `CSC_LINK` / `CSC_KEY_PASSWORD`（Windows 那台 runner 用）。
- 自动更新：electron-updater 的 generic provider。把 release 产物（安装包、`latest*.yml`、`.blockmap`）放到内网一个静态目录，在 `~/.kits/settings.json` 里写 `"updateUrl": "https://…/kits"`（或设环境变量 `KITS_UPDATE_URL`）；没配就不检查。设置 · 通用的“版本与更新”能手动查一次。

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
