# Personal Knowledge OS (PKOS)

PKOS 是一个私密个人知识与能动性系统。它把知识对象、复习队列、Digest、本地 dashboard 与后续 Flow Hub 连接在同一个可审计的 Git 文件权威层中。

当前主线不建设公开内容链路；所有站点导出都服务于本地私密操作台。

## Core Root / Data Root

默认情况下，PKOS 会把当前仓库根目录同时作为 code root 与 data root。设置 `PKOS_DATA_ROOT` 后，工具代码仍从当前仓库读取，但真实数据会从指定 data root 读取和写入。

```bash
PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python -m tools.pkos gen-flow
```

PowerShell：

```powershell
$env:PKOS_DATA_ROOT="E:\Creation\PKOS-Vault"
python -m tools.pkos export-agent-context
```

长期推荐结构：

```text
pkos-core   # public-safe: tools, docs, schema, demo
pkos-vault  # private: objects, inbox, state, review logs, digests, runtime
```

## 核心理念

- **人类裁决优先**：LLM / Agent 是协作者，不是事实或人生决策的最终裁决者。
- **Git 文件权威层**：权威数据仅来自仓库中的 Markdown / YAML / JSON / JSONL。
- **状态机**：可信知识按 `raw -> parsed -> challenged -> trusted -> deprecated` 演进。
- **SRS**：fact / skill / claim 进入复习调度；复习日志 append-only。
- **Digest**：用可追溯 references 压缩知识进展，不制造新事实。
- **LLM 无权威写权限**：写回必须走确定性接口、白名单目录与 Git commit。

## 当前工作流

1. **objects**
   - 可信知识：`fact` / `skill` / `claim`
   - 内部创作：`creative`
   - `creative` 只作为内部写作、灵感、草稿和表达性材料，不绑定对外链路。

2. **state machine**
   - `raw -> parsed -> challenged -> trusted -> deprecated`
   - `trusted` 的最终裁决权属于人类维护者。

3. **review**
   - Daily：fact + skill
   - Weekly：claim
   - 评分写回采用 append-only 日志与确定性 SRS 更新。

4. **digests**
   - 汇总知识对象增量与运行回顾。
   - 每条关键结论必须保留 references。

5. **site-private**
   - 本地 dashboard，用于浏览 objects、queues、digests 与 review。
   - 前端只作为私密操作台，不直接写权威文件。

6. **local backend**
   - FastAPI 本地后端默认监听 `127.0.0.1`。
   - 写接口必须 token + localhost + 白名单 + auto commit。

7. **Flow Hub / runtime**
   - 预留 Inbox、Current State、Today Queue、Recovery Queue、Writing Queue、Agent Context Pack 等运行中枢能力。
   - `runtime/` 保存可删除、可重建的派生上下文与索引缓存。

## 命令

```bash
python -m tools.pkos validate
python -m tools.pkos gen-queue
python -m tools.pkos gen-digest --week 2026-W07
python -m tools.pkos inbox-append --capture-type note --content "..."
python -m tools.pkos state-append --energy low --mood anxious --body chest_tight
python -m tools.pkos gen-flow
python -m tools.pkos export-agent-context
python -m tools.pkos export-site-data
```

`gen-flow` 会生成 `runtime/flow/*.json`。`export-agent-context` 会生成 `runtime/agent_context.json`，供月洛洛读取。二者都是只读派生命令，不修改 `objects/`、`docs/`、schema 或 trusted 状态。

`inbox-append` 与 `state-append` 是低风险 append-only 入口，只写入本地运行日志：

- `inbox/items.jsonl`
- `state/snapshots.jsonl`

当前 public-core 方向下，真实 `.jsonl` 默认被 Git 忽略。未来 private vault 可以选择追踪这些本地日志。

服务器部署示例：

```bash
mkdir -p /home/infinity/apps/pkos-core
mkdir -p /home/infinity/data/pkos-vault

cd /home/infinity/apps/pkos-core
PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python -m tools.pkos inbox-append --capture-type note --content "server test"
PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python -m tools.pkos state-append --energy low --mood calm --body normal
PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python -m tools.pkos gen-flow
PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python -m tools.pkos export-agent-context
```

## 本地预览

```bash
python -m tools.pkos export-site-data
python -m http.server 8000
```

打开：

- `http://localhost:8000/site-private/dashboard/index.html`

如需查看随仓库提供的稳定 demo 数据：

```bash
python -m tools.pkos export-site-data --profile demo
python -m http.server 8000
```

## 注意事项

- Dashboard 当前仍是只读视图；Review 评分可生成聚合片段，权威写回应通过后端确定性接口。
- `creative` 保留为内部对象类型，生命周期建议为 `draft / revised / archived`。
- RAG、前端导出、Agent Context Pack 都是派生缓存，不是权威层。
- `runtime/flow/` 与 `runtime/agent_context.json` 可删除并重新生成。
- `inbox/items.jsonl` 与 `state/snapshots.jsonl` 是 local operational logs，不是公开核心数据。
- 后续 Flow Hub / 月洛洛 / RAG Sidecar 需要遵守 `AGENTS.md` 的权限分级。

详细规范见：`AGENTS.md`、`docs/ARCHITECTURE_V0.5.md`、`docs/FLOW_HUB_CONTRACT.md`、`docs/AGENT_AUTHORITY_BOUNDARY.md`、`docs/RAG_SIDECAR_DESIGN.md`、`docs/PROJECT_PLAN.md`、`docs/OPERATIONS.md`。
