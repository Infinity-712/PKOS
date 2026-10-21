# Personal Knowledge OS (PKOS)

阅读入口：**[中文主人手册](handbook/README.md)** · **[工程与 Agent 文档索引](docs/README.md)**。

项目进展见[当前状态](handbook/status.md)；[2026-09-26 状态快照](docs/CURRENT_STATE.md)保留供追溯。只读 Agent 实验仍是待实施提案，不代表已完成行为验收。

## 本地启动

日常入口是 `scripts/local-runtime.ps1 start`，完整步骤统一见[如何运行](handbook/how-to-run.md)，工程参数和排障见[Operations](docs/OPERATIONS.md)。已有配置先校验，不要为日常启动再次执行会覆盖配置的 `configure`，也不要绕过系统执行策略。

不同 `PKOS_DATA_ROOT` 对应不同聊天历史和 Provider 运行配置。密钥只交给 Agent Server 进程环境，不写进 profile、数据库、文档或进程清单。实例身份、构建或 schema 不匹配时先人工核对，不抢占端口或终止未知进程；复用条件见[Service Identity](docs/SERVICE_IDENTITY_CONTRACT.md)。

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

5. **Web Dashboard / Desktop**
   - 当前主界面由 `apps/web-dashboard` 与 `apps/desktop` 提供。
   - GUI authority 写回只能通过 `127.0.0.1:8790` Agent Server 的固定 API，再进入 Python Core。

