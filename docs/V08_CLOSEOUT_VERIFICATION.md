# v0.8 Closeout Verification

日期：2026-09-26。以下为本轮实际运行证据，不是模型行为评测报告。

## 基线

| 项目 | 实际状态 |
| --- | --- |
| HEAD | `9904346 chore(legacy): quarantine obsolete static and fastapi services` |
| 前序 | `5d4f127` Review/SRS；`4d7ca60` Service Identity；`28d86c1` Reminder；`2912a45` Task |
| 开始时修改 | 40 个 tracked 文件，`git diff --stat` 为 2030 additions / 193 deletions；不包含 untracked 源码 |
| 开始时暂存区 | `git diff --cached --stat` 为空 |
| 未跟踪源码 | Object Python/HTTP/tools/Web/client 验收、共享 Data Root 锁、YAML/事务/竞态回归、Object 合同 |
| 已有修复 | YAML 往返、跨进程锁、失败回滚/中断拦截、Git 文件范围、读操作不改 authority、Web 迟到响应隔离、错误传播；通过下表重新验证 |
| 待处理策略 | 新评分倒退、非 Git Review 写入、dirty 自动复用；本轮实施 |
| 旧产物 | `tools/tests/tmp_digest/`、`tmp_gen_queue/`；原测试源码明确把它们用作固定输出并先删除，本轮未执行这种删除 |

没有运行实际工作区的 add/commit/push/reset/clean/stash/checkout。仅测试自己创建的临时 Git 仓库内提交合成数据。未修改正式 Data Root、工作 runtime profile、人工验收数据或真实聊天库；未调用真实外部模型、启动旧服务或修改 ADR。

## 三项策略

1. [Review](../tools/review_flow/review.py) 的 requestId 重放先于新事件时间判断。新评分早于已有最近评分时间返回 `review_time_regression`，HTTP 409；没有 event/SRS/cache/commit 副作用。时间按已有解析器归一到 UTC 秒；同秒按物理行号稳定追加。correction/undo 保留目标时间槽，不重写旧日志；历史乱序不迁移。无新日志时使用 legacy SRS 时间下界。
2. rating/batch/correction 在修改前要求 Git 工作树根等于解析后的 Data Root，否则 `data_root_git_required`，HTTP 409。无生产跳过开关；batch 内部仍可延迟到整批提交。只读查询仍可使用非 Git root。Task/Reminder 提交语义未更改。
3. [local-runtime](../scripts/local-runtime.ps1) 的已有实例复用分支拒绝任一侧 dirty；错误 `AGENT_SERVER_DIRTY_REUSE_REFUSED`，不杀旧服务。dirty 空端口首次启动不被禁止，新实例继续执行完整身份 ready 检查。不同 Runtime/未知身份继续执行原拒绝分支。

红绿证据：Review 新策略测试首次运行 7 项中 3 项因旧行为失败，修复后通过，后补 undo 时间槽用例最终 8 项通过；HTTP 新策略两项先返回错误的 500，修复映射后整体 12 项通过。启动策略测试先捕获 dirty 复用旧行为，再完成 20 项分支验证。

## 回归记录

除注明外从 Core Root 执行。`P` 表示 `python -B tools/tests/` 前缀；`S/W/C/D` 分别表示在 `apps/agent-server`、`apps/web-dashboard`、`packages/agent-client`、`apps/desktop` 下运行 `npm run`。这是命令缩写，不是新脚本。

