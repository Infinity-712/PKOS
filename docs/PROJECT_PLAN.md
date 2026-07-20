# PKOS Project Plan

> Legacy note: v0.3 `site-private/dashboard` and v0.4 FastAPI are historical milestones. They are now quarantined as legacy read-only components. Current GUI authority writes must go through `pkos-agent-server` on port `8790`; see `docs/LEGACY_SERVICE_QUARANTINE.md`.

PKOS 当前定位为私密个人知识与能动性操作系统。主线目标是维护一个 Git 可审计、可回滚、可复习、可压缩的个人知识与行动层。

## 当前边界

- 权威层：仓库内 Markdown / YAML / JSON / JSONL。
- 派生层：dashboard 数据、Digest、RAG index、Agent Context Pack。
- 前端：当前主线为 `apps/web-dashboard` 与 `apps/desktop`；`site-private/dashboard` 为 legacy read-only。
- 后端：当前主线为 `pkos-agent-server` on `127.0.0.1:8790`；旧 FastAPI 为 legacy read-only。
- Agent：协作者与执行辅助，不拥有权威裁决权。

当前阶段不建设公开内容链路；creative 类型只作为内部创作对象。

## 对象系统

可信知识轨道：

- `fact`
- `skill`
- `claim`

内部创作轨道：

- `creative`

可信知识状态机：

```text
raw -> parsed -> challenged -> trusted -> deprecated
```

creative 生命周期：

```text
draft -> revised -> archived
```

## 已落地能力

### v0.1 Validation

- 对象 schema 校验；
- trusted 最低条件校验；
- common object index；
- `python -m tools.pkos validate`。

### v0.2 Review Queue

- SRS 字段初始化；
- Daily 队列：fact + skill；
- Weekly 队列：claim；
- review queue Markdown 生成；
- `python -m tools.pkos gen-queue`。

### v0.3 Digest + Private Dashboard

- `python -m tools.pkos gen-digest`；
- Digest references 可追溯；
- `python -m tools.pkos export-site-data` legacy static export；
- `site-private/dashboard` legacy 本地 dashboard；
- objects / queues / digests / review 的静态浏览。

### v0.4 Local Backend MVP

- FastAPI 本地后端（现已隔离为 legacy read-only）；
- `127.0.0.1` 默认监听；
- objects / rendered / queues / digests 只读 API；
- 旧 `ratings:batch` 写回已退役并返回 `410 legacy_writeback_disabled`；
- 旧 chat placeholder 已退役并返回 `410 legacy_chat_retired`。

## 下一阶段方向

### v0.5 Flow Hub

Flow Hub 作为 PKOS 与月洛洛 / 前端之间的运行中枢，优先支持：

- Inbox；
- Current State；
- Today Queue；
- Review Queue；
- Recovery Queue；
- Writing Queue；
- Flow Budget；
- Agent Context Pack。

Flow Hub 不替代权威层，不迁移 trusted，不绕过 Git 审计。

v0.5 架构主文档见 `docs/ARCHITECTURE_V0.5.md`。配套契约：

- `docs/FLOW_HUB_CONTRACT.md`
- `docs/AGENT_AUTHORITY_BOUNDARY.md`
- `docs/RAG_SIDECAR_DESIGN.md`

目录骨架：

- `inbox/`：低摩擦捕获池；
- `runtime/`：派生上下文、索引、private site 镜像；
- `runtime/site-private/_pkos/`：dashboard 导出数据的 v0.5 runtime 镜像。

### v0.6 RAG Sidecar

RAG Sidecar 是可删除、可重建的派生检索层：

- chunk 指向 `source_path` / `object_id` / `status`；
- 检索结果保留对象状态；
- Agent 必须区分 raw / parsed / challenged / trusted / deprecated / creative；
- RAG 结果不得绕过 trusted 门禁。

### v0.7 Multi-surface Frontend

在 private-first 前提下扩展：

- PWA；
- Desktop App；
- Android App；
- 多端统一调用本地或私有 API。

## 当前基础命令

```bash
python -m tools.pkos validate
python -m tools.pkos gen-queue
python -m tools.pkos gen-digest --week 2026-W07
python -m tools.pkos gen-flow
python -m tools.pkos export-agent-context
```

## Legacy 命令

```bash
python -m tools.pkos export-site-data
python -m tools.pkos serve --port 8787
```

These legacy commands are for historical read-only inspection only.

## 验收原则

- 权威层文件可 Git diff / rollback；
- 复习日志 append-only；
- Dashboard 不直接写权威文件；
- 后端写回必须走确定性接口；
- Agent 不拥有 trusted 写权限；
- Digest 不创造新事实；
- RAG 与前端导出均为派生缓存。