6. **legacy static/FastAPI**
   - `site-private/dashboard`、`python -m http.server 8000` 与 `python -m tools.pkos serve --port 8787` 已隔离为 legacy read-only。
   - 旧 FastAPI 不支持 DeepSeek，不允许 authority 写回。

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
python -m tools.pkos state-list --json
python -m tools.pkos gen-flow
python -m tools.pkos export-agent-context
python -m tools.pkos task-create --title "..." --source manual --request-id "..."
python -m tools.pkos task-list --json
python -m tools.pkos task-transition --task-id task_... --target-status in_progress --reason "..."
python -m tools.pkos task-rebuild --json
python -m tools.pkos reminder-create --title "..." --remind-at "2026-07-15T10:00:00Z" --request-id "..."
python -m tools.pkos reminder-list --json
python -m tools.pkos reminder-acknowledge --id reminder_... --reason "seen" --request-id "..."
python -m tools.pkos reminder-cancel --id reminder_... --reason "cancelled" --request-id "..."
python -m tools.pkos reminder-reschedule --id reminder_... --remind-at "2026-07-16T10:00:00Z" --reason "later" --request-id "..."
python -m tools.pkos reminder-due --json
python -m tools.pkos review-rebuild --json
python -m tools.pkos review-queue --json
python -m tools.pkos review-rate --object-id fact.demo --rating 4 --reviewed-at "2026-07-20T00:00:00Z" --actor human --request-id "review-demo-1" --json
python -m tools.pkos review-history --object-id fact.demo --json
python -m tools.pkos review-correct --target-event-id review_... --reason "wrong button" --actor human --request-id "review-correct-1" --json
python -m tools.pkos object-types --json
python -m tools.pkos object-list --json
python -m tools.pkos object-render --object-id fact.demo --json
python -m tools.pkos object-create --payload-json '{"id":"fact.demo","type":"fact","status":"parsed","title":"Demo","summary":"Demo","content":"Demo","source":["manual"],"anchors":[]}' --request-id object-create-demo --confirmed --actor human --json
python -m tools.pkos object-update --object-id fact.demo --base-revision <fileRevisionSha256> --patch-json '{"summary":"Updated"}' --request-id object-update-demo --confirmed --actor human --json
python -m tools.pkos object-delete-preflight --object-id fact.demo --base-revision <fileRevisionSha256> --json
python -m tools.pkos object-delete --object-id fact.demo --base-revision <fileRevisionSha256> --typed-object-id fact.demo --reason "cleanup" --request-id object-delete-demo --confirmed --actor human --json
```

`gen-flow` 会生成 `runtime/flow/*.json`。`export-agent-context` 会生成 `runtime/agent_context.json`，供月洛洛读取。二者都是只读派生命令，不修改 `objects/`、`docs/`、schema 或 trusted 状态。

`inbox-append` 与 `state-append` 是低风险 append-only 入口，只写入本地运行日志：

- `inbox/items.jsonl`
- `state/snapshots.jsonl`

`task-create`、`task-transition` 与 `task-rebuild` 是 v0.7-alpha 的正式任务人工管理入口。它们只写入 append-only task authority logs，并生成可重建派生视图：

- `tasks/items.jsonl`
- `tasks/actions.jsonl`
- `runtime/tasks/current.json`

Tasks 不是提醒系统，不是 Agent memory，也不是 LLM 自动抽取结果。Node/Web 调用必须走固定、显式确认的 API，并由 Python CLI 写入；不得直接编辑 task JSONL。
当前版本不再提供新的 task note 写入口；任务说明使用 `description` 字段。历史 `note_added` action 只作为 alpha legacy event 被 rebuild 容忍，不会在 Web 中新增或编辑。
`dueAt` 在 authority 中始终保存为 UTC ISO，Web 创建和显示统一使用北京时间，时间粒度为 30 分钟。

PowerShell 变量只属于当前 shell session。人工验收 task authority 时，推荐重新读取 runtime profile，而不是假设 `$acceptanceRoot` 仍存在：

```powershell
$profilePath = Join-Path (Get-Location) "runtime\local\runtime-profile.json"
if (-not (Test-Path $profilePath)) { throw "RUNTIME_PROFILE_NOT_FOUND: $profilePath" }
$profile = Get-Content $profilePath -Raw -Encoding UTF8 | ConvertFrom-Json
$acceptanceRoot = [string]$profile.dataRoot
if ([string]::IsNullOrWhiteSpace($acceptanceRoot)) { throw "PKOS_DATA_ROOT_EMPTY_IN_RUNTIME_PROFILE" }
if (-not (Test-Path $acceptanceRoot)) { throw "PKOS_DATA_ROOT_NOT_FOUND: $acceptanceRoot" }
$taskRoot = Join-Path $acceptanceRoot "tasks"
$currentView = Join-Path $acceptanceRoot "runtime\tasks\current.json"
Get-ChildItem $taskRoot -Force
Get-Item $currentView
```

当前 public-core 方向下，真实 `.jsonl` 默认被 Git 忽略。未来 private vault 可以选择追踪这些本地日志。

`state-list --json` 是只读状态时间线查询：默认返回最新 50 条，`current` 始终来自未应用过滤条件时的最新显式状态快照，不编辑或覆盖历史记录。

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

## Legacy 静态站

`site-private/dashboard` 是历史只读界面，仅用于检查派生 `_pkos/*.json` 导出数据。它不再维护，不支持 authority 写回，不是当前推荐 GUI。

Legacy preview only:

```bash
python -m tools.pkos export-site-data --profile demo
python -m http.server 8000
```

打开：

- `http://localhost:8000/site-private/dashboard/index.html`

不要把 `8000` 连接到正式 `PKOS_DATA_ROOT` 做人工写回；当前主界面请使用 `scripts/local-runtime.ps1 start` 启动的 Web Dashboard / Desktop。

## Reminder v0.7-beta

Reminder v0.7-beta is a separate human-managed one-shot authority. It writes only:

- `reminders/items.jsonl`
- `reminders/actions.jsonl`
- `runtime/reminders/current.json`
- `runtime/reminders/due.json`

`task dueAt` never creates a reminder automatically. Reminder runtime delivery attempts live in Agent Server SQLite only as rebuildable runtime state; SQLite is not Reminder authority. Web Dashboard can create/list/acknowledge/cancel/reschedule reminders through fixed confirmed APIs. Desktop shows a due reminder runtime panel but does not create native OS notifications in this MVP.

See `docs/REMINDER_CONTRACT.md`.

## Review/SRS v0.8-alpha

Review/SRS is a human-managed authority flow. New review ratings append
`review_rating` events under `review/logs/YYYY-MM-DD.jsonl`; corrections append
`review_correction` events. Historical review JSONL lines are never edited.

`runtime/review/current.json`, `runtime/review/queue.json`, and `object.srs`
are projections. They can be rebuilt from review events plus explicit
`legacy_unverified` object SRS state. If the data root is a Git repository, the
review CLI commits only the changed data-root review files; if not, it returns
`gitCommitCreated: false`.

Only `fact`, `skill`, and `claim` enter default SRS. `creative` remains internal
writing material. Human ratings use the fixed 1..5 mapping: Again, Hard, Good,
Easy, Perfect. Agent/LLM code must not grade mastery.

See `docs/REVIEW_SRS_CONTRACT.md`.

## Object Authority v0.8-beta

Objects are now editable through the current Web Dashboard on `127.0.0.1:5173`
backed by Agent Server on `127.0.0.1:8790`. The formal authority remains
Git-tracked YAML under `PKOS_DATA_ROOT/objects/`; Node and Web never write YAML
directly.

The object flow supports list/get/render/create/update/delete-preflight/hard
delete for `fact`, `claim`, `skill`, and internal `creative`. Updates require
`fileRevisionSha256` as `baseRevision`; `objectContentSha256` remains the
Review/SRS semantic hash. Deletes append tombstones under
`objects/deletions/YYYY-MM-DD.jsonl`, do not cascade, and do not delete review
history.

Review Show Answer now reads the same object render endpoint only after the
human clicks Show Answer. Full object body text is not part of the initial
review queue payload.

See `docs/OBJECT_AUTHORITY_CONTRACT.md`.

## Legacy FastAPI Quarantine

`python -m tools.pkos serve --port 8787` 只保留为历史只读 FastAPI。旧 `/api/chat` 与旧 `/api/review/ratings:batch` 均返回 `410 Gone`。DeepSeek、Chat、Review/SRS authority 写回只属于当前 `pkos-agent-server` on `127.0.0.1:8790`。

See `docs/LEGACY_SERVICE_QUARANTINE.md`.

## Moonlolo Bridge CLI

Moonlolo and other local adapters should call PKOS through bounded CLI commands instead of reading or writing authority files directly.

```bash
python -m tools.pkos paths
python -m tools.pkos paths --json
python -m tools.pkos doctor
python -m tools.pkos doctor --json
python -m tools.pkos inbox-append --capture-type note --content "..." --json
python -m tools.pkos state-append --energy low --mood anxious --body chest_tight --json
python -m tools.pkos export-agent-context --print
```

Use `PKOS_DATA_ROOT` or global `--data-root` to point these commands at a private vault:

```bash
PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python -m tools.pkos export-agent-context --print
python -m tools.pkos --data-root /home/infinity/data/pkos-vault paths --json
```

See `docs/MOONLOLO_INTEGRATION_PLAN.md` and `docs/DATA_ROOT_AND_VAULT.md`.

Server deployment helpers:

```bash
bash scripts/server_smoke_test.sh
```

Moonlolo adapter template:

```text
integrations/moonlolo/pkos_client.mjs
```

See `docs/SERVER_DEPLOYMENT.md` for Ubuntu 22.04 deployment notes.

## 注意事项

- Legacy static dashboard 当前仅用于只读检查派生数据；Review 评分入口已禁用。
- `creative` 保留为内部对象类型，生命周期建议为 `draft / revised / archived`。
- RAG、前端导出、Agent Context Pack 都是派生缓存，不是权威层。
- `runtime/flow/` 与 `runtime/agent_context.json` 可删除并重新生成。
- `inbox/items.jsonl` 与 `state/snapshots.jsonl` 是 local operational logs，不是公开核心数据。
- 后续 Flow Hub / 月洛洛 / RAG Sidecar 需要遵守 `AGENTS.md` 的权限分级。

详细规范见：`AGENTS.md`、`docs/ARCHITECTURE_V0.5.md`、`docs/FLOW_HUB_CONTRACT.md`、`docs/AGENT_AUTHORITY_BOUNDARY.md`、`docs/RAG_SIDECAR_DESIGN.md`、`docs/PROJECT_PLAN.md`、`docs/OPERATIONS.md`。
