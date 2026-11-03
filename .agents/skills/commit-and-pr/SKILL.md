---
name: commit-and-pr
description: 提交信息和 PR 描述的约定：Conventional Commits、分支命名、PR 里放什么。提交代码或开 PR 时使用。
---

# 提交和 PR

## 分支

`main` 受保护，不直接推。从 `main` 拉分支：

- `feat/<模块>-<简述>`
- `fix/<模块>-<简述>`
- `docs/<简述>`
- `chore/<简述>`

## 提交信息

[Conventional Commits](https://www.conventionalcommits.org/)，英文，祈使句，首字母小写，不加句号：

```
<type>(<scope>): <subject>

<body，可选，说明为什么这么改；可以写中文>
```

- `type`：`feat`、`fix`、`docs`、`test`、`refactor`、`chore`、`build`、`ci`、`perf`、`style`。
- `scope` 用模块名：`kernel`、`session`、`mcp`、`skills`、`workbench`、`settings`、`storage`、`prototype`、`delivery`。
- 例：`feat(session): stream tool calls into the thread`、`fix(kernel): fall back to polling when session.idle is missing`。
- 不加 AI 工具的署名行（不要 `Co-Authored-By: Claude …` 这类小尾巴）。
- 不提交生成物（`dist/`、`out/`、`coverage/`、`vendor/`）、密钥和本机配置。

## 提交前

```bash
pnpm check
```

lint、typecheck、单测都过再提交。改了主流程还要 `pnpm build && pnpm test:e2e`。

## PR

- 一个 PR 做一件事，对应一份交付说明（`delivery-doc` 技能）。
- PR 标题用提交信息的格式。
- PR 描述：交付说明的链接、验收要点（三五条）、截图（有界面改动时）。
- 至少一人 review，CI 绿了才合，合并用 squash。
