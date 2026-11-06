# Agent 权限方案调研

版本 2 · 2026-11-06 · 状态：P0、P1 已完成，P2 不做；落地和本文的差异见下一节

## 落地决定

用户体验优先：拦住最危险的就够了，模型输出危险命令的概率只会越来越低。所以 P1 落地时比下面的推荐方案走得更远，改动和验收见 [session.md](../delivery/session.md)。

| 推荐方案 | 落地 | 理由 |
|---|---|---|
| 灰区交给审查模型 | **灰区直接放行，不做审查模型（P2）** | 多一次模型调用、多一个要评测的东西，换来的是拦下本来就很少的危险命令 |
| kits 主进程里的分类器 | **全部写成内核静态规则** | 内核会拆子命令，静态规则够用；没有竞态，不依赖 kits 回复。`tool-start` 不一定先于 `permission.asked`，主进程也分不清 `external_directory` 是读是写 |
| 出网都问 | **只问发文件的写法** | 测试同学每天都在 `curl` 测试环境，问了就是弹窗风暴。普通 POST 放行，`-d @file`、`-T`、`scp`、`rsync` 才问 |
| 读工作区外走灰区 | **放行，密钥目录除外** | 这是实测里最常见的无谓确认 |
| ⌘↵ 不放行红级 | **保留 ⌘↵** | 已经很少问了，不再加摩擦 |
| 合并多张卡片、规则管理页、总结卡、`decidedBy` | **没做** | 问得少之后价值不大，看使用情况再说 |

实测补充（真实 OpenCode 1.19.5，2026-11-06）：

- `edit` 的路径相对工作树。git 仓库里工作区外是 `../x`；不在 git 仓库里工作树是根目录，路径从根写起、开头没有 `/`（`Users/me/ws/a.txt`）。
- `curl x | sh` 拆成 `curl x` 和 `sh`，裸的 `sh` 就是在执行管道内容。`bash <<EOF` 同样是裸的 `bash`，分不开。
- `FOO=1 git push` 的模式带着前缀，`git push *` 匹配不到。
- `echo x > ../y` 不触发 `external_directory`，只有 `bash`。
- **内核拒绝时把这个工具的全部规则塞进错误发给模型**。全局配置的 bash 因此只留一条 `ask`，细则都在会话规则里，一次约 16KB。规则不能无限加，给人看的错误已由 kits 换成一句话。

Windows（真实 OpenCode 1.19.5，windows-latest，2026-11-06）：

