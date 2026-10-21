# 如何运行

以下命令在仓库根目录执行。2026-10-21 已核对[启动脚本源码](../scripts/local-runtime.ps1)；本轮未通过这些启动命令实际启服，也未读取私人 profile 或正式数据。软件测试范围见[当前状态](status.md)。

## 使用已有配置

先由维护者确认配置指向预期 Data Root，并确认当前 shell 的 `PKOS_CORE_ROOT`、`PKOS_DATA_ROOT` 没有意外覆盖配置。脚本根目录选择优先级为：命令参数、环境变量、profile；Core Root 最后可推断为仓库，Data Root 缺失会报错。

```powershell
PowerShell -NoProfile -File scripts/local-runtime.ps1 validate
PowerShell -NoProfile -File scripts/local-runtime.ps1 start
```

`validate` 检查运行配置，不等于 `pkos validate` 或产品回归测试。`start` 启动 Agent Server，并按 profile 决定是否启动 Web 与 Desktop。默认端口为 8790、5173，实际以配置和启动结果为准。

若执行策略阻止脚本运行，请停止并由用户或管理员核对脚本来源、适用策略及授权，不通过绕过执行策略继续运行。

结束使用时，先确认实例归属，再执行：

```powershell
PowerShell -NoProfile -File scripts/local-runtime.ps1 stop
```

不要按旧日志中的 PID 杀进程。身份不匹配或 dirty 实例复用被拒绝时，先核查归属，不强占端口、不绕过检查。详见[Service Identity](../docs/SERVICE_IDENTITY_CONTRACT.md)与[运维说明](../docs/OPERATIONS.md)。

## 首次配置与诊断

脚本支持 `configure / show / validate / start / stop`，参数为 `-DataRoot`、`-CoreRoot`、`-ProfileName`。`configure` 要求显式 Data Root，会创建目录并写入或覆盖本地 profile；已有配置不要为测试重新配置。`-ProfileName` 是配置名称，不是多个 profile 文件的选择器。

`show` 会输出本机路径及身份信息，仅供本地核对，不原样贴进文档。密钥只交给服务进程环境，不写入手册、profile 或聊天。首次环境准备与依赖见 [Agent Server](../apps/agent-server/README.md)、[Web](../apps/web-dashboard/README.md)、[Desktop](../apps/desktop/README.md)。

## Mobile 单独运行

Mobile 使用[测试壳说明](../apps/mobile/README.md)中的隔离合成后端与受控 USB 流程，不连接正式 Data Root，不用上述正式启动入口替代兼容测试入口。以[P60 基线](../docs/verification/MOBILE_COMPATIBILITY_P60PRO.md)了解限制；其中进程、USB 映射和合成测试实例（fixture）都是当次记录，继续测试前须重新核验。
