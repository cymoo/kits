# 文档

| 目录 | 放什么 | 命名 |
|---|---|---|
| `plans/` | 计划和方案：做什么、为什么、怎么排期 | 有时限的加年月前缀：`2026-11-dev-plan.html`；阶段方案按阶段：`phase1.md` |
| `references/` | 外部资料的本地副本：SDK 规格、接口文档、调研结论 | 按对象命名：`codeagent-sdk.md`，不加日期 |
| `delivery/` | 交付说明，验收的人看这份 | 一个模块一份：`<模块>.md`（`session.md`、`kernel.md`），多次交付在同一份里追加 |
| `decisions/` | 技术决策记录（需要时再建） | `NNNN-<简述>.md`，顺序编号 |

当前文档：

- [plans/2026-11-dev-plan.html](plans/2026-11-dev-plan.html) — 六周开发计划（2026-11-03 → 12-11），当前执行的计划
- [plans/phase1.md](plans/phase1.md) — 第一阶段方案：架构、内核接口、权限模型
- [references/codeagent-sdk.md](references/codeagent-sdk.md) — CodeAgent SDK 规格（HTTP + SSE）
- [delivery/TEMPLATE.md](delivery/TEMPLATE.md) — 交付说明模板
- [delivery/scaffold.md](delivery/scaffold.md) — 工程骨架的交付说明（2026-11-03）

更早的方案（完整平台设计、MVP 方案、OpenCode 评估、API 对比、原型评审）留在 [cymoo/kaise](https://github.com/cymoo/kaise/tree/main/docs)，已被上面的方案取代。

## 规则

- 文件名小写、短横线分隔、英文；文档正文中文。
- 文首写版本、日期、状态（草案 / 评审中 / 已定）。
- 一份文档过时了就删掉或在文首标“已被 X 取代”，不留两份并存。
- 本地预览：`python3 -m http.server 8766 --directory docs`，或 Claude Code 的 `docs` 预览配置。
