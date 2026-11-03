# kits

[kitty](docs/plan-2026-11.html) 的代码仓：一个本地运行的 AI 测试作业平台，测试设计、用例开发、测试执行、结果分析都在一个工具里完成。

- 开发约定和流程：[AGENTS.md](AGENTS.md)（人和 AI 工具都先读这份）
- 开发计划（2026-11）：[docs/plan-2026-11.html](docs/plan-2026-11.html)
- 第一阶段方案：[docs/phase1-plan.md](docs/phase1-plan.md)
- CodeAgent SDK 规格：[docs/codeagent-spec.md](docs/codeagent-spec.md)
- 界面原型：[designs/prototype/index.html](designs/prototype/index.html)

## 预览原型和计划

```bash
python3 -m http.server 8765 --directory designs/prototype
```

```bash
python3 -m http.server 8766 --directory docs
```

然后打开 http://localhost:8765 和 http://localhost:8766/plan-2026-11.html。Claude Code 里也可以直接用 `.claude/launch.json` 里的 `prototype`、`docs` 配置。

工程骨架在第一周搭建，搭好后这里补上安装和运行方式。
