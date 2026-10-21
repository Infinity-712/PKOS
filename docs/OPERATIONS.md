# PKOS Operations

阅读导航：[主人启动手册](../handbook/how-to-run.md) / [工程索引](README.md)。本文保留完整工程操作说明；当前进度与未验收项见[状态摘要](../handbook/status.md)。

本文件记录当前主线的本地运行流程。PKOS 当前只作为私密个人知识与能动性系统，不维护公开内容链路。

## Core Root / Data Root

未设置 `PKOS_DATA_ROOT` 时，data root 默认为当前仓库根目录。

设置 `PKOS_DATA_ROOT` 后，`objects/`、`review/`、`digests/`、`inbox/`、`state/`、`runtime/` 都从 data root 读取或写入；代码、docs、schema、`AGENTS.md`、`site-private/` 仍属于 core root。

PowerShell：

```powershell
$env:PKOS_DATA_ROOT="E:\Creation\PKOS-Vault"
python -m tools.pkos gen-flow
python -m tools.pkos export-agent-context
Remove-Item Env:\PKOS_DATA_ROOT
```

Ubuntu：

```bash
mkdir -p /home/infinity/apps/pkos-core
mkdir -p /home/infinity/data/pkos-vault

cd /home/infinity/apps/pkos-core
PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python -m tools.pkos inbox-append --capture-type note --content "server test"
PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python -m tools.pkos state-append --energy low --mood calm --body normal
PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python -m tools.pkos gen-flow
PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python -m tools.pkos export-agent-context
```

长期推荐结构：

```text
pkos-core   # public-safe: tools, docs, schema, demo
pkos-vault  # private: objects, inbox, state, review logs, digests, runtime
```

## Local Agent Runtime Identity

Recommended Agent Server startup:

```powershell
powershell -NoProfile -File scripts/local-runtime.ps1 validate
powershell -NoProfile -File scripts/local-runtime.ps1 start
```

Use an existing, verified profile. Do not run `configure` as part of routine startup: it overwrites the local profile. If execution policy blocks the script, stop and ask the user or administrator to review the applicable policy; do not bypass it.

`local-runtime.ps1 start` reuses an existing listener only when all identity
checks match:

- runtime fingerprint;
- service build fingerprint;
- API contract version;
- declared capability manifest;
- SQLite schema compatibility.

Both the current source and existing instance must also be clean for reuse.
If either is dirty, start refuses automatic reuse and asks for an explicit
restart; it does not terminate the listener. Dirty source may start on a free
port, and that new instance still undergoes the full readiness identity check.
Use isolated test profiles for smoke; do not reconfigure the working profile.

If the data/runtime instance differs, the script returns
`AGENT_SERVER_RUNTIME_MISMATCH`.

If the same runtime is served by an old Agent Server build, a server missing a
required capability, or an incompatible schema, the script returns
`AGENT_SERVER_BUILD_MISMATCH`.

The script does not auto-kill stale or unknown listeners. Stop the process
manually after inspecting it.

Useful checks:

```powershell
powershell -NoProfile -File scripts/local-runtime.ps1 show
curl http://127.0.0.1:8790/health
curl http://127.0.0.1:8790/api/runtime-info
```

See `docs/SERVICE_IDENTITY_CONTRACT.md`.

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

4. 生成 Flow Hub 运行视图：
   ```bash
   python -m tools.pkos gen-flow
   ```

5. 导出月洛洛上下文包：
   ```bash
   python -m tools.pkos export-agent-context
   ```

6. 追加 Inbox 捕获：
   ```bash
   python -m tools.pkos inbox-append --capture-type note --content "..."
   ```

7. 追加当前状态快照：
   ```bash
   python -m tools.pkos state-append --energy low --mood anxious --body chest_tight
   ```

`inbox/items.jsonl` 与 `state/snapshots.jsonl` 是 local operational logs，当前默认被 Git 忽略。`runtime/` 仍是 derived cache，可删除并重新生成。

## Legacy 静态站预览

`site-private/dashboard` 是历史只读界面，只能查看 `export-site-data` 生成的派生 JSON。它不再维护，不支持 authority 写回，也不是当前主 GUI。

```bash
python -m tools.pkos export-site-data --profile demo
python -m http.server 8000
```

打开：

- `http://localhost:8000/site-private/dashboard/index.html`

不要使用 `8000` 对正式 `PKOS_DATA_ROOT` 做人工 Review/SRS 写回。当前主界面由 `scripts/local-runtime.ps1 start` 启动的 Web Dashboard / Desktop 提供。

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

## Review/SRS 写回

当前 Review/SRS authority 写回只能通过主线链路：

```text
Web Dashboard / Desktop -> 127.0.0.1:8790 Agent Server -> Python Core -> PKOS_DATA_ROOT
```

