# 已知问题与验收缺口

整理日期：2026-10-21。以下保留既有证据及本轮审阅结论；本轮软件回归见[当前状态](status.md)，不能据此抹去未覆盖的验收缺口。

| 项目 | 影响与状态 | 后续验收依据 |
| --- | --- | --- |
| Mobile 横屏布局 | 浏览器 852×393 下发送区越界；真机横屏未验收，不能宣称布局全通过 | [P60 已知缺陷](../docs/verification/MOBILE_COMPATIBILITY_P60PRO.md)；保留原断言，后续需实际布局证据 |
| Mobile 生成中后台恢复 | 可进入“结果待核对”，不自动重发；不是无损续流，物理断网仍未测 | [P60 恢复记录](../docs/verification/MOBILE_COMPATIBILITY_P60PRO.md)；按同一合成测试实例（fixture）核查请求与历史 |
| 真实启动链路 | 启动脚本 smoke 使用合成实例，不能证明真实启动器、进程与身份链路端到端通过 | [v0.8 未验证项](../docs/V08_CLOSEOUT_VERIFICATION.md)；另行安排受控端到端验收 |
| 对象与复习恢复 | 完整内容版本审核、自动崩溃恢复尚未实现；内容变化不自动重置 SRS | [Object](../docs/OBJECT_AUTHORITY_CONTRACT.md)、[Review](../docs/REVIEW_SRS_CONTRACT.md)、[历史验收](../docs/V08_CLOSEOUT_VERIFICATION.md) |
| Agent 能力 | 只读实验尚是提案，真实模型行为不能由软件 smoke 代替验收 | [实验提案](../docs/experiments/READONLY_AGENT_V1.md) |

文档仍有待人工核对的漂移：ADR 状态为 Proposed；部分 package 版本标签仍为 v0.6；治理中的计划命令及跨领域 Git 策略与实现描述未完全对齐。见[决策与边界](decisions.md)。本次不修改这些规则，也不把旧文档的“通过”转写为当前通过。

## Object 权限分级待对齐

Object update/delete 实现统一标记为 L2，但其中的 trusted 迁移与删除按治理应属于 L3。当前内置 LLM 无工具调用入口，router 拒绝 Agent 调用；尚未证实自动越权，不能将标记差异直接写成已发生越权。

`confirmed` 字段只是确认信号，不是身份认证。不可直接把实现标记改为 L3，以免 router 全部拒绝相关操作；需独立治理设计确认，明确人工入口、权限判定与路由语义。本轮不修功能、不调整治理规则。参照[项目宪法](../AGENTS.md)、[Object 合同](../docs/OBJECT_AUTHORITY_CONTRACT.md)及[Agent 权限边界](../docs/AGENT_AUTHORITY_BOUNDARY.md)。
