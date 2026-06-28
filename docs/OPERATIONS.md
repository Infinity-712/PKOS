# PKOS Operations (Windows + VS Code)

## 日常流程
1. 校验对象：`python -m tools.pkos validate`
2. 生成复习队列：`python -m tools.pkos gen-queue`
3. 博客门禁：`python -m tools.pkos publish-check`
4. 周报：`python -m tools.pkos gen-digest`
5. 站点导出：`python -m tools.pkos export-site-data`

## 本地预览（推荐）
默认预览当前仓库权威数据：
```bash
python -m tools.pkos export-site-data
```

如需预览稳定 demo 数据：
```bash
python -m tools.pkos export-site-data --profile demo
```

### 方式 A：Python http.server
```bash
python -m http.server 8000
```
打开：
- `http://localhost:8000/site-private/dashboard/index.html`
- `http://localhost:8000/site-public/creative/index.html`

### 方式 B：VS Code Live Server
- 在 `site-private/dashboard/index.html` 右键 Open with Live Server
- 同理可打开 `site-public/creative/index.html`

## 常见问题
### publish-check 默认目录包含 fixture
当前仓库含 `blog/drafts/fail_cases` 故意失败样例，直接运行默认命令可能失败。
可针对通过样例目录运行：
```bash
python -m tools.pkos publish-check --blog-dir blog/drafts/pass_cases
```

## 只读 GUI 规则
- Dashboard 只读，Create/Review 仅生成可复制内容。
- 任何写回操作必须在 VS Code + CLI 中完成。

## 对象录入规范（v0.4）
- 新建对象推荐最小字段：`title` / `summary` / `content`（demo 现阶段强制）。
- `content` 为规范化正文，预览全文与 LLM 上下文优先读取该字段。
- 类型附块推荐：
  - fact：`counter_examples`、`verification_sources`
  - skill：`common_mistakes`、`practice_log`
  - claim：`assumptions`、`evidence`、`counter_arguments`、`scope`、`invalidation_conditions`
  - creative：`tags`（可选 notes 等补充）

## 本地后端（v0.4 MVP）

### 启动
```bash
python -m tools.pkos serve --port 8787
# 或
python -m tools.server.main --port 8787
```

### 只读 API（示例）
```bash
curl http://127.0.0.1:8787/api/health
curl 'http://127.0.0.1:8787/api/objects?limit=5'
curl http://127.0.0.1:8787/api/objects/fact.demo.due/rendered
curl http://127.0.0.1:8787/api/review/queues
curl http://127.0.0.1:8787/api/digests
```

### 评分批量写回（append-only + SRS + auto commit）
请求头：`X-PKOS-Token`（从环境变量 `PKOS_WRITE_TOKEN` 读取）
```bash
curl -X POST http://127.0.0.1:8787/api/review/ratings:batch   -H 'Content-Type: application/json'   -H 'X-PKOS-Token: <your-token>'   -d '{"items":[{"id":"fact.demo.due","score":4},{"id":"skill.demo.due","score":3}]}'
```

写回结果：
- `review/logs/YYYY-MM-DD.jsonl` 追加日志（append-only）
- 对应对象 `srs` 字段更新（SM-2 子集）
- 自动产生一次 git commit：`review: ratings batch (n=<N>)`

### 回滚
```bash
git log --oneline -n 5
git revert <commit_hash>
```

### 常见错误
- `401 invalid token`：`X-PKOS-Token` 与 `PKOS_WRITE_TOKEN` 不匹配
- `403 localhost only`：请求未从本机回环地址进入
- `404 object not found`：评分对象 id 不存在
- `type not writable: creative`：creative 不参与默认 SRS 写回