旧 FastAPI `python -m tools.pkos serve --port 8787` 已隔离为 Legacy read-only。旧 `/api/review/ratings:batch` 永久返回 `410 legacy_writeback_disabled`，不会追加 `review/logs/`、不会修改 `object.srs`、不会 Git commit。

CLI 人工写回仍可用于验收与恢复：

```bash
python -m tools.pkos review-rate --object-id fact.demo --rating 4 --reviewed-at "2026-07-20T00:00:00Z" --actor human --request-id "review-demo-1" --json
```

## Object Authority

Object editing is a human workflow through the current Agent Runtime path:

```text
Web Dashboard -> 127.0.0.1:8790 Agent Server -> Python Core -> PKOS_DATA_ROOT
```

The old static site on `8000` and the old FastAPI service on `8787` are not
object editors and must not be pointed at the formal data root for mutation.

Useful recovery/verification commands:

```bash
python -m tools.pkos object-types --json
python -m tools.pkos object-list --json
python -m tools.pkos object-get --object-id fact.demo --json
python -m tools.pkos object-render --object-id fact.demo --json
python -m tools.pkos object-rebuild --json
```

Mutations require a clean Git data root, `confirmed`, `requestId`, and exact
revision where applicable:

```bash
python -m tools.pkos object-create --payload-json '{"id":"fact.demo","type":"fact","status":"parsed","title":"Demo","summary":"Demo","content":"Demo","source":["manual"],"anchors":[]}' --request-id object-create-demo --confirmed --actor human --json
python -m tools.pkos object-update --object-id fact.demo --base-revision <fileRevisionSha256> --patch-json '{"summary":"Updated"}' --request-id object-update-demo --confirmed --actor human --json
python -m tools.pkos object-delete-preflight --object-id fact.demo --base-revision <fileRevisionSha256> --json
python -m tools.pkos object-delete --object-id fact.demo --base-revision <fileRevisionSha256> --typed-object-id fact.demo --reason "cleanup" --request-id object-delete-demo --confirmed --actor human --json
```

Rollback uses data-root Git, not core-root Git:

```bash
git -C <PKOS_DATA_ROOT> log --oneline -n 5
git -C <PKOS_DATA_ROOT> revert <commit_hash>
python -m tools.pkos --data-root <PKOS_DATA_ROOT> object-rebuild --json
python -m tools.pkos --data-root <PKOS_DATA_ROOT> review-rebuild --json
```

See `docs/OBJECT_AUTHORITY_CONTRACT.md`.

## 回滚

```bash
git log --oneline -n 5
git revert <commit_hash>
```

## Moonlolo Bridge 检查与调用

这些命令用于本地适配层或 Moonlolo 通过 subprocess 调用 PKOS。`--json` 与 `--print` 模式的 stdout 是纯 JSON，适合 Node `JSON.parse`。

```bash
python -m tools.pkos paths
python -m tools.pkos paths --json
python -m tools.pkos doctor
python -m tools.pkos doctor --json
python -m tools.pkos inbox-append --capture-type note --content "..." --json
python -m tools.pkos state-append --energy low --mood anxious --body chest_tight --json
python -m tools.pkos export-agent-context --print
```

外部 vault 模式示例：

```bash
PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python -m tools.pkos doctor --json
PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python -m tools.pkos export-agent-context --print
PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python -m tools.pkos inbox-append --capture-type note --content "moonlolo note" --source moonlolo --json
PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python -m tools.pkos state-append --energy low --mood calm --body tired --source moonlolo --json
```

Moonlolo 当前只允许读取 bounded Agent Context Pack、追加 Inbox、追加 Current State，不允许直接改 `objects/`、`docs/`、schema、`AGENTS.md` 或执行 trusted 迁移。

服务器 smoke test：

```bash
bash scripts/server_smoke_test.sh
```

显式指定路径：

```bash
PKOS_CORE_ROOT=/home/infinity/apps/pkos-core PKOS_DATA_ROOT=/home/infinity/data/pkos-vault bash scripts/server_smoke_test.sh
```

Moonlolo Node adapter 示例位于：

```text
integrations/moonlolo/pkos_client.mjs
```

该示例只使用 Node `spawnSync` 参数数组调用白名单 PKOS 命令，不直接读写 PKOS 文件。

## 常见错误

- `401 invalid token`：`X-PKOS-Token` 与 `PKOS_WRITE_TOKEN` 不匹配。
- `403 localhost only`：请求未从本机回环地址进入。
- `404 object not found`：对象 id 不存在。
- `type not writable: creative`：creative 不参与默认 SRS 写回。
- `410 legacy_writeback_disabled`：调用了已隔离的旧 FastAPI 写接口；请改用 `8790` Agent Server 或当前 Python Review CLI。
