# 当前状态

文档盘点日期：2026-10-21。本页是主人状态摘要，不是发布声明或测试报告。

## 本次盘点快照

代码盘点基线：`da260d4`，已推送至 `origin/main`。此前积累的 6 个提交已推送，新工作按工具与测试隔离（`283b899`）、Core Object／Review（`d854bb9`）、双端 UI（`7aac701`）、移动兼容壳（`da260d4`）分别提交。本文随文档整理单独提交；后续实际版本以 `git log` 为准。已推送不等于完整产品发布或全部人工验收完成。

| 范围 | 盘点结论 | 证据 |
| --- | --- | --- |
| 已提交基线 | Review/SRS 与旧静态站、FastAPI 隔离已有提交 | [v0.8 历史验收](../docs/V08_CLOSEOUT_VERIFICATION.md)、[隔离规则](../docs/LEGACY_SERVICE_QUARANTINE.md) |
| Object Authority | Core Object／Review 已随 `d854bb9` 推送，双端 UI 随 `7aac701` 推送 | [Object 合同](../docs/OBJECT_AUTHORITY_CONTRACT.md)、[Web 说明](../apps/web-dashboard/README.md) |
| 中文优先 UI | Web、Desktop 支持中文／英文切换，仅保存语言偏好；已随 `7aac701` 推送 | [Web](../apps/web-dashboard/README.md)、[Desktop](../apps/desktop/README.md) |
| Mobile | 兼容性测试壳已随 `da260d4` 推送；2026-10-05 有 P60 Pro 部分真机基线，不是完整兼容通过 | [测试壳说明](../apps/mobile/README.md)、[P60 记录](../docs/verification/MOBILE_COMPATIBILITY_P60PRO.md) |
| 只读 Agent 实验 | 提案，尚未实现或运行；不是已验收的通用自主 Agent | [实验提案](../docs/experiments/READONLY_AGENT_V1.md) |

## 验证边界

验证日期：2026-10-21。以下为本轮软件验证范围与结果，不包含完整人工验收。具体命令及环境限制见[本轮验证记录](../docs/verification/WORKTREE_CLOSEOUT_2026-10-21.md)。

| 范围 | 本轮验证结果 |
| --- | --- |
| 共享客户端 | build、smoke 通过 |
| 类型检查 | Server、Desktop、Web、Mobile check 通过 |
| Web | smoke、object、review、locale 及 build 通过 |
| Desktop | smoke、restart 及 build 通过 |
| Mobile | test 71/71，宿主环境原样重跑通过；build 通过，bootstrap classic-script warning 为预期提示 |
| Server | review-contract 12/12、Object API、Review API、mobile-compat 11/11 通过 |
| Python | closeout、YAML、review transactions、object review safety 合计 67/67 |
| Python 补充 | ObjectAuthorityMVP、ReviewSRSMVP、DataRoot、Digest、FlowHub、Queue、Legacy 共 7 个脚本通过 |
| local-runtime | smoke 全部通过 |

初次运行受沙箱执行策略、Git 仓库所有者检查和测试隔离配置影响；在不绕过策略、不改变业务代码的前提下重跑通过。以上不替代真机横屏、真实模型行为或真实启动链路的独立验收。

现有[已知问题](known-issues.md)不能仅凭上述软件回归标为解决；历史验收仍只证明其注明日期与范围。后续开发范围见[待裁决事项](decisions.md)，本轮未新增产品功能。

[2026-09-26 状态快照](../docs/CURRENT_STATE.md)保留原文供追溯；合同细节从[工程索引](../docs/README.md)进入，不在本页复制。
