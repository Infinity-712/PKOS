# Personal Knowledge OS (PKOS) v0.1

PKOS 是一个以 **人类裁决优先** 为核心原则的个人知识系统。

## 核心理念

- 知识以对象管理，而不是散乱文本堆积。
- 所有对象必须进入状态机并可追溯。
- LLM 仅作协作者，不拥有最终事实裁决权。
- 发布内容必须可证伪、可回滚、可审计。

## v0.1 工作流

1. **对象录入（objects）**
   - 类型：`fact` / `skill` / `claim` / `creative`（creative 独立轨道）
   - 初始状态通常为 `raw`。

2. **状态迁移（state machine）**
   - 固定流程：`raw -> parsed -> challenged -> trusted -> deprecated`
   - 进入 `trusted` 需满足类型最低条件并通过人工裁决。

3. **SRS 复习（review）**
   - 通过队列生成调度复习。
   - 复习日志写入 `review/logs/`，并保持 append-only。

4. **博客发布（blog）**
   - 草稿放在 `blog/drafts/`。
   - 对外发布到 `blog/published/` 前必须通过门禁：引用对象全部 `trusted`。

## 仓库结构（v0.1）

```text
raw_vault/{web,pdf,notes_inbox}
objects/{fact,skill,claim,creative}
tools/{schema,validators,queue_gen,publish_gate}
review/logs
blog/{drafts,published}
docs
```

## 关键约束

- 纯文件 Git 工作流（Markdown / YAML / JSON）。
- 不引入数据库作为权威层。
- 规则必须可 diff、可回滚。

详细规范见：`AGENTS.md` 与 `docs/PROJECT_PLAN.md`。

## Validate 命令（最小可用）

依赖：

- Python 3.9+
- 无第三方依赖（标准库实现，支持 v0.1 模板与常见 YAML 子集）

运行：

```bash
python -m tools.validators.validate
python -m tools.pkos validate
python -m tools.pkos gen-queue
python -m tools.pkos publish-check
python -m tools.pkos gen-digest --week 2026-W07
```


## SRS 队列生成（最小可用）

- 命令：`python -m tools.pkos gen-queue`
- 输出：
  - `review/daily_queue.md`（fact + skill）
  - `review/weekly_queue.md`（claim）
- 规则：`due_at <= now` 的对象进入队列；排序稳定，避免无意义抖动。
- 若对象缺少 `srs` 字段，将自动补默认值并写回对象文件（可审计、可回滚）。
- 生成器不会修改 `review/logs/` 历史日志（append-only 约束）。


## Publish Gate（最小可用）

- 命令：`python -m tools.pkos publish-check`
- 默认检查目录：`blog/drafts`（可用 `--blog-dir` 指向 `blog/published`）
- 规则与引用约定见：`docs/PUBLISH_RULES.md`
- 任一引用对象不存在或非 `trusted` 时，命令非零退出并阻断发布。


## Weekly Digest（最小可用）

- 命令：`python -m tools.pkos gen-digest --week YYYY-Www`
- 输出：`digests/YYYY-Www.md`
- 定位：派生索引，不是权威事实层；每条含 `references` 回链对象 id。

## Creative 对象（最小可用）

- 对象类型新增 `creative`，独立生命周期：`draft/revised/published/archived`。
- `creative` 不进入 trusted，不参与默认 SRS 队列。
