# PKOS Publish Rules (v0.1)

本文件定义 `pkos publish-check` 的最小约定与门禁规则。

## 1) 引用语法约定（最小可用）

采用 **Markdown Frontmatter** 的 `references` 字段：

```yaml
---
title: "My Post"
references:
  - fact.trusted.example
  - claim.trusted.example
assumptions:
  - "前提A"
invalidation_conditions:
  - "失效条件A"
last_updated: "2026-02-13"
revision_log_template: "- [ ] date: \n  reason: \n  changed:"
---
```

选择该约定的原因：
- 易写（YAML 列表）
- 可 grep（`references:`）
- 解析稳定（脚本可直接读取 frontmatter）

## 2) 门禁规则

`pkos publish-check` 会检查：

1. 每篇文章必须有 YAML frontmatter。
2. frontmatter 必须包含：
   - `references`
   - `assumptions`
   - `invalidation_conditions`
   - `last_updated`
   - `revision_log_template`
3. `references` 必须是非空列表。
4. 每个引用对象 ID 必须在 `objects/` 下存在。
5. 每个引用对象的 `status` 必须为 `trusted`。

任一不满足即返回非零退出码并阻断发布。

## 3) 命令

```bash
python -m tools.pkos publish-check
python -m tools.pkos publish-check --blog-dir blog/published
python -m tools.publish_gate.publish_check --blog-dir blog/drafts --objects-dir objects
```
