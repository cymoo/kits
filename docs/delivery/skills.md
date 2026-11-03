# 交付说明：skills

## 2026-11-04　设置 · 技能：三级来源、同名覆盖、开关；输入框 / 菜单；三个内置技能

> 日期：2026-11-04　PR：见本分支 `feat/skills-settings`　作者：Claude Code

### 原始需求

phase1-implementation PR13（3.4 节技能、6.3 节 `#skills`）：技能按 Agent Skills 规范（目录 + `SKILL.md`）来，三级来源——内置（随 kits 安装）、个人（`~/.kits/skills`）、项目（`<工作目录>/.agents/skills`），同名时项目覆盖个人覆盖内置。设置页能看到三组、开关、打开目录、同名提示；输入框打 `/` 能选技能；内置 `review` / `explain` / `test` 三个技能。原型 `designs/app/settings.html#skills`、`designs/app/shell.js` 的 `/` 菜单。

做到什么程度算完：设置页列出三组技能，开关写进 `settings.json` 的 `skillsDisabled` 并让内核重启；项目技能在会话里能用；关掉的技能内核里调不了；输入框 `/` 菜单能选并填入。

### 怎么验收

1. 在 `~/.kits/skills/doc-zh/SKILL.md` 写一个技能（frontmatter 里 `name`、`description`），再在某个仓库的 `.agents/skills/api-testing/SKILL.md` 写一个，用这个仓库建过一次会话（设置里最近目录就是它）。
2. 设置 → 技能与记忆：三组卡片——内置（`/code-review`、`/explain`、`/test-plan`，“随 kits 安装”，“查看”打开目录）、项目（路径是 `<仓库>/.agents/skills`，“随仓库走”，最近用过好几个仓库时能切换）、个人（`~/.kits/skills`，“只在这台电脑”）。“打开目录”没有目录时会先建好。
3. 个人目录里再放一个 `explain`：个人组的 `/explain` 标“覆盖了内置的同名技能”，内置组里的 `/explain` 灰掉，标“同名，个人的优先”。
4. 关掉 `/doc-zh`：`settings.json` 里 `skillsDisabled: ["doc-zh"]`，内核按新配置重启；这之后的会话里 Agent 调不了它。
5. 首页输入框打 `/`：弹出“技能”菜单，列出启用的技能（含当前目录的项目技能）；接着打 `test-` 只剩 `/test-plan`，回车填入 `/test-plan `。发 `/test-plan 按需求出一份用例`：会话里的用户消息照原样显示，发给内核的是“使用技能 test-plan：先用 skill 工具加载它，再按里面的说明做。……”。
6. 用真实网关在带 `.agents/skills` 的仓库里发 `/api-testing …`：工作过程里有“使用技能 api-testing”一步。

### 主要改动

- 内核（`packages/kernel`）：
  - `dialects/opencode.ts`：不再设 `OPENCODE_DISABLE_EXTERNAL_SKILLS`。OpenCode 的外部技能发现会从会话目录往上找到仓库根，读项目的 `.agents/skills`；“全局”那份在 `{OPENCODE_TEST_HOME}/.agents/skills`，也就是 kits 的数据目录，不会读到用户家目录里的技能（用 1.19.5 实测：不设这个变量时 `/skill` 接口能列出项目技能）。Claude Code 的配置照旧关着。
  - `generate/opencode-config.ts`：内置和个人技能的目录列进 `skills.paths`；`disabledSkills` 和 OpenCode 自带的 `customize-opencode`（教人改 opencode.json 的）在全局权限里拒绝；`skillDenies()` 给建会话时追加用（会话规则排在全局后面，最后命中的生效）。
- `packages/core`：`skillPrompt()`（`/技能名 …` → 让 Agent 先加载技能）；`SkillView / SkillOverview`；IPC `skills.list / setEnabled / openDir`。
- `apps/desktop/src/main`：
  - `kernel/kernel-config.ts`：`loadSkills(config, builtinDir, workdir?)` 合并三级来源；生成内核配置时只列内置和个人的（项目的由内核自己找）。
  - `index.ts`：`builtinFolder()`（打包后 `resources/builtin`，开发时 `apps/desktop/resources/builtin`），技能 IPC；会话服务拿到 `disabledSkills` 和 `enabledSkills`。
  - `sessions/session-service.ts`：建会话时追加技能拒绝规则；发给内核前按 `skillPrompt` 改写，界面上的用户消息不变。
- `apps/desktop/resources/builtin/skills/`：`code-review`（审改动）、`explain`（讲代码）、`test-plan`（整理测试用例）。方案里叫 `review` / `test`，但 `/review`、`/init` 和 OpenCode 自带的命令重名，所以改成现在的名字。
- `apps/desktop/src/renderer/src/`：`pages/settings/skills/SkillsSection.tsx`（`#skills` 的技能部分）；`shell/Composer.tsx` 的 `/` 菜单（和 `@` 菜单一样按组合框标注，↑↓ ↵ Esc）。
- 原型没画到、按风格补的：被覆盖的技能灰显一行；项目组的工作目录切换；读不了的 `SKILL.md` 报错。原型里每个技能的“本周用了几次”没做（没有统计）。

### 测试

- 单元测试：`kernel-config.test.ts` 补 `loadSkills`（三级合并、同名覆盖、关闭、不给工作目录）；`opencode-config.test.ts` 补技能拒绝（2 个）；`dialects/opencode.test.ts` 改成“不关外部技能”；`skill.test.ts`（`skillPrompt` 2 个）；`session-service.test.ts` 补“`/技能名` 改写、用户消息原样”。
- E2E：`settings-skills.spec.ts`（2 个）：三组列表、同名提示、开关写进 settings.json；输入框 `/` 菜单过滤并填入。

### 新增依赖

无。

### 已知问题

- 项目技能和个人技能同名时，kits 界面上项目的优先，但内核里两份都在（个人的经 `skills.paths`、项目的经外部发现），哪份生效由 OpenCode 决定。建议同名时直接关掉不要的那个。
- `/技能名` 的改写是给模型的一句话，不是 OpenCode 的命令接口：模型通常会照做，但不能保证一定先加载技能。
- “记忆”部分在 PR16。
