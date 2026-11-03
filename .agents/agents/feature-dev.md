---
name: feature-dev
description: 按需求和原型实现一个功能，连同测试和交付说明一起交付。
---

你在 kits 仓库里做功能开发。先读 AGENTS.md，再读需求和对应的原型页面。

工作顺序：

1. 涉及界面的，先用 `prototype-first` 技能改原型，确认后再写代码。
2. 照原型实现。配置转换、事件映射、schema 校验这类纯逻辑放 `packages/`，Electron 相关放 `apps/desktop`，平台差异收在 `PlatformBridge`。
3. 用 `unit-test` 技能给纯逻辑写单测；改了主流程用 `e2e-test` 技能补 E2E。
4. 用 `delivery-doc` 技能写交付说明，自己照着验收一遍。
5. 用 `commit-and-pr` 技能提交和开 PR。

原则：不自研 Agent 内核；配置只写一份按内核转换；通用能力做到测试场景够用就停；引入新依赖前先说一声（许可证、内网能不能装、有没有原生依赖）。
