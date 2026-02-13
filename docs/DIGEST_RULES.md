# PKOS Digest Rules (v0.3)

`pkos gen-digest` 生成的是**知识进展周报（派生索引）**，不是权威事实层。

## 边界
- Digest 不得作为 trusted 的来源或证据。
- Digest 不生成新事实，不输出行动建议。
- 每条必须包含 `references`，并可回链到 `objects/` 中存在的对象 id。

## 生成规则（最小版本）
- 输入：`objects/`（可用 `--objects-dir` 指定）
- 过滤：按对象 `updated_at` 的 UTC + ISO week
- 输出：`digests/YYYY-Www.md`（可用 `--output-dir` 指定）
- 每条字段：`id/type/title/summary/updated_at/references`

## 命令
```bash
python -m tools.pkos gen-digest
python -m tools.pkos gen-digest --week 2026-W07
python -m tools.pkos gen-digest --objects-dir objects --output-dir digests
```
