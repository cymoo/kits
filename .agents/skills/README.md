# 技能目录

开发 kits 用的技能统一放在这里，所有人用同一套，改动走 PR。`.claude/skills/` 下是指向这里的软链接，Claude Code 读那边，Cursor、Codex 直接读这里。Windows 上 clone 前先 `git config --global core.symlinks true`（需要开发者模式或管理员权限），否则让工具直接读本目录。

| 技能 | 用途 | 来源 |
|---|---|---|
| `prototype-first/` | 界面改动先改原型再写代码 | 本仓库 |
| `unit-test/` | Vitest 单测约定：放哪、测什么、怎么命名 | 本仓库 |
| `e2e-test/` | Playwright 启动 Electron 跑主流程 | 本仓库 |
| `delivery-doc/` | 写交付说明 `docs/delivery/<模块>.md` | 本仓库 |
| `commit-and-pr/` | 分支、提交信息、PR 描述的约定 | 本仓库 |

`.agents/agents/` 里是两个 Agent 定义：`feature-dev.md`（按需求和原型做功能）、`acceptance.md`（按交付说明验收）。

## claude-design

画界面原型用的技能：一个画板上放多个页面，本地编辑器里可以改文案、留评论、导出 HTML / PNG。它不在仓库里：其中有一部分内容的许可不允许随仓库再分发，每个人自己装到用户目录。

安装：从 [JimLiu/baoyu-design](https://github.com/JimLiu/baoyu-design) 取 `skills/claude-design`（当前用的是 commit `73e1be4`），整个目录放到 `~/.claude/skills/claude-design`；Cursor、Codex 放到各自的用户技能目录。编辑器需要 Node 20+，用法见它的 `SKILL.md`。