| 命令 | 退出 | 隔离/结果 |
| --- | ---: | --- |
| `Pcheck_review_closeout_policy.py` | 0 | 临时 Git/非 Git/嵌套 root，8 tests |
| `Pcheck_review_transactions.py` | 0 | 临时 Git，30 tests；并发、提交失败、中断、重放、范围 |
| `Pcheck_review_srs_mvp.py` | 0 | 临时 Git + 损坏日志 fixture，`REVIEW_SRS_MVP_OK` |
| `Pcheck_yaml_roundtrip.py` | 0 | 临时目录，8 tests |
| `Pcheck_object_review_safety.py` | 0 | 临时 Git，20 tests；锁、旧 revision、投影边界及无关暂存隔离 |
| `Pcheck_object_authority_mvp.py` | 0 | 临时 Git/非 Git root，`OBJECT_AUTHORITY_MVP_OK` |
| `Pcheck_v08_closeout.py` | 0 | 清理过环境的临时 Git，1 条完整中文生命周期 |
| `Pcheck_gen_queue_idempotent.py` | 0 | 新临时 fixture；原固定输出保留 |
| `Pcheck_digest_traceability.py` | 0 | 新临时 fixture，references 可解析 |
| `Pcheck_flow_hub_mvp.py` | 0 | 临时 fixture、runtime/context；不读取工作 state |
| `Pcheck_data_root_support.py` | 0 | 临时数据和导出；内部 validate/gen-queue/gen-digest/export-site-data 等通过 |
| `Pcheck_task_flow_mvp.py` | 0 | 临时 Data Root，`TASK_FLOW_MVP_OK` |
| `Pcheck_reminder_mvp.py` | 0 | 两个临时 Data Root，`REMINDER_AUTHORITY_MVP_OK` |
| `S review-api-smoke` | 0 | 临时 Git/SQLite、loopback 随机端口，`REVIEW_API_SMOKE_OK` |
| `S object-api-smoke` | 0 | 临时 Git/SQLite、随机端口，`OBJECT_API_SMOKE_OK` |
| `S review-contract-smoke` | 0 | 12 tests；内存 SQLite、CLI 替身、随机端口 |
| `S task-api-smoke` | 0 | 临时 Data Root/SQLite、随机端口；含中文往返 |
| `S reminder-api-smoke` | 0 | 临时 Data Root/SQLite、随机端口；含 create E2E |
| `S action-recovery-smoke` | 0 | 临时 Data Root/SQLite、随机端口，恢复状态与重复请求 |
| `S audit-api-smoke` | 0 | 临时 Data Root/SQLite、随机端口，脱敏 |
| `W review-race-smoke` | 0 | 17 个真实 React/浏览器用例；API 受控替身、临时浏览器 profile、随机端口 |
| `W review-web-smoke` | 0 | Web 模型层 smoke，不访问 vault |
| `W object-web-smoke` | 0 | Web 模型层 smoke，不访问 vault |
| `W check` | 0 | TypeScript，无数据访问 |
| `W build` | 0 | Vite 本地构建，不启动产品服务 |
| `S check` | 0 | TypeScript |
| `C smoke` | 0 | 客户端替身/合成 payload，`AGENT_CLIENT_SMOKE_OK` |
| `C check` | 0 | TypeScript |
| `D check` | 0 | renderer/main TypeScript，不启动 Electron |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-runtime.smoke.ps1` | 0 | 20 cases；临时 profile/core/data，进程/HTTP 边界为替身 |
| `node --import tsx src/scripts/runtimeIdentitySmoke.ts`（S 目录） | 0 | 清空继承环境后只补进程必要变量，临时 SQLite/随机端口；密钥仅为测试合成值 |
| `node --import tsx src/scripts/serviceIdentitySmoke.ts`（S 目录） | 0 | 同上；实际身份 payload/HTTP，不接模型 |
| `git diff --check` | 0 | 有 CRLF 转换警告，无空白错误 |

所有测试启动的服务器/浏览器/测试子进程由所属测试关闭。没有按端口批量终止进程，也没有改动工作 profile 运行 smoke。仓库无单一统一 `npm test`；上表取自真实 package scripts/测试文件。

联合用例覆盖：中文多行 Fact 创建/读取/render，评分后 Git 干净，正文修改不重置 SRS且出现 contentChanged，删除预检/留痕、Review 历史保留，重复重建/读取不重建已删除对象。每轮只读调用比对 authority bytes、HEAD 和暂存状态。

## 未验证及限制

- local-runtime smoke 验证真实脚本函数，但网络和 Start/Stop 进程边界是替身，不等于真实 `npm run dev`、Electron 窗口或 OS 进程树启动验收。为避免原测试移动真实 profile，该测试改用隔离函数加载；因此 CLI dispatcher/顶层路径初始化、真实端口探测、launcher 与新进程身份的端到端一致性仍未验证。独立 Node 身份测试不能填补这一集成缺口。
- 未调用真实模型、未接触正式数据，不能据此声称 Provider 在线可用或 Agent 行为评测通过。
- 自动崩溃恢复、完整内容版本审核、跨领域统一 Git 提交、历史乱序迁移均未实现；既有恢复底线是不误报成功、不重复接受、明确阻断。
- 评分 undo 保留历史时间槽；不新增历史插入或重算工程。
- Task/Reminder 查询会写可重建缓存，且 list 无 evaluatedAt；首个实验通过冻结合成 fixture处理，不新增产品 API。
- 原有 `tmp_digest/tmp_gen_queue` 保留且排除提交；后续测试已不再复用这些固定路径。构建产物也不属于提交候选。

## 变更与提交建议

本轮生产逻辑仅 Review 两项策略、ActionRoutes 错误映射、local-runtime 复用规则；其余是测试隔离/联合用例与文档。
保留的旧未提交范围仍包含整个 Object Authority 和上一轮安全修复，不应将其误记为本轮从零实现。

自动软件回归已通过；可以准备人工审阅后的小步提交，但真实启动仍是显式未验收项。本轮不替用户暂存或提交。建议按依赖拆分并逐次重新验证：

1. `feat(v0.8): add human-managed object authority`：Object Core/API/client/Web、合同和对应测试，以及它依赖的已有安全修复。
2. `fix(v0.8): enforce review write and runtime reuse policies`：本次时间/Git/dirty 策略、局部合同、错误映射和测试。
3. `docs: prepare reproducible read-only agent experiments`：CURRENT_STATE、实验提案、此验收记录和 README 入口。

先人工审查实际 diff；混在同一文件的不同阶段修改需按依赖处理，不能直接把全目录无差别纳入提交。真实 vault、聊天数据库、runtime profile 和测试残留均排除。
