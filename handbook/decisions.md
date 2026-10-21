# 决策与边界

更新日期：2026-10-21。本页是决策导航，不是新 ADR，不赋予 Agent 新权限。

## 当前方向

- 以 PKOS-native Agent Server、Python Core、Web／Desktop 为当前实现主线；理由见[Runtime ADR](../docs/ADR-000X-PKOS_NATIVE_AGENT_RUNTIME.md)。该 ADR 仍标为 **Proposed**，实现已采用不等于文档获正式批准。
- 知识与业务权威保留在 Git 可审计文本中；SQLite 保存聊天及运行记录，不成为知识权威，也不能因此视为可随意丢弃的缓存。见[项目宪法](../AGENTS.md)、[Data Root 边界](../docs/DATA_ROOT_AND_VAULT.md)与[历史数据分类](../docs/CURRENT_STATE.md)。
- 旧静态站与 FastAPI 只作历史只读用途；Moonlolo／OpenClaw／WeChat 是历史集成路线，不是默认启动链路。见[隔离规则](../docs/LEGACY_SERVICE_QUARANTINE.md)。
- Mobile 先验证隔离测试壳，不代表完整手机客户端、多端同步或远程生产部署。见[设计草案](../docs/MOBILE_CLIENT_DESIGN.md)与[后续真机记录](../docs/verification/MOBILE_COMPATIBILITY_P60PRO.md)。

## 不做与待裁决

不恢复公开博客发布链路，不允许 Agent 自动 trusted、事实裁定或删除对象。权限与人工确认要求以[项目宪法](../AGENTS.md)和[Agent 边界](../docs/AGENT_AUTHORITY_BOUNDARY.md)为准。

待维护者确认：ADR 是否正式接受、下一轮只读实验范围、Mobile 中断恢复的后续优先级，以及治理与实现之间的权限分级和领域 Git 策略差异。当前提交拆分已落实，见[状态摘要](status.md)；不能通过摘要自行接受 ADR 或放宽治理要求。

本次仅组织文档入口：合同原路径保留，历史快照不覆盖；[工程索引](../docs/README.md)负责分类与维护约定。
