# Site Export Rules (v0.3)

## 核心原则
- `pkos export-site-data` 仅做只读导出，不得修改 `objects/`、`review/logs/`、`digests/`、`blog/` 源文件。
- 导出 JSON 为站点渲染索引，不是权威层。
- 默认导出 `current` profile，即仓库当前权威数据：
  - `objects/`
  - `review/`
  - `digests/`
  - `blog/published/`
- 如需稳定演示数据，显式运行：`python -m tools.pkos export-site-data --profile demo`。

## 隐私边界与白名单

### Public (`site-public/_pkos/blog_index.json`)
白名单字段：
- `slug`
- `title`
- `summary`
- `date`
- `status`
- `created_at`
- `updated_at`
- `tags`
- `channel`
- `path`

禁止包含：
- `objects` 索引字段
- `queues/digests` 私有内容
- 来源细节与内部证据链字段

### Private (`site-private/_pkos/*.json`)
- `index.json`：`id/type/status/title/summary/content/tags/created_at/updated_at/path`，以及对象预览所需的类型附块（如 `definition`、`counter_examples`、`verification_sources` 等）
- `queues.json`：`daily[]/weekly[]`（`id/title/due_at/path`）
- `digests.json`：`week/title/path/entry_count/references`

## 稳定排序（降噪）
- `index.json`：按 `(type, status, id)`
- `queues.json`：按 `(due_at, id)`
- `digests.json`：按 `week asc`（前端可倒序显示）
