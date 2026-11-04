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

## 打包和发布

安装包在本机架构上打（内核二进制按架构来）：先把内核拷到 `vendor/`，再打包，产物在 `apps/desktop/release/`。`vendor/` 里没有目标平台的内核时打包会直接失败，所以 Windows 包要在 Windows 上打，不能在 mac 上交叉打。

```bash
pnpm vendor:kernel && pnpm --filter @kits/desktop package
```

- 带上 CodeAgent：打包前设 `KITS_CODEAGENT_BIN` 指到 CodeAgent 的可执行文件，`vendor:kernel` 会一起拷进去；不设的话安装包里只有 OpenCode，设置页显示 CodeAgent“未安装”。
- 只想看一眼打出来的应用、不要 dmg / 安装程序：`pnpm --filter @kits/desktop package:dir`。
- Windows 便携版（单个 exe，双击运行，不用安装）：在 Windows 上先跑 `pnpm vendor:kernel`，再跑 `pnpm --filter @kits/desktop package:portable`，产物是 `apps/desktop/release/kits-<版本>-win-x64-portable.exe`。每次启动都要先解压，比安装版慢；配置和数据不放在 exe 旁边，还是 `%USERPROFILE%\.kits` 和系统的用户数据目录；自动更新只按安装版做，便携版不要配 `updateUrl`。发版流水线不出便携版。
- 发版：推一个 `v*` 的 tag，`.github/workflows/release.yml` 在 mac（arm64、x64 各一台）和 Windows（x64）上打包，产物挂到一个草稿 release 上。
- 签名：现在 mac 是 ad-hoc 签名（没有 Developer ID，从网上下载后 Gatekeeper 会拦，到“系统设置 → 隐私与安全性”点“仍要打开”，或者运行 `xattr -dr com.apple.quarantine /Applications/kits.app`），Windows 未签名（会有 SmartScreen 提示）。证书到位后要的是：
  - mac：Developer ID Application 证书（`.p12`），放进仓库 Secrets 的 `CSC_LINK`（base64）和 `CSC_KEY_PASSWORD`；公证再加 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。`apps/desktop/electron-builder.yml` 里删掉 `mac.identity`，`mac.hardenedRuntime` 和 `mac.notarize` 改成 `true`。
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
