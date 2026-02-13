# Personal Knowledge OS (PKOS) v0.3

PKOS 是一个以 **人类裁决优先** 为核心原则的个人知识系统。

## 核心理念

- 知识以对象管理，而不是散乱文本堆积。
- 所有可信知识对象进入状态机并可追溯。
- LLM 仅作协作者，不拥有最终事实裁决权。
- 发布内容必须可证伪、可回滚、可审计。

## v0.3 工作流

1. **对象录入（objects）**
   - 可信轨道：`fact` / `skill` / `claim`
   - 创作轨道：`creative`（独立生命周期，不进 trusted）

2. **状态迁移（knowledge state machine）**
   - `raw -> parsed -> challenged -> trusted -> deprecated`

3. **SRS 复习（review）**
   - 队列视图：daily（fact+skill）/ weekly（claim）
   - `creative` 不进入默认 SRS

4. **发布与分站**
   - Knowledge Blog：`publish-check` 严格门禁
   - Creative Output：独立通道 `/creative/`，由人类决定发布
   - `site-private` 仅本地预览，不部署公网

## 命令

```bash
python -m tools.pkos validate
python -m tools.pkos gen-queue
python -m tools.pkos publish-check
python -m tools.pkos gen-digest --week 2026-W07
python -m tools.pkos export-site-data
```

## 本地预览（GUI）

```bash
python -m tools.pkos export-site-data
python -m http.server 8000
```

打开：
- `http://localhost:8000/site-private/dashboard/index.html`
- `http://localhost:8000/site-public/creative/index.html`

## 注意事项

- Dashboard 是只读视图：Create/Review 仅生成可复制内容，不写回仓库。
- `publish-check` 默认目录含 fixture 时可能出现预期失败；可用：
  - `python -m tools.pkos publish-check --blog-dir blog/drafts/pass_cases`

详细规范见：`AGENTS.md`、`docs/PROJECT_PLAN.md`、`docs/OPERATIONS.md`。
