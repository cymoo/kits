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

打安装包前把当前平台的内核二进制拷到 `vendor/`：

```bash
pnpm vendor:kernel && pnpm --filter @kits/desktop package
```

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