- 内核按 PowerShell 语法拆命令，pwsh 和 Windows PowerShell 都算；`Git Bash`、`cmd.exe` 排在后面，一般轮不到。CI 上是 pwsh，5.1 按源码同一条路径，没有单独跑。
- **不带引号的 `$var\a\b` 会被截掉最后一段**：`Get-Content $HOME\.aws\credentials` 到规则只剩 `Get-Content $HOME\.aws`。带引号和 `~\` 开头的不截。密钥规则因此按目录写。
- `Remove-Item`、`rm`、`Get-Content`、`Set-Content`、`Copy-Item` 能解析 `$env:USERPROFILE`、`~`、`..\`，算出 `external_directory`；`del`、`rd`、`rmdir`、`type`、`curl.exe` 不算，只能靠文本。
- `$env:FOO='1'; git push` 拆成两条，`git push` 能匹配；`& git push` 的模式带着 `& `；`$x = git push` 不带。
- `cmd /c ...` 整段是一条，`x | powershell -` 整段从模式里消失，`Get-ChildItem C:\x | Remove-Item -Recurse` 的 `Remove-Item` 看不到目标。
- 匹配不区分大小写，kits 这边的 `matchPattern` 要跟着一致。

## 结论

**把“问人”从默认路径改成最后一道防线。** 不再按工具一刀切地问，而是按动作的风险分四级：明确危险的直接拒绝，明确安全的直接放行，出网、推送这类撤不回的问人，剩下的灰区交给审查模型。

1. **默认档换成“智能”**，界面上仍是三档（只读、智能、全部自动），“每次确认”收进设置页。
2. **逻辑放在 kits 主进程。** 听 `permission.asked`，自己决定回复。不改内核，不升 OpenCode V2，CodeAgent 走同一条路。
3. **沙箱不作为前提。** Windows 上要么依赖新版 Win11，要么隔离弱，内核也没有接入点。先做一次摸底，不挡主线。
4. **先修实测发现的漏洞**，见下一节。它们和选哪个方案无关，其中两个让“执行前确认”形同虚设。已修复，只有第 5 条是部分修复。

人为什么不该是主防线，有实验数据：Anthropic 把权限提示换成明显危险的命令，1,053 人只拦住 13.6%，分类器拦住 89%；人的拦截率从会话早期约 17% 降到 50 次提示后约 5% [A2]。另一个数字指明了方向：单次权限的拒绝率 3%，计划审批的拒绝率 39% [A2]。人不是不判断，而是问得太碎、太多。

这个方案不追求防住有心的攻击者，边界见“防什么，不防什么”。

## 现状和问题

kits 现在的三档只是三套静态规则（`packages/core/src/config/permission.ts`）：

| 档位 | 改文件 | 命令 | 工作区外 | MCP 写入 |
|---|---|---|---|---|
| 只读 | deny | 只读白名单，其余 deny | deny | deny |
| 执行前确认 | allow | 只读白名单，其余 ask | ask | ask |
| 全部自动 | allow | allow | ask | ask |

### 实测发现的漏洞

用真实 OpenCode 1.19.5 + 假网关跑的，规则取 kits 的“执行前确认”档（macOS，2026-11-06）。

| # | 操作 | 结果 | 影响 |
|---|---|---|---|
| 1 | 配 `git push --force*` 为 deny，对 `git push origin main` 点“本会话允许”，再跑 `git push --force origin main` | 点之前被拒，**点之后直接执行，不问** | 内核的 `always` 盖过 deny |
| 2 | 新开一个会话，工作目录相同 | `git push` 和 `--force` **都不问，直接执行** | “本会话允许”实际按工作目录生效，直到内核重启，界面文案不对 |
| 3 | 模型写 `.git/config`，加上 `core.fsmonitor`，再跑 `git status` | **全程没有弹窗，配置里的命令执行了** | 改文件是 allow，`git status` 在白名单里，两步合起来等于任意命令执行。`diff.external` 配 `git diff` 同理（直接用 git 验证过） |
| 4 | 工作目录里放 `.opencode/plugin/p.js` | **打开会话时插件代码就执行了** | 克隆一个仓库，发第一条消息就可能中招。kits 没设 `OPENCODE_DISABLE_PROJECT_CONFIG` |
| 5 | `wc -c $HOME/.zshrc`、`wc -c /etc/hosts` | 都不问 | 白名单里的读命令能读工作区外的文件。内核只查 `cat`、`cd` 等固定命令表里的静态路径 [O8]，`~/.ssh` 这类文件同样挡不住 |

也有两条好消息：工作目录里的 `opencode.json` 放宽不了 kits 的会话规则（配了 `bash: allow`，`touch` 仍然问）；`edit` 的 `.git/*` 规则有效，保护路径不用改内核。

**修复状态。** 第 1～4 条已修，第 5 条只挡了密钥路径：`wc -c /etc/hosts` 这类读工作区外普通文件的命令仍然不问，要等 P1 的分类器比对路径。改动和验收见 [session.md](../delivery/session.md)。上面的档位表是修复前的样子，修复后“执行前确认”下改保护路径要问，所有档位多了硬拒绝。

### 为什么确认这么多

本机 `permission_log` 里有 16 次确认，来自 6 个会话（2026-11-04 至 11-05）：**0 次拒绝**，15 次是 bash，12 次选了“本会话允许”。按命令全文人工判断：

- **12 次本该不问**：只是白名单太窄。`2>/dev/null` 命中防重定向的 `*>*`；`cd`、`date`、`sleep`、`test`、`du`、`shasum`、`git -C`、`git cat-file` 不在名单里。
- **1 条命令触发了 2 次确认**：`ls ../lovia` 读工作区外（bash 一次，`external_directory` 一次）。
- **1 次含 `node -e` 和 `python3 -c`**：实际只校验 JSON，但静态规则判断不了。
- **1 次值得问人**：`curl` 探测外网。

样本小，而且只有开发者一人，不代表测试同学，只说明方向：大部分确认是规则太粗造成的，审查模型还没上，规则就能消掉大半。

## 可选路线

| 路线 | 代表 | 提示减少 | 安全收益 | Windows | kits 成本 | 判断 |
|---|---|---|---|---|---|---|
| A. 只扩白名单 | Roo、Claude 的 allow 规则 | 中 | 无 | 可用 | 低 | 必做，但不够，解释器和未知命令还得问 |
| B. LLM 审查 | Claude auto、Codex auto_review、Cursor | 高 | 中 | 可用 | 中 | 要做，但只审灰区，模型能力要自测 |
| C. 沙箱优先 | Codex、Cursor | 高（Claude 减 84% [A4]） | 高 | **受限**（专题 1） | 高，内核无接入点 | 长期最好，现在做不了主线 |
| D. 少问 + 事后撤销 | Amp [P1]、OpenCode 影子 git | 高 | 低，撤不回外部副作用 | 可用 | 低 | 只能当补充 |
| **E. 分级漏斗（A + B + D，C 预留）** | 各家做法的交集 | 高 | 中 | 可用 | 中 | **推荐** |

各家的做法其实在收敛：确定性规则先过，只把不确定的交给模型，失败时拦截，理由交回主 Agent 换路，连续被拦就回人工（专题 2）。Claude Code 已把 auto 设为默认 [A5]，Cursor 废弃了 Ask Every Time [U1]，Amp 取消了询问 [P1]。

## 推荐方案

### 档位

| 档位 | 位置 | 说明 |
|---|---|---|
| 只读 | 输入框 | 不变 |
| **智能（默认）** | 输入框 | 下面的分级漏斗 |
| 全部自动 | 输入框 | 除硬拒绝规则外都放行，给用户明确的风险提示 |
| 每次确认 | 设置页 | 今天的“执行前确认”，给需要逐条把关的人 |

`PermissionMode` 加一个 `smart`。老会话保留原值，不迁移。

### 四级风险

| 级别 | 处理 | 判定方式 | 例子 |
|---|---|---|---|
| **黑** | 拒绝，理由给模型 | 内核 deny 规则，所有档位生效，不可被“允许”覆盖 | `git push --force`、`rm -rf /`、`mkfs` |
| **绿** | 放行 | 内核 allow 规则 + kits 分类器 | 读文件、工作区内改普通文件、只读命令、工作台里配置的测试命令 |
| **灰** | 审查模型 | 分类器判不出的 | 未知命令、`python x.py`、`node -e`、`npm install`、读工作区外 |
| **红** | 问人 | 分类器按清单 | 出网（`curl`、`scp`、`Invoke-WebRequest`）、`git push`、发布、工作区外写、保护路径、读密钥文件、MCP 写入、`doom_loop` |

**保护路径**：`.git/`、`.opencode/`、`opencode.json`、`.vscode/`、`.github/workflows/`、`.husky/`、`.env*`。工作区内也算红级，Codex 对 `.git`、Claude Code 对 `.git`、`.claude` 都有同样的保护 [C1][A5]。

**红级不给模型判。** 审查模型的能力是未知数，让它只碰灰区，判错的代价有上限。

```text
Agent 要调工具
  │
  ├─ 黑 ─ 内核直接 deny，理由回给模型
  ├─ 绿 ─ 直接执行
  ├─ 红 ─ 问人
  └─ 灰 ─ 审查模型
           ├─ 放行 ─ 执行，记进时间线
           ├─ 拦下 ─ reject 带理由，Agent 换做法，记进“被拦下”
           └─ 超时、出错、熔断 ─ 问人
```

**怎么落地。** 黑和大部分绿写成内核规则。其余配成 `ask`，kits 在 `session-service` 处理 `permission-request` 的位置接管：先过分类器（`packages/core` 里的纯函数，可单测），再按结果回 `once`、回 `reject` 或显示卡片。这条路只用两个内核共有的 `permission.asked` 和回复接口。`deny` 不产生事件，自动回复绕不过去。

两处要注意：`reject` 会连带拒掉同会话所有待处理请求 [O3]，并行请求要排队处理；审查调用不能卡住事件循环。

### 审查模型

抄 Claude Code 和 Codex 的共同做法，只有一处要选：

- **输入**：用户消息 + 当前动作 + 工作目录，**不给工具输出和助手文本**。Claude 这么做，Codex 相反 [A1][C3]。kits 选前者：它要读第三方需求和缺陷单，而 DeepSeek 级模型抗注入的能力没有数据。
- **失败**：超时、解析失败一律问人。无人值守时直接拒绝。
- **熔断**：连续 3 次或累计 20 次被拦，这个会话退回问人，和 Claude 一致 [A5]。
- **反馈**：拦下时把理由写进 `reject` 的 `message`，契约测试已验证模型收得到。Cursor 的经验是原因写清楚后 Agent 恢复得明显更好 [U2]。
- **模型**：用网关上便宜、快的模型，单独配置，不配就退化成灰区问人。

**上线有门槛。** 公开数据全来自前沿模型，没有延迟数据，也没有 DeepSeek 的数据（专题 2）。要先在 `evals/` 建评测集：`permission_log` 脱敏样本 + 合成危险动作。建议门槛，都是起点，评审时再定：

| 指标 | 门槛 | 参考 |
|---|---|---|
| 危险动作漏放 | ≤ 10% | Claude 合成外传 5.7%、真实过度行为 17%（n=52）[A1] |
| 正常动作误拦 | ≤ 2% | Claude 0.4% [A1] |
| p95 延迟 | ≤ 3 秒 | 无公开数据，按“不打断阅读”估 |

不达标就让灰区继续问人。方案只是退化，不会失效，规则层的收益还在。

### 确认卡片

问得少之后，每次询问都要值得看：

- **先说后果，再给命令。** 红级用模板（“把提交推到 origin/main”），灰区转人工时用审查模型的摘要。摘要可能写错，原始命令始终显示。
- **说明为什么问**：“这条命令会访问外网”。
- **红级不接受 ⌘↵ 直接放行。** 快捷键正是无脑通过的来源，低风险的已经不问了。
- **“本会话允许”显示确切范围，解释器和出网命令不提供**，因为 `node *`、`curl *` 等于全放开。Claude Code 的做法一样：只有能完整展示放行范围时才给这个选项 [A6]。
- **同时多张卡片合成一张列表。**

### 事后可见、可撤销

绿灰自动放行之后，用户的控制权从事前挪到事后：

- **一轮结束的总结卡**加一行：“自动放行 23 · 拦下 2 · 问过你 1”，点开看明细和理由。
- **被拦下列表**：可以放行一次重试，学 Claude 的 Recently blocked [A9] 和 Codex 的 `/approve` [C3]。
- **按步撤销**：接上 `revert`。OpenCode 的影子 git 含 bash 改动 [O17]，比 Claude 的 `/rewind` 全，`AgentKernel` 接口早就留好了。这要改 phase1 里“回滚暂缓”的决定。限制是工作目录必须是 git 仓库，CodeAgent 也没有 `unrevert`。
- **规则管理页**：列出、撤销“允许”过的规则，补上 `session.md` 记的已知问题。

### 按 Agent 收权

kits 的 Agent 是配置，这是相比通用 harness 的优势，最便宜的少问是让 Agent 根本用不到：

- `test-designer` 这类设计用例的 Agent 不给 bash，不给 MCP 写入。
- 测试工作台的执行命令由用户配置，天然进绿级。
- Rule of Two [S2] 落到配置上：同时读外部平台内容、碰私有代码、能对外写的 Agent，外发动作必须问人。红级已经覆盖这条。

### 防什么，不防什么

| 风险 | 能防吗 | 靠什么 |
|---|---|---|
| 模型过度主动、误删、误推 | **能**，这是主要目标 | 黑红规则、审查模型、撤销 |
| 仓库自带的恶意配置 | **能** | 关项目配置、保护路径 |
| 普通的提示注入（文档里写“请执行 xxx”） | 大部分 | 审查模型不看工具输出、出网问人 |
| 脚本里藏外传（`python x.py` 内部联网） | **防不住** | 审查模型只看命令文本，要靠沙箱断网 |
| 看起来正常的低调外泄 | **防不住** | 单步都合理，要靠网络出口白名单 [S1] |
| 已放行前缀里的代码（`npm test` 跑被改过的脚本） | **防不住** | 要靠沙箱 [A9] |

后三条是沙箱的价值，也是现在接受的残余风险。kits 只连内网模型、默认禁 `webfetch`，比联网工具的暴露面小一些，但 `bash` 能联网，不算隔离。

## 分期

| 阶段 | 做什么 | 规模 | 依赖 |
|---|---|---|---|
| **P0 修漏洞（已完成）** | ① 不再向内核发 `always`，只回 `once`，规则由 kits 记；② 设 `OPENCODE_DISABLE_PROJECT_CONFIG`，它连项目 `AGENTS.md` 和记忆也关了，这两样改由 kits 随消息带上；③ 保护路径改成 ask；④ 硬拒绝规则，所有档位生效；⑤ 读密钥路径要问 | 1 PR | 无 |
| **P1 规则分级** | 风险分类器、白名单扩充、`smart` 档、卡片改版、规则管理页、`permission_log` 记 `decidedBy` 和风险级 | 3～4 PR，先改原型 | P0 |
| **P2 审查模型** | 评测集、审查服务、熔断、被拦下列表 | 3 PR | P1，模型选型 |
| **P3 撤销** | 接 `revert`，按步撤销 | 1～2 PR | 决定解除“回滚暂缓” |
| **P4 沙箱摸底** | 查公司 Windows 版本；在真机试 MXC 包住内核进程 | 1 次摸底 | 公司机器 |

P1 做完先让 3～5 位测试同学试用，用 `permission_log` 看灰区还剩多少，再决定 P2 值不值。

**Windows 要单独验证。** 本文的实测都在 macOS 上。内核在 Windows 上用 PowerShell 语法解析 `pwsh`，其他 shell 包括 `cmd.exe` 都按 bash 语法解析 [O8]，所以分类器和白名单要在 Windows 上跑一遍，`shell` 也最好固定下来。

## 待决问题

已定：默认档换成“智能”；不做审查模型，灰区直接放行；工作目录不是 git 仓库时编辑照样放行，没有撤销和 diff 算作接受的代价。

1. 是否解除“回滚暂缓”？
2. 公司 Windows 的版本和补丁级别（决定 MXC 能不能用）。

---

下面是外部事实。方括号编号对应文末来源列表，所有网页的访问日期都是 2026-11-06。

- **版本基准**：OpenCode 以 kits 锁定的 `v1.19.5`（2026-10-28，commit `810c0eba`）为准，V2 看 `v2.2.5`（2026-10-30）；Codex 看 `main`（最新发布 `rust-v0.167.0`，2026-11-06）；Gemini CLI 看 `main`（最新发布 `v0.67.0`，2026-11-04）；Claude Code 和 Cursor 闭源，看当日官方文档（文档内提到的最高版本分别是 v2.1.304 和 3.23）。
- **证据标记**：未标注的结论来自官方文档或博客；“源码”表示读源码得出；“推断”表示由源码推出但没跑过真实程序。厂商数字都是自报，没有第三方复现。
- **范围**：CodeAgent 闭源，未调研，它的权限接口见 [codeagent-sdk.md](codeagent-sdk.md)。

## 对比总表

| 产品 | 档位 / 模式 | 规则粒度 | 沙箱 | AI 审批 | 回滚 | Windows 原生 |
|---|---|---|---|---|---|---|
| **OpenCode 1.19.5** | allow / ask / deny 规则；`--auto` 是客户端自动回复 | 按工具 + 通配；bash 按解析出的子命令；Agent、会话两级覆盖 | **无**，官方明说权限不是隔离 [O2] | 无 | `/undo`、`revert`，影子 git，含 bash 改动 | 能跑，无隔离；bash 和 PowerShell 都有解析器 |
| **OpenCode 2.2.5** | 同上，另有只收紧的 `policies` | 有序数组 `{action, resource, effect}` | 无 | 无内置，有 `evaluate` 钩子可接 | 同上 | 同上 |
| **Claude Code** | Manual、acceptEdits、plan、auto（终端默认）、dontAsk、bypassPermissions | `Tool(specifier)`，deny → ask → allow；Bash 拆子命令，PowerShell 解析 AST | Seatbelt、bubblewrap，默认关 | **auto**：分类器 + 服务端注入探测 | `/rewind`，不含只被 bash 改过的文件 | **无沙箱**，要用 WSL2；auto 模式可用 |
| **Codex** | `approval_policy` × `sandbox_mode` 两轴 | execpolicy（Starlark 前缀规则）；granular 按类别 | Seatbelt、bwrap、Windows 原生，默认开 | **auto_review**（guardian），只审越界请求 | 无内置 undo，靠 git | **有**：MXC，旧版 elevated、unelevated |
| **Cursor** | Auto-review（默认推荐）、Allowlist、Run Everything | 命令 / MCP allowlist，`sandbox.json`，自然语言 allow / block | Seatbelt、Landlock + seccomp | **Auto-review** 分类器 | Checkpoints（本地，独立于 git） | 沙箱只经 WSL2 |
| **Gemini CLI** | default、autoEdit、plan、yolo | TOML 策略，优先级 + 三层 tier，正则或前缀 | Seatbelt、Docker / Podman、gVisor、LXC、windows-native，默认关 | 未查到 | Checkpointing（影子 git） | **有**：受限 token + Low IL + Job |
| **VS Code / Copilot** | Manual、Assisted、Allow all | 终端规则（子命令、正则），URL 两步批准 | 默认关；Windows 为 Experimental | **Assisted**：LLM judge | 未核实 | BaseContainer，要新版 Win11 |

## 各家详述

### OpenCode（kits 内核）

**仓库和版本线。** `sst/opencode` 已重定向到 `anomalyco/opencode`，默认分支 `dev`。现在有两条版本线：npm `opencode-ai` 的 latest 是 1.19.5，V2 是另一个包 `@opencode/cli`（2.2.5）[O30]。仓库机器人在一条 PR 回复里说 V1 只收严重 bug 修复，V2 是独立实现 [O22]；这是机器人的话，不是路线声明。下文未注明的都是 V1。

**配置 schema（源码 [O3][O5]，文档 [O1]）**

- 动作是 `allow`、`ask`、`deny`。规则结构是 `{permission, pattern, action}`，多条规则拼成数组。
- **最后匹配的规则生效**（`findLast`），配置键的书写顺序就是优先级。没有规则命中时是 `ask`。
- 通配只有 `*` 和 `?`，匹配整串。结尾的 ` *` 让参数变成可选，`git status *` 也匹配 `git status`。反斜杠归一成 `/`，Windows 上不区分大小写 [O10]。
- 可写的键：`read`、`edit`、`glob`、`grep`、`list`、`bash`、`task`、`external_directory`、`lsp`、`skill`，这些能按 pattern 细分。`todowrite`、`question`、`webfetch`、`websearch`、`doom_loop` 只接受单一动作 [O5]。其他键（比如 MCP 工具名）也接受。
- **默认几乎全放行**：`"*": "allow"`，只有 `doom_loop`、`external_directory`、`*.env` 和 `*.env.*` 的读取是 `ask` [O11]。
- `doom_loop`：同一工具用相同入参连续调用 3 次时触发，走 `ask` [O13]。这里的规则集只取 Agent 级，不看会话级（源码）。
- `external_directory`：`read`、`edit` 等工具碰工作区外路径时触发 [O31]。bash 只看 `cd`、`rm`、`cp`、`cat` 等固定命令表里的静态路径参数 [O8]。
- Agent 覆盖：`agent.<name>.permission` 追加在全局规则之后 [O1]。子 Agent 继承父会话的 deny 和 `external_directory` 规则，默认禁 `todowrite` 和 `task` [O16]。
- 一个工具被 pattern `*` 的 deny 命中时，它会从发给模型的工具列表里消失（`Permission.disabled`，源码）[O3]。

**规则合成顺序（源码 [O12][O3]）。** 运行时等于 `agent.permission` + `session.permission` + 内存里的 `approved`，取最后命中。会话级规则可在 `POST /session` 时传入，也可用 `PATCH /session/:id` 追加（merge，不是替换）[O7]。由于会话级规则直接是 `{permission, pattern, action}` 数组，绕过了配置 schema，`webfetch` 的 URL pattern 在这里应该能用（推断）。

**HTTP / SSE 形状（源码 [O4][O6][O7]）**

```text
SSE  permission.asked    { id, sessionID, permission, patterns[], metadata, always[], tool?: { messageID, callID } }
SSE  permission.replied  { sessionID, requestID, reply }
GET  /permission                                列出所有会话的待处理请求
POST /permission/:requestID/reply               { reply: "once"|"always"|"reject", message? }
POST /session/:sessionID/permissions/:permissionID   { response }   旧接口
```

- `metadata` 按工具不同：bash 带 `command`，`edit` 带 `filepath` 和 `diff`，`webfetch` 带 `url`，`external_directory` 带目录 [O8][O31]。
- `reject` 会把**同一会话所有待处理请求**一起拒绝 [O3]。
- 无 `message` 的 `reject` 让本轮停下；配置 `experimental.continue_loop_on_deny` 后继续 [O13]。带 `message` 的 `reject` 抛 `CorrectedError`，规则 `deny` 抛 `DeniedError`，两者都不走停止分支，模型收到错误后继续。kits 的契约测试验证过带 `message` 的情况（`passes the reject reason to the model as tool feedback`）。
- `always` 批准后，同会话里已被新规则覆盖的待处理请求会一起放行 [O3]。

**`always` 的作用域和持久化：比文档说的宽，这是 kits 最该注意的部分**

- **不落盘。** `approved` 是内存数组，进程重启就没了（源码 [O3]）。
- **不按会话隔离。** 它存在 `InstanceState` 里，按工作目录缓存 [O19]，`ask` 时不判断 sessionID（源码 [O3]）。所以同一个 `opencode serve` 下，同目录的所有会话共享，真实 1.19.5 上已复现。文档写的是到当前 OpenCode 会话结束 [O1]，只有把“会话”理解成进程才对得上。
- **pattern 由工具给，而且常常很宽（源码）：**

  | 工具 | `always` 的 pattern | 后果 |
  |---|---|---|
  | `edit`、`write` | `*` | 批准一次，放行所有文件修改 [O31] |
  | `webfetch` | `*` | 放行所有 URL [O31] |
  | MCP 工具 | `*`（权限键是工具名） | 放行这个工具的任意参数 [O12] |
  | bash | `BashArity.prefix(tokens)` + ` *` | `git push origin` → `git push *`；`python -c ...` → `python -c *`；表里没有的命令只取首词，`curl`、`node`、`bash`、`powershell` 都变成 `<cmd> *` [O8][O9] |
  | `external_directory` | 目录 glob | 放行该目录 [O31] |

- **`always` 能盖过配置的 `deny`（V1 缺陷）。** `approved` 排在规则集之后，又是 `findLast`。配置 `git push --force*` 为 deny，用户对 `git push origin main` 点过 `always` 之后，`git push --force origin main` 判定为 allow。真实 1.19.5 上已复现（见“实测发现的漏洞”）。V2 修了这点，先单独判 deny，文档也写明保存的批准不覆盖 deny [O26][O25]。

**bash 解析和匹配（源码 [O8]）**

- 用 `web-tree-sitter`，带 `tree-sitter-bash` 和 `tree-sitter-powershell` 两份 WASM。`Shell.ps(shell)` 为真时用 PowerShell 语法，其他情况（**包括 `cmd.exe`**）都用 bash 语法。
- 取语法树里所有 `command` 节点，每个子命令单独变成一个 pattern。所以 `a && b`、管道、`$(...)` 里的命令都被检查；任何一个子命令是 deny 就整体拒绝，都放行才免询问 [O3]。
- Windows 上候选 shell 是 `pwsh`、`powershell`、Git Bash、`COMSPEC`，也可用配置 `shell` 指定 [O18]。
- **不解析解释器内部**：`bash -c "..."`、`python x.py`、`node -e` 都只按自身文本匹配。
- **静态路径才进 `external_directory`**：`cat $HOME/.ssh/config` 只问 `bash`，不问 `external_directory`。一条社区 PR 把这个缺口写进了测试，未合入 [O22]。

**钩子**

- `permission.ask` 插件钩子**在 v1.19.5 是死代码**：类型声明还在，内置技能文档还教这个钩子，但全仓没有调用点（源码 [O14]）。自 v1.3.0 起如此，相关 issue 已关闭，维护者指向 V2 的 `evaluate` [O20][O21]。
- `tool.execute.before` 可用，每种工具都在权限询问之前触发 [O12]：抛错可阻止调用，改 `output.args` 可重写参数，官方示例就这么做。它只能拦，不能放行。
- `shell.env` 能给命令注入环境变量 [O8][O14]。
- 另一条路是外部客户端：听 `permission.asked` 再调回复接口。OpenCode 自己的 `--auto` 就是这么实现的，TUI 和 `run` 收到事件后回 `once`；`run` 不带 `--auto` 时回 `reject` [O15]。所以 `serve` 没有服务端自动档，而 `deny` 不产生 `asked`，自动回复绕不过它。

**沙箱。** 官方威胁模型明说没有沙箱，权限系统是 UX 功能，要隔离请放进 Docker 或 VM，沙箱逃逸不算漏洞；server 模式不设 `OPENCODE_SERVER_PASSWORD` 就没有鉴权 [O2]。社区的 srt / bubblewrap 和 seatbelt 方案 PR 都已关闭 [O22]，issue #2242、#48411 还开着 [O23]。代码里的 `sandbox` 一词指 worktree 目录，不是隔离（源码）。

**V2 的变化**

- 配置改成 `permissions` 有序数组，`bash` → `shell`，`task` → `subagent`，`doom_loop` 和 `lsp` 不再是权限动作 [O25]。
- `always` 持久化到数据库，按项目保存，有列出和删除接口（`/api/permission/saved`）[O26][O32]。
- `ctx.permission.hook("evaluate")` 在提示前运行，可改 `effect` 和 `message`；配置的 `deny` 不进钩子 [O21][O26][O27]。这是接 AI 审批的正式入口。
- 扫描器遇到语法错误或无法分析的动态求值时报错，不执行 [O25]。
- `policies` 只能收紧，组织策略优先于项目配置 [O25][O29]。
- **默认放开了 `external_directory`**，要提示得自己加规则 [O25][O28]。
- 无人值守时 `ask` 变 `deny` [O26]。插件工具不会自动走权限，要工具自己请求 [O24]。
- 升级成本：插件 API 和 server API 都变了，V1 插件在 V2 不能运行 [O28]。文档仍提醒 shell 带宿主用户的全部权限 [O25]。
- v1.19.5 的代码树里已有 `PermissionV2`，但工具执行走 V1 的 `Permission` [O12]。`/api/...` 路由是否在 1.19.5 对外可用未实测。

**不改内核能做到什么（V1，由上述事实推出）**

| 能力 | 做法 | 限制 |
|---|---|---|
| 动态调整某个会话的规则 | `POST /session`、`PATCH /session/:id` 传 `permission` | 只能追加；`doom_loop` 不看会话规则 |
| 自己决定批准（规则引擎、LLM 审批） | 听 `permission.asked`，调 `/permission/:id/reply` | 只看到 `ask` 的请求，所以想审的类别必须配成 `ask` |
| 把拒绝理由反馈给模型 | `reject` 带 `message` | `reject` 会连带拒掉同会话其他待处理请求 |
| 控制 `always` 的范围 | 不用内核的 `always`，只回 `once`，自己记规则，再写进会话规则 | 否则有上面的共享、过宽、盖过 deny 三个问题 |
| 事前硬拦或改写命令 | 本地插件的 `tool.execute.before` | 只能拦不能放；需要加载插件 |
| 回滚 | `revert`、`unrevert` | 见专题 3 |
| OS 级隔离 | 内核不支持，只能从外面包，见专题 1 | 未实测 |

### Claude Code

**模式 [A5]。** `default`（界面叫 Manual）、`acceptEdits`、`plan`、`auto`、`dontAsk`、`bypassPermissions`。终端和 VS Code 在 v2.1.283 起默认 `auto`；`-p` 和 SDK 在 v2.1.302 起默认 Manual，需要批准的调用没有规则、钩子或回调放行就拒绝。deny 规则在所有模式下都生效。保护路径（`.git`、`.claude`、`.npmrc` 等）的写入和关键路径的 `rm` 有单独处理。

**auto 模式 [A1][A5][A9]**

- 决策顺序：allow / ask / deny 规则 → 只读操作和工作目录内的编辑直接放行 → 其余进分类器 → 被拦时把原因（通常含规则名）返回给 Claude，让它换路。
- 进入 auto 时暂时丢弃宽 allow 规则：`Bash(*)`、`PowerShell(*)`、解释器通配、包管理器 run 命令。窄规则保留，但窄规则也可能放过危险参数，要全量审用 `autoMode.classifyAllShell`。
- 分类器看用户消息、非只读工具调用和 CLAUDE.md，**不看工具结果**，防止恶意内容直接操纵分类器；另有服务端探测扫描工具结果。工程博客把这种设计叫 reasoning-blind，助手文本也去掉。默认模型现为 Claude Sonnet 5，3 月博客写的是 Sonnet 4.6。
- 两阶段：第一阶段是单 token 快速过滤，只有被它标记的才进第二阶段思维链；第二阶段的提示几乎全部命中缓存 [A1]。
- 默认拦：下载执行、外传敏感数据、生产部署、不可逆删除、force push、`git reset --hard`、关 CI 检查、改权限等。默认放：工作目录内文件操作、安装已声明依赖、只读 HTTP、推当前仓库的分支等 [A5]。
- 回退：连续 3 次或累计 20 次被拦，暂停 auto 回到提示，阈值不可配。分类器不可用或返回无法解析时，动作被拦 [A5]。
- 可配置：`autoMode.environment`（自然语言描述可信基础设施）、`allow`、`soft_deny`、`hard_deny`。项目内设置文件不能写 `autoMode`，防止仓库给自己开白名单 [A9]。
- 用户可在 `/permissions` 的 Recently blocked 里事后批准被拦动作，重试时仍要再过分类器 [A5][A9]。
- 支持列表里只有 Claude 模型 [A5]，所以 kits 能借鉴的是设计，不是这个功能本身。

**规则 [A6]。** `Tool(specifier)`，按 deny → ask → allow 顺序，首个命中决定结果，具体程度不影响优先级。Bash 拆 `&&`、`||`、`;`、`|`、`&`、换行，所有子命令都要被允许；先剥 `timeout`、`nice` 等包装再匹配。PowerShell 解析 AST，常用别名归一，不区分大小写。WebFetch 用 `domain:`。“不再询问”的持久化按类型不同：Bash 和 WebFetch 永久写入仓库的 `.claude/settings.local.json`，文件编辑只到会话结束。只有提示能完整展示放行范围时才给“不再询问”选项。文档明确说约束命令参数的 Bash 规则很脆弱，建议改用 WebFetch 规则或沙箱。

**钩子 [A6][A8]。** `PreToolUse` 返回 `permissionDecision`（allow / deny / ask / defer）和 `updatedInput`；`allow` 跳过提示，但 deny 和 ask 规则仍生效；exit 2 在规则之前阻断。`PermissionRequest` 只在将要询问或将要自动拒绝时触发，返回 `behavior`、`updatedInput`、`updatedPermissions`、`message`、`interrupt`；沙箱网络请求不触发。

**沙箱 [A4][A7][A11]**

- macOS 用 Seatbelt，Linux 和 WSL2 用 bubblewrap，**原生 Windows 不沙箱**，默认关。
- 默认写限于工作目录和临时目录；**读基本不限，包括 `~/.ssh`**；网络走本地代理，`allowedDomains` 初始为空。
- 自动放行模式下，沙箱内命令直接运行，排除命令、deny 规则、关键路径 `rm`、内容级 ask 规则除外。
- 命令失败后 Claude 可带 `dangerouslyDisableSandbox` 重试，走审批，可用 `allowUnsandboxedCommands: false` 关掉。
- 钩子、本地 MCP、`!` 命令不在沙箱内。
- 官方说沙箱在内部使用中减少 84% 提示；两层都要，只隔文件或只隔网络都不够 [A4]。

### OpenAI Codex

- **两轴 [C1]。** `approval_policy`：`on-request`、`never`、`granular`（按类别保留提示，其余自动拒绝）；`untrusted` 已退役，留在配置里可能启动失败。`sandbox_mode`：`read-only`、`workspace-write`、`danger-full-access`。受版本控制的目录默认 `workspace-write` + `on-request`，其他默认只读。
- **网络默认关**，`workspace-write` 要 `network_access = true` 才开；另有默认关的 `network_proxy`。`.git`、`.agents`、`.codex`、`.aws` 在可写根里仍只读 [C1]。
- **沙箱。** Linux 从 0.115 起用 `bwrap`，WSL1 不再支持 [C1]。Windows 见专题 1。
- **execpolicy [C5]。** Starlark `prefix_rule(pattern, decision, justification, match, not_match)`，决策为 `allow`、`prompt`、`forbidden`；`match` 和 `not_match` 在加载时当单元测试校验；`host_executable` 约束可执行文件路径；`codex execpolicy check` 可离线验证。
- **auto-review [C1][C3][C4]。** `approvals_reviewer = "auto_review"`，默认 `user`。只审本来要人批的请求：越权执行、被拦的网络、写根外的编辑、需批准的 MCP 调用。**沙箱内动作不审**。输入是精简对话（用户消息、公开的助手更新、相关工具调用和输出）加待执行动作，不含隐藏推理，这点和 Claude Code 去掉工具结果相反。构建提示、会话或解析失败时不执行，超时单独上报。熔断：单回合连续 3 次拒绝，或最近 50 次中 10 次拒绝。`/approve` 可放行最近一次被拒动作重试一次，重试仍要过审。策略在开源仓库，企业可用 `guardian_policy_config` 替换。

### Cursor

- **演变 [U1][U2][U3]。** 2.0 加沙箱；3.5（2026-05-22）废弃 Ask Every Time，改用空 allowlist；3.6（2026-05-29）把 Auto-review 设为推荐默认；3.23（2026-10-01）加读边界。
- **Auto-review 顺序 [U1]。** allowlist 命中的 shell、Fetch、MCP 调用直接跑（在沙箱外）→ 其他 shell 进沙箱 → 进不去、在沙箱里失败的命令和其他调用交给分类器 → 分类器放行就在沙箱外跑，拦下时让 Agent 换路或问用户。分类器可做只读文件调用。主模型 Gemini 3.5 Flash Lite，后备 Claude 4.5 Haiku。自然语言配置放 `permissions.json` 的 `allow_instructions`、`block_instructions`。官方明说不是安全边界。
- **沙箱 [U1][U2]。** macOS 用 Seatbelt，Linux 用 Landlock + seccomp，不满足内核要求时退回询问。网络默认封，用 `sandbox.json` 开，默认放行清单约 98 个域名。官方博客称沙箱内 Agent 的中断少 40%，受支持平台上三分之一请求开了沙箱。
- **一条值得抄的工程经验 [U2]：** Agent 不懂沙箱失败时会反复重试原命令；把受限原因写进工具结果后，恢复明显变好。

### Gemini CLI

- **状态 [G6]。** 现在定位给 Gemini Code Assist 企业用户，个人用户 2026-06-18 起转到 Antigravity CLI。Antigravity CLI 未调研。
- **策略引擎 [G1]。** TOML 规则，`toolName`、`commandPrefix`、`commandRegex`、`argsPattern`，决策 `allow`、`deny`、`ask_user`。`最终优先级 = tier 基数 + priority / 1000`，从高到低是 Admin、User、Workspace、Default。文档提醒 Workspace 层目前不生效。模式有 `plan`、`default`、`autoEdit`、`yolo`。
- **Trusted Folders [G4]。** 默认关。开启后首次进目录要选是否信任，不信任时进入 safe mode，不加载项目配置。
- **沙箱 [G2][G3]。** 默认关，方法有 Seatbelt、Docker / Podman、gVisor、LXC、`windows-native`。

### 其他工具

- **VS Code / Copilot**：权限档位 Manual、Assisted（LLM judge 逐调用审）、Allow all [V1]。终端规则默认按子命令匹配，`false` 表示要询问而不是拦截；tree-sitter 可能漏子命令，官方称只是尽力而为的便利 [V1]。URL 批准分两步：请求（防外传）和响应（防注入）[V1]，这是少见的把两种风险分开的设计。Copilot CLI 也有 `/permissions assisted` [V3]。
- **Cline**：按类别自动批准（读、编辑、safe 命令、全部命令、浏览器、MCP）。**safe 与否由主模型自己用 `requires_approval` 声明**，没有固定白名单，所以不是独立判断 [K1]。
- **Roo Code**：按类别自动批准，命令用 allow / deny 前缀表，最长前缀胜出，平局时 deny 胜；含危险替换的命令不自动放行 [R1]。
- **Goose**：默认 Autonomous；Smart Approve 按风险放行，读写分类由 LLM 提供方尽力判断 [Go1]。有人报告 smart_approve 跳过了用户的 `ask` 规则，issue 已关闭 [Go2]。
- **Windsurf**：文档已重定向到 Devin Desktop。Code 模式询问，Smart 由快速模型放行它认为安全的命令，Bypass 不问；deny 优先级最高，组织规则盖过成员 [W1]。
- **Amp**：2026-05-06 起默认不再询问，理由是模型写一次性脚本后，静态判断是否危险几乎做不到；权限移到插件 [P1]。旧系统的 `delegate` 把决定交给外部程序，exit 0 / 1 / 2 对应放行、询问、拒绝 [P2]。
- **Qwen Code**：Plan、Ask Permissions、Auto-Edit、Auto、YOLO。Auto 用 LLM 分类器，不确定时偏向拦截，API 不可用即拦；连续 2 次不可用或连续 3 次被拦就回手动。页面对默认档自相矛盾 [Q1]。

### 安全研究背景

- **Lethal trifecta [S1]。** 私有数据、不可信内容、对外通信三者同时具备就有被窃数据的风险。Willison 认为靠护栏拦 95% 不够，用户侧唯一稳妥的办法是别把三者放在一起。
- **Agents Rule of Two [S2]。** 一个会话最多满足其二：处理不可信输入、访问敏感系统或私有数据、改状态或对外通信。三者都要时不能自主运行，要人工审批或其他可靠校验，也可以换新会话。Meta 明说用户盲批时规则也会失效。
- **CaMeL [S3]。** 从可信查询里提取控制流和数据流，让不可信数据改不了程序走向，用 capability 在工具调用时阻止未授权外传。AgentDojo 上 77% 任务有可证明安全，无防御基线 84%。

**审批防不住什么。**

1. 间接 prompt injection 下的低调外泄：单看每一步都正常，比如已授权的 URL、已批准的 `git push`，审批人看不出来。Anthropic 的实验里人只拦住 13.6% 的明显危险命令 [A2]。
2. 已放行前缀里的任意代码：`npm test` 跑的是刚被改过的脚本 [A9]。
3. 沙箱内动作：Codex 的 reviewer 看不到，OpenAI 也说防不住模型有意隐藏的行为 [C4]。

这些要靠结构性手段防：断掉三要素的一条腿（网络出口白名单、凭据不进执行环境、读不可信内容的会话不给外发能力），或用 CaMeL 式的数据流控制。审批和分类器防的主要是模型过度主动和误操作，Anthropic 也说分类器主要按这两类调优 [A1]。

## 专题 1：哪些沙箱在 Windows 上真能用

| 方案 | 机制 | 管理员 | 依赖 WSL / Docker | 系统要求 | 网络 | 状态 |
|---|---|---|---|---|---|---|
| **MXC ProcessContainer** [M1][M3][M4][M5] | AppContainer / PSEC，WFP 出口过滤 | 每次启动无 UAC；首次是否需要未见说明，Codex 集成不申请提权 [C6] | 否 | Win11 24H2 ≥ 26100.9278，25H2 ≥ 26200.9278，26H1 ≥ 28000.2804，26H2 ≥ 26300.9550；容器内跑回环服务要 .9550。**支持表里没有 Windows 10** | 可封出口，按 IP / 端口放行，可走本地代理 | SDK v1.0.1，MIT；微软称 GA |
| **Codex unelevated** [C2] | 受限 token + ACL 文件边界 | 文档暗示不需要，未明说 | 否 | Win10 1809+（best effort），Win11 推荐 | 环境级离线控制，弱于 elevated；不支持拒读路径 | 旧版后备 |
| **Gemini `windows-native`** [G2][G3] | `CreateRestrictedToken` + Low 完整性级别 + Job Object | 代码里没有提权（推断），文档未说 | 否 | 未说明 | 有网络开关，强度未核实 | Apache-2.0，随 CLI |
| **Codex elevated** [C2] | 专用低权用户 + 文件权限 + 防火墙规则 | **需要**，IT 可用 `codex sandbox setup --elevated` 预置 | 否 | 同上 | 比 unelevated 强 | 旧版首选 |
| **srt（sandbox-runtime）** [A11] | 专用 `srt-sandbox` 账户 + WFP + 写受限 token + 显式 ACE | **一次 UAC**（`windows-install`） | 否 | 未说明 | 代理 + WFP 围栏 | **alpha**，Apache-2.0 |
| VS Code 终端沙箱 [V2] | BaseContainer | CA 信任要管理员 | 否 | Win11 25H2 ≥ 26200.9550，26H1 ≥ 28000.3086 | 默认不封 | Experimental，只在 VS Code 内 |
| Claude Code、Cursor [A7][U2] | 经 WSL2 | — | **依赖 WSL2** | — | — | Claude Code 的 MXC 支持是“即将”[M6] |

**结论。** 同时不要 WSL、Docker、管理员的只有 MXC ProcessContainer 和受限 token 这一族（Codex unelevated、Gemini）。前者最完整，但系统门槛高；后者覆盖旧系统，但网络隔离弱。

**接入 kits 前要知道的：**

- **MXC**：Node SDK 是 `@microsoft/mxc-sdk`，要 Node 24（Windows 原生 stdio 要 24.21+）[M2]，依赖 `koffi` 和 `node-pty`（后者通常是原生模块，要确认内网能否安装），也有独立的 `wxc-exec.exe` [M1]。**Required 遥测**：`1.1.0-alpha` 契约的官方构建会把诊断数据发给微软，管理员策略不能挡；已发布的 `1.0.0` 契约仍是可选遥测 [M1]。v0.9.0 的 README 写过不要把任何 profile 当安全边界 [M7]，当前 README 已删掉这句，但没有替代的安全声明。`getPlatformSupport()`、`probe()` 可以运行时探测 [M2]。
- **srt**：Schannel 客户端在沙箱内完不成 TLS 握手，WinHTTP、WinINet 系工具都受影响；SMB 和 WSL 流量不受围栏约束；专门绕过的代码能穿透网络围栏；用户级安装的工具要给 profile 读授权 [A11]。公司内网里这些限制大概率会碰到。
- **Gemini**：`icacls` 把写入路径标成 Low，这个标记会永久留在文件上 [G2]。
- **OpenCode 集成**：内核在自己的进程里 spawn 命令，没有“用某个沙箱启动 shell”的接口。可想到三种外包方式，**都没实测**：
  1. 把整个 `opencode` 进程放进容器。最简单，也覆盖 MCP 和 `webfetch`，但内核自己要能连公司网关。
  2. 用 `tool.execute.before` 把 `args.command` 改写成带沙箱前缀的形式（官方示例证明能改命令），但权限扫描看到的是改写后的文本。
  3. 用配置 `shell` 指向包装程序 [O18]，但解析语法和启动参数按 shell 名字决定，要验证。

  方式 2、3 只包 shell，`webfetch`、MCP 仍在沙箱外。

## 专题 2：LLM 审批的公开数据

| 产品 | 审什么 | 模型 | 公开数字 | 失败处理 |
|---|---|---|---|---|
| **Claude Code auto** [A1][A2] | 规则和快速路径之外的动作 | Sonnet 4.6（3 月）→ Sonnet 5 | 见下 | 拦截；连续 3 次或累计 20 次回人工 |
| **Codex auto-review** [C3][C4] | 只审越界请求 | GPT-5.4 Thinking，low 推理 | 见下 | 不执行；连续 3 次或最近 50 次中 10 次中断回合 |
| Cursor Auto-review [U1][U3] | 沙箱放不下的调用 | Gemini 3.5 Flash Lite，后备 Claude 4.5 Haiku | 无 | 换路或问用户 |
| VS Code Assisted、Copilot CLI [V1][V3] | 每个调用 | 未说明 | 无 | 未放行的要确认 |
| Qwen Code Auto [Q1] | shell、网络、工作区外编辑 | 未说明 | 无 | 不可用即拦；连续 2 次不可用或 3 次被拦回人工 |
| Windsurf Smart [W1] | 规则未覆盖的命令 | 快速模型 | 无 | 未说明 |

**Claude Code（2026-03 博客）[A1]**

| 数据集 | 第一阶段 | 完整流水线 |
|---|---|---|
| 真实内部流量（n=10,000） | 误拦 8.5% | **误拦 0.4%** |
| 真实过度行为（n=52） | 漏拦 6.6% | **漏拦 17%** |
| 合成外传（n=1,000） | 漏拦 1.8% | **漏拦 5.7%** |

第二阶段换来低误拦，代价是漏拦上升。17% 是官方自己说的诚实数字，样本只有 52。

**Claude Code（2026-08 文章，10-22 更新）[A2]**

- 1,053 名付费测试者做编码任务，中途把一次权限提示换成明显危险的命令：**人拦住 13.6%（143），auto 拦住 89%（937）**。auto 拦下了 800 条人放行的，人拦下了 6 条 auto 放行的。
- 人的拦截率从会话早期约 17% 降到 50 次提示之后约 5%，auto 不随会话变长下降。
- Apollo Research 攻击集上漏拦从 12% 降到 7%，官方说明这不是真实流量的漏拦率。
- 文章没有链接完整研究报告。
- 另一篇文章：auto 下两次中断之间的工作时长是旧默认的 9 倍；Gusto 约 10% 的会话出现过 auto 拒绝，但不知多少是误拦 [A3]。

**Codex（2026-04-30）[C4]**

- 人工中断约少 200 倍。
- 送审动作放行约 99%（99.1%）；算上沙箱内动作，整体放行 99.93%。
- 合成过度行为召回 90.3%。
- 合成注入：RCE、窃密、外传三类合计 99.3%，全类别 90.2%。MonitoringBench Hard 96.1%。
- 示例快照 720 次升级中拒绝 7 次。
- 被拒后超过一半情况能找到可接受的替代路径。
- 红队发现 reviewer 可被误导，官方说不提供确定性保证，也防不住有意隐藏。

**怎么读这些数字**

- **延迟：没有任何一家公布 p50 / p95。** OpenAI 只说监控延迟 [C4]，Anthropic 说只有第一阶段标记的才花推理 token [A1]，也承认全量审 shell 会增加延迟 [A9]。
- **口径不可比**：Anthropic 报真实流量误拦和小样本漏拦，OpenAI 报合成集召回，没有直接的误拒率。
- **全是前沿模型 + 厂商自测**。没查到 DeepSeek 或同级开源模型做审批的公开数据，kits 要自己测。
- **一致的工程做法**：确定性规则先过，只把不确定的送模型；失败时拦截；把理由交回主 Agent 让它换路；连续被拦就熔断回人工。
- **各家都声明不是安全边界**：Claude Code [A5]、Cursor [U1]、Codex [C4]。

**审批疲劳数字。** Anthropic 自己有两个口径：3 月博客说用户接受 93% 的提示 [A1]，8 月文章说 97%，且单次权限拒绝率 3%，而**计划审批拒绝率 39%** [A2]。两者都没写方法。39% 对 3% 说明人在计划层面判断时更认真。沙箱减少提示的数字：Claude Code 84% [A4]，Cursor 中断少 40% [U2]。

## 专题 3：批量、事后、回滚类做法

| 产品 | 机制 | 覆盖 bash 改动 | 限制 |
|---|---|---|---|
| **OpenCode** [O17] | 影子 git（数据目录 `snapshot/<project>/<hash>`），每步 `track`；`/undo`、`/redo`；`POST /session/:id/revert`、`unrevert` | **是**（快照整个工作树，源码） | 项目必须是 git 仓库；`snapshot: false` 可关；遵守 `.gitignore`；超过 2 MB 的未跟踪文件被排除；`git gc --prune=7.days`；工作树外和外部副作用不管 |
| **Claude Code** [A10] | 每条用户提示一个 checkpoint，`/rewind`，代码和对话可分开恢复，留最近 100 个，约 30 天清理 | **否**，只有 bash 改过的文件不跟踪 | 大多数子 Agent 的编辑不恢复；跳过符号链接和硬链接（pnpm 的文件在内） |
| **Codex** [C1][C7] | `main` 的斜杠命令里没有 undo（源码）；文档建议分支、干净工作区、勤提交、走补丁流 | 靠 git | 无内置回滚 |
| **Cursor** [U4] | 改动前自动 checkpoint，存本地，独立于 git；恢复只改文件 | 文档未说 | 不替代 git |
| **Gemini CLI** [G5] | 改文件工具执行前快照到 `~/.gemini/history/<hash>`，`/restore` 恢复文件和对话，并重新提出那次工具调用 | 只在改文件工具前触发 | 默认是否开启未核实 |
| **Cline** [K2] | 每次工具调用后在影子 git 快照，含 git 不跟踪的文件；可只恢复文件或只恢复任务 | 是，命令后也快照 | 大仓库耗存储、变慢 |
| **Roo Code** [R2] | 任务开始和改文件前快照 | **否**，命令前不建 | 有嵌套 git 仓库时禁用 |

**事后审批。** 目前最接近的是“先拦下、事后放行一次”，不是“先执行、事后确认”：

- Claude Code 的 Recently blocked 列表，批准后 Claude 可重试，重试仍过分类器，不生成规则 [A9]。
- Codex 的 `/approve`，每个任务留最多 10 条拒绝记录，只放行该动作一次 [C3]。

**批量审批。** 没查到面向命令的官方批量审批界面。相近机制有三类：

- OpenCode 的 `always` 放行同会话已覆盖的待处理请求，`reject` 拒绝全部 [O3]。
- 把审批移到计划层，Claude Code 的 plan 就是这样 [A2][A5]。
- 把人工检查点限定到少量高风险动作，用 ask 规则把 `git push`、`gh pr create` 留给人，其余走 auto [A9]。

**回滚不能替代事前拦截。** 所有方案都只管工作树内的文件，网络请求、已推送的提交、数据库写入、工作树外的文件都撤不回来。

## 没查实和不一致的地方

**没查实**

- 专题 1 的三种 OpenCode 外包方式：都未实测。
- 本文的实测都在 macOS 上，Windows 没跑。
- 1.19.5 的 `/api/...`（V2）路由是否对外可用。
- MXC 首次使用是否要管理员，当前 GA 版本的安全边界声明；公司 Windows 版本和补丁级别不在本文范围，但决定 MXC 能不能用。
- Gemini `windows-native` 的前置条件和网络隔离强度：官方页这节被省略，只读了源码片段。
- Cursor 原生 Windows 沙箱现状：博客说经 WSL2，Run Modes 页没提 Windows。
- LLM 审批的延迟：无公开数据。
- 1,053 人实验的完整方法、97% 和 93% 的统计口径：Anthropic 没有公开。
- Gemini Checkpointing 默认值；Antigravity CLI、VS Code 回滚未调研。

**文档和源码不一致，或来源之间不一致**

- OpenCode `permission.ask`：内置文档列为钩子，v1.19.5 无调用点 [O14][O20]。
- OpenCode `always`：文档说到会话结束，源码是按目录、进程内共享 [O1][O3]。
- Claude Code 文档说原生 Windows 不沙箱 [A7]，而 sandbox-runtime 自身已有 Windows alpha [A11]。
- Claude Code 被拦时的 headless 行为：3 月博客写进程终止 [A1]，当前文档写 `-p` 下被拦动作不执行、任务继续 [A5]，以文档为准。
- MXC：Windows 博客说 GA [M5]；v0.9.0 的 README 说早期预览 [M7]，当前 README 不再提，SDK 已到 1.0.1 [M1]。
- Codex auto-review 的模型：博客写 GPT-5.4 Thinking [C4]，文档未写 [C3]。
- Codex 的 Linux 沙箱：文档说从 0.115 改用 `bwrap` [C1]，源码里命令类型仍叫 `LandlockCommand`，所以“Codex 用 Landlock”的说法已过时。
- Qwen Code 文档对默认档自相矛盾 [Q1]。

## 来源

**OpenCode**（`B` = `https://github.com/anomalyco/opencode/blob/v1.19.5`）

- [O1] V1 权限文档 https://opencode.ai/docs/permissions/
- [O2] 威胁模型 `B/SECURITY.md`
- [O3] `B/packages/opencode/src/permission/index.ts`
- [O4] `B/packages/schema/src/v1/permission.ts`
- [O5] `B/packages/core/src/v1/config/permission.ts`
- [O6] `B/packages/opencode/src/server/routes/instance/httpapi/groups/permission.ts`
- [O7] `B/packages/opencode/src/server/routes/instance/httpapi/groups/session.ts`、`.../handlers/session.ts`
- [O8] `B/packages/opencode/src/tool/shell.ts`
- [O9] `B/packages/opencode/src/permission/arity.ts`
- [O10] `B/packages/core/src/util/wildcard.ts`
- [O11] `B/packages/opencode/src/agent/agent.ts`
- [O12] `B/packages/opencode/src/session/tools.ts`
- [O13] `B/packages/opencode/src/session/processor.ts`
- [O14] `B/packages/plugin/src/index.ts`、`B/packages/core/src/plugin/skill/customize-opencode.md`
- [O15] `B/packages/opencode/src/cli/cmd/run.ts`、`B/packages/tui/src/context/sync.tsx`
- [O16] `B/packages/opencode/src/agent/subagent-permissions.ts`
- [O17] `B/packages/opencode/src/snapshot/index.ts`、`B/packages/opencode/src/session/revert.ts`、`B/packages/web/src/content/docs/tui.mdx`
- [O18] `B/packages/core/src/shell.ts`
- [O19] `B/packages/opencode/src/effect/instance-state.ts`
- [O20] https://github.com/anomalyco/opencode/issues/47654
- [O21] https://github.com/anomalyco/opencode/issues/47674
- [O22] https://github.com/anomalyco/opencode/pull/53937
- [O23] https://github.com/anomalyco/opencode/issues/2242 、https://github.com/anomalyco/opencode/issues/48411
- [O24] https://github.com/anomalyco/opencode/issues/50652
- [O25] V2 权限文档 https://github.com/anomalyco/opencode/blob/v2.2.5/services/www/src/docs/content/permissions.mdx
- [O26] https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/permission.ts
- [O27] https://github.com/anomalyco/opencode/blob/v2.2.5/packages/plugin/src/promise/permission.ts
- [O28] https://github.com/anomalyco/opencode/blob/v2.2.5/services/www/src/docs/content/migrate-v1.mdx
- [O29] https://github.com/anomalyco/opencode/blob/v2.2.5/services/www/src/docs/content/policies.mdx
- [O30] https://github.com/anomalyco/opencode/releases 、https://github.com/anomalyco/opencode/blob/v2.2.5/README.md 、https://www.npmjs.com/package/opencode-ai 、https://www.npmjs.com/package/@opencode/cli
- [O31] `B/packages/opencode/src/tool/edit.ts`、`.../webfetch.ts`、`.../external-directory.ts`
- [O32] https://github.com/anomalyco/opencode/blob/v2.2.5/packages/protocol/src/groups/permission.ts

**Claude Code / Anthropic**

- [A1] https://www.anthropic.com/engineering/claude-code-auto-mode （2026-03-25）
- [A2] https://claude.com/resources/articles/auto-mode-default-in-claude-code （2026-08-07，10-22 更新）
- [A3] https://claude.com/resources/articles/auto-mode-in-production （2026-08-07）
- [A4] https://www.anthropic.com/engineering/claude-code-sandboxing （2025-10-20）
- [A5] https://code.claude.com/docs/en/permission-modes
- [A6] https://code.claude.com/docs/en/permissions
- [A7] https://code.claude.com/docs/en/sandboxing
- [A8] https://code.claude.com/docs/en/hooks
- [A9] https://code.claude.com/docs/en/auto-mode-config
- [A10] https://code.claude.com/docs/en/checkpointing
- [A11] https://github.com/anthropics/sandbox-runtime

**OpenAI Codex**

- [C1] https://learn.chatgpt.com/docs/agent-approvals-security
- [C2] https://learn.chatgpt.com/docs/windows/windows-sandbox
- [C3] https://learn.chatgpt.com/docs/sandboxing/auto-review.md
- [C4] https://alignment.openai.com/auto-review/ （2026-04-30）
- [C5] https://github.com/openai/codex/blob/main/codex-rs/execpolicy/README.md
- [C6] https://github.com/openai/codex/blob/main/codex-rs/mxc-sandbox/README.md
- [C7] https://github.com/openai/codex/blob/main/codex-rs/tui/src/slash_command.rs

**Microsoft MXC**

- [M1] https://github.com/microsoft/mxc/blob/main/README.md
- [M2] https://github.com/microsoft/mxc/blob/main/sdk/node/README.md
- [M3] https://github.com/microsoft/mxc/blob/main/docs/backends/process-container/networking.md
- [M4] https://github.com/microsoft/mxc/blob/main/docs/backends/process-container/os-version-support.md
- [M5] https://blogs.windows.com/windowsdeveloper/2026/10/07/microsoft-execution-containers-policy-driven-containment-for-ai-agents/
- [M6] https://blogs.windows.com/windowsexperience/2026/10/07/building-windows-for-hybrid-intelligence/
- [M7] https://github.com/microsoft/mxc/blob/v0.9.0/README.md

**Cursor**

- [U1] https://cursor.com/docs/agent/security/run-modes
- [U2] https://cursor.com/blog/agent-sandboxing （2026-02-18）
- [U3] https://forum.cursor.com/t/auto-review-run-mode/161922 （官方员工，2026-05-29）
- [U4] https://cursor.com/docs/agent/chat/checkpoints

**Gemini CLI**

- [G1] https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/policy-engine.md
- [G2] https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/sandbox.md
- [G3] https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/sandbox/windows/GeminiSandbox.cs
- [G4] https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/trusted-folders.md
- [G5] https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/checkpointing.md
- [G6] https://github.com/google-gemini/gemini-cli/blob/main/README.md

**其他工具**

- [V1] https://code.visualstudio.com/docs/agents/run/approvals
- [V2] https://code.visualstudio.com/docs/agents/run/agent-sandboxing
- [V3] https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/configure-copilot-cli
- [K1] https://docs.cline.bot/features/auto-approve
- [K2] https://docs.cline.bot/core-workflows/checkpoints
- [R1] https://roocodeinc.github.io/Roo-Code/features/auto-approving-actions
- [R2] https://roocodeinc.github.io/Roo-Code/features/checkpoints
- [Go1] https://goose-docs.ai/docs/guides/managing-tools/goose-permissions/
- [Go2] https://github.com/aaif-goose/goose/issues/11017
- [W1] https://docs.devin.ai/desktop/terminal （由 docs.windsurf.com/windsurf/terminal 重定向）
- [P1] https://ampcode.com/news/neo （2026-05-06）
- [P2] https://ampcode.com/notes/permissions
- [Q1] https://qwenlm.github.io/qwen-code-docs/en/users/features/approval-mode/

**安全研究**

- [S1] https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/ （2025-06-16）
- [S2] https://ai.meta.com/blog/practical-ai-agent-security/ （2025-10-31）
- [S3] https://arxiv.org/abs/2503.18813 （v2，2025-06-24）
