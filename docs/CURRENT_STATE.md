# PKOS: Current State

> 历史快照导航（2026-10-21）：以下保留 2026-09-26 原文，不代表今日全部工作区或测试状态。最新主人摘要见[当前状态](../handbook/status.md)，工程资料见[文档索引](README.md)。后续双语 UI 与 Mobile 进展请从新入口查阅。

核验日期：2026-09-26。本页是重新进入项目的短入口，不替代领域合同。

## 基线与方向

- 已提交 HEAD：`9904346`，旧静态站/FastAPI 隔离；前一提交 `5d4f127` 是 Review/SRS v0.8-alpha。
- 未提交：v0.8-beta Object Authority 的 Python、Agent Server、共享客户端、Web 页面、合同与测试，以及 YAML/事务/并发/错误传播/页面竞态修复。
- 本次 closeout：评分时间不倒退、Review 写入要求精确 Data Root Git 仓库、dirty 开发状态不自动复用已有服务。没有自动提交。
- 下一阶段优先研究 Agent Systems / Harness / Context Engineering 的可复现实验，不继续堆叠知识管理产品功能。

## 架构与真实能力

```text
Web Dashboard / Electron Desktop
  -> Agent Server (TS/Node, localhost)
  -> Python Core (固定 CLI)
  -> PKOS_DATA_ROOT (独立数据仓库)
```

已实现的基础：对象校验、队列、Digest、派生导出、Flow Hub、Inbox/State append、Inbox Review、人工 Task/Reminder、人工 Review/SRS、Object list/get/render/create/revision-update/delete-preflight/tombstone、聊天与 Provider runtime。
代码入口：[CLI](../tools/pkos.py)、[固定动作](../apps/agent-server/src/actions/ActionRoutes.ts)、[Objects](../tools/object_flow/service.py)、[Review](../tools/review_flow/review.py)。
Web 的 Objects/Review 操作有身份和请求版本隔离；Desktop 不等于拥有所有 Web 管理能力。

当前不是通用自主 Agent：只读实验 tool loop、评测集、模型行为验收尚未实现；RAG 和完整内容版本审核仍属设计方向。
OpenClaw/Moonlolo/WeChat 是历史集成经验，不是新主线。旧 UI/FastAPI 保持隔离，不用于正式写入或默认启动。

## 四种数据

| 类别 | 例子 | 保留原则 |
| --- | --- | --- |
| 知识/业务事实 | objects、tasks、reminders、inbox/state、review JSONL | Git/file authority；既有 append-only 日志不可原地重写 |
| 原始运行记录 | SQLite 中的聊天消息、generation、未完成 action 请求、Audit | 不属于 trusted knowledge，但不是可随意丢弃的缓存；备份/恢复需保留 |
| 可重建投影 | runtime/flow、runtime/review、对象索引、Task/Reminder current、agent_context | 来源仍是文件；删除投影不等于删除事实 |
| 临时缓存与诊断 | 构建输出、隔离浏览器 profile、测试临时目录、诊断日志 | 按归属和保留规则清理；不能只按 `runtime/` 路径判断可删除 |

`object.srs` 暂时仍是写在对象文件内的兼容投影，不是第二套评分 authority。
`PKOS_DATA_ROOT` 只改变数据位置；tools/schema/docs/AGENTS 始终来自 Core。
`confirmed:true` 是 UI 明确确认信号，不是身份认证，也不能证明 Agent 获得某个工具权限。

## 先读这些

1. [AGENTS](../AGENTS.md)：人类裁决和 authority 边界。
2. [Object Authority](OBJECT_AUTHORITY_CONTRACT.md)、[Review/SRS](REVIEW_SRS_CONTRACT.md)：版本、删除、评分与纠正。
3. [Service Identity](SERVICE_IDENTITY_CONTRACT.md)、[Operations](OPERATIONS.md)：正确启动和实例身份。
4. [Task](TASK_FLOW_CONTRACT.md)、[Reminder](REMINDER_CONTRACT.md)：只读实验的数据语义。
5. [只读实验提案](experiments/READONLY_AGENT_V1.md)：下一轮实现边界。

## 启动与最小验证

唯一推荐启动入口是 `scripts/local-runtime.ps1`，使用维护者已配置的本地 profile；不要为了 smoke 改正式 profile。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-runtime.ps1 validate
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-runtime.ps1 start
```

端口空闲时允许 dirty 首次启动，并验证新实例 Runtime/Data Root/build/API/schema/capabilities；端口已有服务且任一侧 dirty 时拒绝复用、不自动终止。维护者核验进程归属后再显式 stop/start。
常规默认端口是 Agent Server 8790、Web 5173；实际值以已配置 profile 为准。不要使用旧 8000/8787 服务代替。

```powershell
python -B tools/tests/check_review_closeout_policy.py
python -B tools/tests/check_v08_closeout.py
python -B tools/tests/check_data_root_support.py
npm --prefix apps/agent-server run review-contract-smoke
npm --prefix apps/web-dashboard run review-race-smoke
```

以上使用临时数据或内存替身；Data Root 测试还覆盖 validate/gen-queue/gen-digest/export-site-data。
完整 closeout 命令及结果见 [验收记录](V08_CLOSEOUT_VERIFICATION.md)。软件 smoke 通过不等于 Agent 行为已经评测通过。

## 已知限制与不做项

- 新评分按已有时间线追加，精确重放优先；相同 UTC 秒按 JSONL 行号排序。已有乱序历史不自动迁移，correction/undo 保留目标时间槽，详见 Review 合同。
- Review/Object 要求正式 Git 写入；Task/Reminder、其他 append 写入领域的自动 Git 策略仍有差异，本轮不统一改造。
- SRS 内容变化只提示 `contentChangedSinceLastReview`，不自动重置；完整版本审核、迁移理由及状态审核记录仍待设计。
- 普通失败有事务回滚，未完成事件会阻断错误重放；自动崩溃恢复未实现。不能按 staged 状态猜测归属或删除已接受事件。
- 不引入模型写 authority、自动 trusted、任务自动生成、新框架、RAG 或新产品功能。
- 本轮不接真实模型；未来实验仅限隔离合成 fixture，生产 Audit 脱敏规则不放宽。

## 提交边界

候选是上述 v0.8 源码、合同和测试，不是整个工作区无差别 `git add`。
`tools/tests/tmp_digest/` 与 `tmp_gen_queue/` 是旧测试固定输出路径的残留，当前保留；本轮已将对应测试改为独立临时目录。
这些残留、runtime profile、真实聊天数据库和任何正式数据都不属于提交候选。
