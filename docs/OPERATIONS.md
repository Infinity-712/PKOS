# PKOS Operations

本文件记录当前主线的本地运行流程。PKOS 当前只作为私密个人知识与能动性系统，不维护公开内容链路。

## 日常流程

1. 校验对象：
   ```bash
   python -m tools.pkos validate
   ```

2. 生成复习队列：
   ```bash
   python -m tools.pkos gen-queue
   ```

3. 生成 Digest：
   ```bash
   python -m tools.pkos gen-digest --week 2026-W07
   ```

4. 导出私密 dashboard 数据：
   ```bash
   python -m tools.pkos export-site-data
   ```

## 本地预览

默认预览当前仓库权威数据：

```bash
python -m tools.pkos export-site-data
python -m http.server 8000
```

打开：

- `http://localhost:8000/site-private/dashboard/index.html`

如需预览稳定 demo 数据：

```bash
python -m tools.pkos export-site-data --profile demo
python -m http.server 8000
```

## 对象录入规范

新建对象推荐最小字段：

- `id`
- `type`
- `status`
- `title`
- `summary`
- `content`
- `created_at`
- `updated_at`

类型附块建议：

- fact：`counter_examples`、`verification_sources`
- skill：`common_mistakes`、`practice_log`
- claim：`assumptions`、`evidence`、`counter_arguments`、`scope`、`invalidation_conditions`
- creative：`tags`、`content`、`notes`

`content` 是推荐的规范正文。旧对象可通过 `definition`、`explanation`、`notes`、`text`、`body` 被 dashboard 兼容预览。

## 复习写回

本地后端提供确定性评分写回：

```bash
python -m tools.pkos serve --port 8787
```

请求头：`X-PKOS-Token`，值来自本机环境变量 `PKOS_WRITE_TOKEN`。

示例：

```bash
curl -X POST http://127.0.0.1:8787/api/review/ratings:batch \
  -H 'Content-Type: application/json' \
  -H 'X-PKOS-Token: <your-token>' \
  -d '{"items":[{"id":"fact.demo.due","score":4},{"id":"skill.demo.due","score":3}]}'
```

写回结果：

- `review/logs/YYYY-MM-DD.jsonl` 追加日志；
- 对应对象 `srs` 字段更新；
- 自动产生一次 Git commit；
- 返回 commit hash、changed files 与 failures。

## 回滚

```bash
git log --oneline -n 5
git revert <commit_hash>
```

## 常见错误

- `401 invalid token`：`X-PKOS-Token` 与 `PKOS_WRITE_TOKEN` 不匹配。
- `403 localhost only`：请求未从本机回环地址进入。
- `404 object not found`：对象 id 不存在。
- `type not writable: creative`：creative 不参与默认 SRS 写回。
