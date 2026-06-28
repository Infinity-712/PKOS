# Private Site Export Rules

`pkos export-site-data` 仅导出私密 dashboard 所需的派生 JSON。导出数据不是权威层，可删除、可重建。

## 核心原则

- 只读导出，不得修改 `objects/`、`review/logs/`、`digests/` 等权威或日志源文件。
- 默认导出当前权威数据：
  - `objects/`
  - `review/`
  - `digests/`
- 如需稳定演示数据，显式运行：
  ```bash
  python -m tools.pkos export-site-data --profile demo
  ```
- 导出目录默认为 `site-private/_pkos/`。

## 导出文件

### `site-private/_pkos/index.json`

对象索引字段：

- `id`
- `type`
- `status`
- `title`
- `summary`
- `content`
- `tags`
- `created_at`
- `updated_at`
- `path`

可包含对象预览所需的类型附块，例如：

- `definition`
- `canonical_example`
- `claim_statement`
- `counter_examples`
- `verification_sources`
- `common_mistakes`
- `practice_log`
- `assumptions`
- `evidence`
- `counter_arguments`
- `scope`
- `invalidation_conditions`
- `source`
- `anchors`

### `site-private/_pkos/queues.json`

复习队列字段：

- `daily[]`
- `weekly[]`
- 每个 item 包含 `id`、`title`、`due_at`、`path`

### `site-private/_pkos/digests.json`

Digest 索引字段：

- `week`
- `title`
- `path`
- `entry_count`
- `references`

## 稳定排序

- `index.json`：按 `(type, status, id)`
- `queues.json`：按 `(due_at, id)`
- `digests.json`：按 `week asc`
