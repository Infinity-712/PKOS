# Engineering Documentation

工程与 Agent 协作入口。主人阅读从[中文手册](../handbook/README.md)开始；当前进展见[状态摘要](../handbook/status.md)，不要把历史计划当作当前能力。

## 阅读顺序与来源

先读[AGENTS](../AGENTS.md)，再读相关领域合同、实现与测试，最后读日期化验收记录。合同说明应遵守的行为，实现与测试说明当前证据；若不一致，记录差异并请维护者裁决，不用实现反向覆盖治理。手册仅摘要并链接，不成为第二套合同。

## 治理与领域合同

- 权限与数据：[Agent Authority](AGENT_AUTHORITY_BOUNDARY.md)、[Data Root / Vault](DATA_ROOT_AND_VAULT.md)。
- 人工管理：[Object Authority](OBJECT_AUTHORITY_CONTRACT.md)、[Review / SRS](REVIEW_SRS_CONTRACT.md)、[Task](TASK_FLOW_CONTRACT.md)、[Reminder](REMINDER_CONTRACT.md)、[Inbox Review](INBOX_REVIEW_CONTRACT.md)。提交进展统一见[状态摘要](../handbook/status.md)，此处不维护平行提交快照。
- 派生层：[Flow Hub](FLOW_HUB_CONTRACT.md)、[Agent Context](AGENT_CONTEXT_CONTRACT.md)、[Digest](DIGEST_RULES.md)。Agent Context 含旧设计与后续扩展，不能将全部设计项等同于已实现。
- 实例与兼容：[Service Identity](SERVICE_IDENTITY_CONTRACT.md)、[Legacy Quarantine](LEGACY_SERVICE_QUARANTINE.md)、[Site Export](SITE_EXPORT_RULES.md)。隔离规则仍有效；静态导出格式不代表当前主 GUI。

## 操作与实现入口

- [Operations](OPERATIONS.md)：工程操作、领域命令与故障处理；主人最小启动流程见[如何运行](../handbook/how-to-run.md)。
- [Agent Server](../apps/agent-server/README.md)、[共享客户端](../packages/agent-client/README.md)、[Web](../apps/web-dashboard/README.md)、[Desktop](../apps/desktop/README.md)：包级命令、接口与约束。
- [Mobile 测试壳](../apps/mobile/README.md)：隔离兼容验证，不是正式移动产品部署。

## 设计、实验与验收

- [Native Runtime ADR](ADR-000X-PKOS_NATIVE_AGENT_RUNTIME.md)：仍为 Proposed，保留原路径与状态，待人工裁决。
- [RAG Sidecar](RAG_SIDECAR_DESIGN.md)、[Mobile 设计](MOBILE_CLIENT_DESIGN.md)：设计，不作为完成证据。
- [只读 Agent V1](experiments/READONLY_AGENT_V1.md)：未实施实验提案；[双语 UI 计划](superpowers/plans/2026-09-26-bilingual-ui.md)：实施计划，不是回归结果。
- [v0.8 Closeout](V08_CLOSEOUT_VERIFICATION.md)、[P60 Pro 基线](verification/MOBILE_COMPATIBILITY_P60PRO.md)：按各自日期、代码、环境与范围解读，不等于当前工作区全量通过。
- [2026-10-21 工作树整理验证](verification/WORKTREE_CLOSEOUT_2026-10-21.md)：本次提交边界、实际回归命令、环境限制与未测范围。
- [2026-09-26 Current State](CURRENT_STATE.md)：保留原文的日期快照，不再维护平行状态摘要。

## 历史路线与集成

以下保留原位置供追溯，不作为默认开发路线或启动说明；其中仍适用的安全边界不因归类历史而失效。

- [Project Plan](PROJECT_PLAN.md)、[Architecture v0.5](ARCHITECTURE_V0.5.md)：历史里程碑与旧规划。
- [Moonlolo Role](MOONLOLO_ROLE_AND_BOUNDARY.md)、[Integration Plan](MOONLOLO_INTEGRATION_PLAN.md)、[Context-aware Reply](MOONLOLO_CONTEXT_AWARE_REPLY_MVP.md)：历史角色设计与桥接准备。
- [Server Deployment](SERVER_DEPLOYMENT.md)、[Moonlolo Adapter](../integrations/moonlolo/README.md)、[2026-07-01 Ingress](deployments/MOONLOLO_INGRESS_2026-07-01.md)：历史部署资料；过去的生产验证不代表当前在线状态。

## 文档维护与协作

1. 变更前检查 Git 工作区及适用 AGENTS，明确改动归属与负责范围；不覆盖他人改动。治理与权限调整需单独人工确认，不能混入文档整理。
2. 行为变化时核对对应合同、包 README 和测试；保留已引用的合同路径。发现不一致，写明风险与待裁决项，不擅自降低约束。
3. 状态区分已提交、工作区实现、提案、未验证。状态摘要附核验日期、提交快照及证据；提交后重新核对，不把旧工作区描述当成永久状态。
4. 验收记录写明实际命令、日期、环境、结果与未测范围。未运行就写未运行；测试使用经批准的隔离数据，不读取私人配置或正式数据来补文档。
5. 新证据写入对应工程记录，再更新手册的短摘要和链接。历史记录保留原日期与结论，使用顶部后续链接说明变化；不复制多份规则或测试清单。
6. 交付前检查新增本地链接、差异范围与换行。不要提交密钥、个人绝对路径、真实数据或固定 PID 作为当前状态；不擅自 stage、commit 或启动服务。

本次整理日期：2026-10-21；[实际验证记录](verification/WORKTREE_CLOSEOUT_2026-10-21.md)与[主人状态摘要](../handbook/status.md)分别承担工程证据和简明进度说明，未覆盖的验收项仍保留。
