# Worktree Closeout Verification

日期：2026-10-21，Asia/Shanghai。范围：既有工作分组提交、推送与文档分层，不新增产品功能。代码结果对应 `da260d4`；本文及手册随后单独提交。

## Repository State

开始时 `main` 领先 `origin/main` 6 个提交，74 个已跟踪文件修改，34 个未跟踪条目（目录按条目计）。`git fetch origin` 后确认无分叉；原 6 个提交保留历史，快进推送至 `9904346`。

| 新提交 | 范围 |
| --- | --- |
| `283b899` | 本地实例复用门禁、隔离回归、忽略旧测试输出 |
| `d854bb9` | Object Authority、Review 安全修正、共享客户端、契约与测试 |
| `7aac701` | 相互依赖的 Object GUI、Web/Desktop 中文优先 UI 与测试 |
| `da260d4` | 实验移动壳、隔离测试注入、Android 工程和历史 P60 基线 |

四组均已推送至 `origin/main`；没有强推、reset、覆盖旧改动或部署服务。混合文件只在暂存区分离 Object 接线与移动测试注入，工作区业务文件未重写。旧临时测试输出保留本地并忽略；APK、SDK、本地配置、密钥、SQLite 和测试截图不纳入提交。原有生成模板的空白格式未为本次整理批量重排。

## Isolation

- Python/API 回归使用测试自建临时 Data Root、Git 仓库与 SQLite；没有读取或改写正式 vault。
- Git 相关回归清除继承的 `GIT_*` / `PKOS_*` 覆盖，禁用系统及全局 Git 配置；保留测试自建 hook 用于验证提交失败回滚。
- API 测试使用短生命周期 loopback listener 和模拟数据，结束后自行关闭；没有启动长期驻留服务、读取私人 runtime profile、连接手机或调用真实模型。
- `validate` 显式指定代码仓库的示例数据根，只读校验 8 个示例文件，不能作为正式 vault 的健康证明。

## Commands And Results

以下命令从仓库根目录执行；脚本本身的临时目录隔离仍然有效。

| 命令 | 本轮结果 |
| --- | --- |
| `python -B -m tools.pkos --data-root <CORE_ROOT> validate` | 8/8 通过；`<CORE_ROOT>` 为实际代码仓库绝对路径 |
| `python -B -m unittest tools.tests.check_yaml_roundtrip tools.tests.check_review_transactions tools.tests.check_review_closeout_policy tools.tests.check_object_review_safety tools.tests.check_v08_closeout` | 67/67 通过 |
| `python -B tools/tests/check_object_authority_mvp.py` | `OBJECT_AUTHORITY_MVP_OK` |
| `python -B tools/tests/check_review_srs_mvp.py` | `REVIEW_SRS_MVP_OK` |
| `python -B tools/tests/check_data_root_support.py` | PASS，覆盖 CLI 数据根隔离与派生导出 |
| `python -B tools/tests/check_digest_traceability.py` | PASS，摘要引用可解析 |
| `python -B tools/tests/check_flow_hub_mvp.py` | PASS，派生视图与 bounded context |
| `python -B tools/tests/check_gen_queue_idempotent.py` | PASS，首次补齐后队列生成幂等 |
| `python -B tools/tests/check_legacy_quarantine.py` | `LEGACY_QUARANTINE_OK` |
| `npm.cmd --prefix packages/agent-client run build` / `run smoke` | 构建通过，`AGENT_CLIENT_SMOKE_OK` |
| `npm.cmd --prefix apps/agent-server run check` | 类型检查通过 |
| `npm.cmd --prefix apps/agent-server run review-contract-smoke` | 12/12 通过 |
| `npm.cmd --prefix apps/agent-server run object-api-smoke` / `run review-api-smoke` | 两项 API smoke 通过 |
| `npm.cmd --prefix apps/agent-server run mobile-compat-smoke` | 11/11 通过 |
| `npm.cmd --prefix apps/web-dashboard run check` / `run build` | 通过 |
| `npm.cmd --prefix apps/web-dashboard run smoke` / `run object-web-smoke` / `run review-web-smoke` / `run locale-smoke` | 四项 smoke 通过 |
| `npm.cmd --prefix apps/desktop run check` / `run build` | 通过 |
| `npm.cmd --prefix apps/desktop run smoke` / `run chat-restart-restore-smoke` | 双语、会话隔离、页面恢复、Enter、时区、滚动、通知与重启恢复 smoke 通过 |
| `npm.cmd --prefix apps/mobile run check` / `run build` | 通过；保留独立经典 `bootstrap.js` 的 Vite 提示 |
| `npm.cmd --prefix apps/mobile test` | 71/71 通过 |
| `PowerShell -NoProfile -File scripts/local-runtime.smoke.ps1` | `LOCAL_RUNTIME_SMOKE_OK`；网络与进程启动为合成测试 |

这些是当前工作区的组合回归，不声称对每一个历史提交单独完成全套测试。既有软件回归也不能替代真实操作和模型行为验收。

## Initial Failures And Retests

1. 沙箱 PowerShell 拒绝工具链与启动脚本测试。经批准在宿主用户环境原样重跑后通过；没有修改执行策略或使用 Bypass。
2. 首次 Python 组合回归 66/67：本轮测试环境错误地禁用了所有 Git hooks，令故障注入测试不能触发。移除这一测试环境覆盖、仍隔离全局配置后，完整 67/67 通过；业务与测试源码未改。
3. 禁用全局 Git 配置后，沙箱用户被代码仓库的所有者检查拒绝。改由宿主用户运行隔离测试通过；未添加 `safe.directory=*` 或更改全局配置。

## Remaining Limits

- 未重跑 Android APK 构建、手机验收、浏览器横屏测试、真实 Electron 窗口或真实模型。P60 历史记录只证明 2026-10-05 的部分基线。
- Mobile 852x393 横屏发送区越界仍是已知失败；生成中切后台可能保持结果待核对，物理断网恢复未验收。原断言未跳过或削弱。
- Object update/delete 的统一 L2 标记与 trusted 迁移、删除应属 L3 的治理分类尚未对齐。当前模型调用链没有执行这些工具；固定路由中的确认字段不是身份认证，不可无认证开放到局域网。
- ADR 接受状态、历史计划和领域 Git 策略的差异留待人工裁决，本轮未修改治理规则。

后续入口：[工程索引](../README.md)、[主人已知问题](../../handbook/known-issues.md)。
