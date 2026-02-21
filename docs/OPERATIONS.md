# PKOS Operations (Windows + VS Code)

## 日常流程
1. 校验对象：`python -m tools.pkos validate`
2. 生成复习队列：`python -m tools.pkos gen-queue`
3. 博客门禁：`python -m tools.pkos publish-check`
4. 周报：`python -m tools.pkos gen-digest`
5. 站点导出：`python -m tools.pkos export-site-data`

## 本地预览（推荐）
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

