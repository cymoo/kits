# kits

一个本地运行的 AI 测试作业平台：测试设计、用例开发、测试执行、结果分析都在一个工具里完成。

- 开发约定和流程：[AGENTS.md](AGENTS.md)（人和 AI 工具都先读这份）
- 文档：[docs/](docs/README.md) — 当前计划是 [docs/plans/2026-11-dev-plan.html](docs/plans/2026-11-dev-plan.html)
- 原型：[designs/](designs/README.md) — 产品原型在 [designs/app/](designs/app/index.html)

## 预览原型和文档

```bash
python3 -m http.server 8765 --directory designs/app
```

```bash
python3 -m http.server 8766 --directory docs
```

然后打开 http://localhost:8765 和 http://localhost:8766/plans/2026-11-dev-plan.html。Claude Code 里可以直接用 `.claude/launch.json` 里的 `app`、`docs` 配置。

工程骨架在第一周搭建，搭好后这里补上安装和运行方式。
