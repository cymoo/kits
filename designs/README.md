# 原型

| 目录 | 放什么 |
|---|---|
| `app/` | **产品原型**，当前要实现的样子，只有一份。几个可交互的 HTML 页面，`runtime.js` 是它们的极简运行时。界面改动先改这里。 |
| `explore/<YYYY-MM-DD>-<slug>/` | **探索**，用 `claude-design` 技能画的画板，一个想法一个目录（`explore/2026-11-10-review-table/`）。定稿后并入 `app/`，目录可以删。 |

## app/ 的页面

| 页面 | 内容 |
|---|---|
| `index.html` | 首页：输入任务 |
| `session.html` | 普通会话 |
| `task.html` | 测试任务：测试设计 → 用例开发 → 测试执行 → 结果分析，可全跑或只跑几步；`?task=points`、`?task=smoke`、`?task=refund` 是三个演示状态 |
| `settings.html` | 设置：平台连接、权限、模型、技能、Agent、数据与隐私 |
| `shell.js` | 共用的侧栏和输入框 |

预览：`python3 -m http.server 8765 --directory designs/app`，或 Claude Code 的 `app` 预览配置。

## 规则

- 原型只画必要的状态（空、加载、正常、出错），不堆功能；评审结论写回需求。
- 新页面先在 `explore/` 里画，评审过了再进 `app/`；`app/` 里不留废弃页面。
- `app/` 里的页面统一引 `runtime.js` 和 `shell.js`，侧栏、输入框只在 `shell.js` 里改。
