# 评测

最小可用的评测集：JSONL 样本加 Node 脚本，不上框架。

- `samples/*.jsonl`：每行一条样本，字段 `id`、`input`（任务描述和附件）、`expected`（人工修改后的产出）。应用的“数据与隐私”设置里可以导出这种格式。
- `run.mjs`：读取样本，跑一遍 Agent，输出采纳率和修改比例。第一阶段只搭骨架，等会话模块能跑后再接上。

```bash
node evals/run.mjs evals/samples/example.jsonl
```
