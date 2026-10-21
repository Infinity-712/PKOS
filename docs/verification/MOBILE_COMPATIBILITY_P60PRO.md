# P60 Pro Compatibility Baseline

日期：2026-10-05（Asia/Shanghai）。本记录是当前 debug APK 的真机基线，不是 `MOBILE_COMPATIBILITY_PASS`，也不代表完整手机客户端或多端同步已完成。

## 范围与证据

- 仅测试 `dev.pkos.mobile.compat`，使用现有隔离模拟后端；没有访问正式 Data Root、正式聊天数据库、runtime profile 或真实模型。
- 没有重新构建 APK、升级依赖、修改业务/UI、安全策略、安装手机驱动或改变手机系统设置。
- 手机 USB 模式和 USB 调试由用户人工开启、授权。没有 root、无线 adb、批量授权、卸载、清空应用数据或 `adb kill-server`。
- ADB 结果、物理 WebView 的 CDP 证据、用户观察分别记录。浏览器模拟通过不当作真机通过。
- 原始日志、测试探针与仅含测试 App 内容的 WebView 截图位于 ignored `apps/mobile/test-results/p60pro/`，不提交截图、设备序列号或调试密钥。

## 设备与 APK

| 项目 | 本轮实际结果 |
| --- | --- |
| USB 设备 | 单台，`device`，已授权；序列号不记录 |
| manufacturer / model | HUAWEI / MNA-AL00，marketing name 为 HUAWEI P60 Pro |
| 系统 build | `MNA-AL00 4.2.0.218(C00E183R3P7)` |
| HarmonyOS platform property | `4.2.0` |
| Android compatibility | release `12`，API `31`；不把 API level 当成 HarmonyOS 大版本 |
| ABI | `arm64-v8a,armeabi-v7a,armeabi` |
| 实际 WebView | `com.huawei.webview`，versionName `114.0.5.302`，versionCode `21705` |
| WebView 内核 | App 调试端点报告 `Chrome/114.0.5735.196`，不是手机浏览器版本 |
| APK | `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`，4,420,900 bytes |
| SHA-256 | `5b5239b5e37d70910b77428d47f86b5ec94fcc67016617787d3d70394e30bc5c`，与前轮一致 |
| 包版本 | `dev.pkos.mobile.compat`，versionName `0.1.0-compat`，versionCode `1` |
| SDK / 类型 | minSdk 24，targetSdk 36；debuggable、testOnly |
| 签名 | SDK Build Tools 35.0.0 `apksigner verify` 成功，Android Debug 单签名者，APK v2 |
| 安装 | 先检查目标包不存在；`adb -s <serial> install -t <apk>` 返回 `Success` |
| launcher | 由包管理器解析为 `dev.pkos.mobile.compat/.MainActivity`，不是猜测 |

初次 `adb devices -l` 为空，Windows 没有识别到手机/MTP；用户开启 USB 调试并选择传输文件后出现已授权设备。未将初次故障误判为驱动损坏，也未自动安装驱动。[华为 USB 调试说明](https://consumer.huawei.com/cn/support/content/zh-cn00407281/)

## 测试服务与 USB

| 项目 | 本轮实例 |
| --- | --- |
| 入口 | `node apps/mobile/scripts/compat-server.mjs`，即现有 `npm.cmd --prefix apps/mobile run compat-server` 的脚本 |
| 监听 | `127.0.0.1:18790`，启动前端口空闲 |
| 控制终端 | 独立 PowerShell，标题 `PKOS Mobile Compat 18790 - synthetic only`，终端 PID `53096` |
| 服务 PID | `87844`；PID 只代表本次运行，后续须重新核验 |
| fixture | `d66830f7-4264-41d4-be2b-b58fd6997ef1`，version `1`，synthetic |
| 测试 Data Root | `%LOCALAPPDATA%/Temp/pkos-mobile-compat-UD85tN`，本轮实际绝对路径见 ignored 启动日志 |
| SQLite | 上述临时目录内 `runtime/agent/agent.sqlite` |
| Provider | 固定 `dry-run`，`external=false`，`dataEgress=none`，tools disabled |
| USB reverse | 本轮由空映射创建 `tcp:18790 -> tcp:18790`，使用 `--no-rebind` |
| App 请求地址 | `http://127.0.0.1:18790`，通过 USB 到电脑；手机不运行后端 |
| App Origin | 实测 `http://localhost` |

隔离证据不只来自 `/health`：启动代码显式注入独立 paths/DB、合成 ContextBuilder、mock Provider；子进程环境采用白名单，Registry 使用空环境和内置 dry-run。`/__mobile_compat__/info`、`/api/runtime-info`、`/api/chat/provider-status` 与实际 session/history 一致。`GET /api/objects` 返回 404，实际路由白名单阻止 authority 入口。

注意：runtime-info 的 capability 列表沿用完整服务元数据，不能据此宣称本测试实例开放全部功能；以测试入口路由白名单和实际拒绝结果为准。CORS 不是认证。`keyConfigured=true` 在此仅代表无密钥 dry-run 已就绪。

电脑端 HTTP 验证收到分段 NDJSON，包含三个 `content_delta` 和 `generation_completed`。此后另以手机 App 自己的 WebView 网络事件验证请求：身份、provider、session/history 都为 200；send OPTIONS 为 204、POST 为 200，服务回显 Origin 为 `http://localhost`。没有以电脑请求成功代替 App 连通。

## 真机验收矩阵

| 项目 | 状态 | 证据 / 限制 |
| --- | --- | --- |
| 安装 | 通过 | ADB Success，安装后包版本再次核验 |
| 页面显示 | 通过 | 用户明确确认“页面正常，显示已连接”；物理 WebView 截图显示测试标识和真实 UI |
| 冷启动 | 通过 | 仅 force-stop 测试 App 后重新启动，`LaunchState: COLD`；没有清空数据或重启后端 |
| App 内连接 | 通过 | App Origin、真实 WebView HTTP 事件、fixture/provider 诊断一致 |
| 中文分段显示 | 通过（自动观察） | 在物理 WebView 中经 UI 发送 slow 场景：约 5613 ms 已出现第一段且状态仍为“正在回复”；约 8159 ms 完成 |
| 中文 / emoji / 尾行 | 通过 | 最终正文精确匹配三段 mock 文本，包含 emoji 和 `PKOS_MOBILE_STREAM_OK`，无重复拼接 |
| 连点防重复 | 通过（DOM 双击触发） | 连续两次点击按钮产生 1 个 POST、1 条用户消息；不是人工手指连点或输入法验证 |
| 两个 session 隔离 | 通过 | B 的专用标记不出现在 A；A/B 各自 seed 标记与历史保持隔离 |
| 合成历史页 | 通过 | 已完成回复可见，无 `local:` 消息 ID |
| App 进程重建恢复 | 通过 | 新 App PID 恢复 B 及同一 fixture 历史；服务端两个会话的消息 ID/数量前后完全一致 |
| 中文输入法候选 / Enter | 通过（用户观察） | 用户确认候选词无误发送、回车换行；不以程序注入 input/composition 事件替代真实输入法操作 |
| 竖屏软键盘 | 通过（用户观察 + DOM 几何） | 无键盘 376×795；键盘展开后 376×512，输入框 bottom=403.08，发送按钮 bottom=455.08，DPR 3.25；用户确认均可见 |
| 完成后后台 / 回前台 | 通过（用户操作与观察） | 用户完成模拟回复、回桌面、重新打开 App，确认历史正常恢复；与自动冷启动测试分开记录 |
| 生成中后台 / 回前台 | 已观察，保守恢复边界成立 | slow 场景显示“正在回复”后通过 ADB Home 切后台；hidden 时转为“结果待核对”，HOT 回前台后仍待核对；仅 1 个 POST，没有自动重发或假装完成 |
| 物理拔线 / 飞行模式 | 未测试 | 本轮未改变手机网络设置或主动断开 USB，不以后台测试替代物理断网 |
| 真机横屏及键盘 | 未验收，本轮不再追查 | 用户实际横放后页面未旋转，并确认主要竖屏使用、本轮不必继续；未修改系统旋转设置或锁定 App 竖屏 |

物理 WebView 自动观察通过已有 debug socket，只读取本测试包；Playwright 直接连接因 `Browser.setDownloadBehavior: Browser context management is not supported` 失败，随后用基础页面 CDP 接口收集 DOM/网络证据。未修改 WebView 设置、CSP、CORS、明文白名单或使用原生 HTTP 替代 fetch。

### 生成中切后台现场

最小复现：在已核验的同一个 fixture 中选择 slow 场景，发送 `P60_BACKGROUND_BASELINE_SYNTHETIC`，UI 出现“正在回复”后返回桌面，随后重新打开测试 App。

- 后台时显示：`结果待核对；本版尚不支持中途续传。`。
- 回前台由 ADB 报告 HOT；网络观察仅 1 个 send POST。
- 只读 history 中新增 1 条用户消息，未读到此请求对应的 assistant 结果。不能根据“用户消息保存”推断 generation 已完成或不存在。
- 恢复稳定后，用户消息已使用服务端 ID（`local:` ID 数量为 0），UI 仍为“结果待核对”，发送按钮禁用。
- 此状态是有限恢复能力的边界，不是完整中断恢复通过，也不支持无损续流。本轮没有改状态、补发 POST、清空历史或重启 fixture 来消除提示。
- 后续若需从新的测试 fixture 继续发送，应先由用户明确选择结束/重置当前 fixture；那将丢失本次临时合成历史，不能再用来证明旧请求恢复。

## 已知缺陷

既有浏览器验收在 852×393 下失败：`composer must remain visible`，按钮 y=395.5、height=44 超出 viewport。原断言和 UI 未修改，没有锁定竖屏或变更测试尺寸。真机本轮没有进入横屏，因此没有横屏 viewport 或遮挡测量，不把“未旋转”写成“未复现”。按用户最新决定不再追查此项，仍不能宣称完整布局通过。

## 交接与清理

人工验收期间保留测试终端和 USB reverse，不清空合成历史、不卸载测试 App。交接时 App 保留上述“结果待核对”现场；本轮额外创建的 WebView 调试 forward 已逐一核对归属并移除，仅保留服务 reverse。继续核对必须保留同一个 fixture；后端重启会生成新 fixture，不能再用它验证旧历史恢复。

用户明确结束本次测试后，在标题对应的 PowerShell 中按 Ctrl+C。现有服务的受控停止会删除它自己的临时 fixture 及合成历史；这不是“暂停并保留历史”，不要在恢复测试尚未结束时执行。不要按文档内旧 PID 杀进程。

只移除本轮创建的 reverse，且先核对当前映射仍属于本次测试：

```powershell
$adb = 'D:\Android\android-sdk\platform-tools\adb.exe'
$serial = Read-Host '输入已核对的目标设备序列号（不要提交文档）'
& $adb -s $serial reverse --list
& $adb -s $serial reverse --remove tcp:18790
```

后续恢复时先确认 18790 空闲，再执行既有 `npm.cmd --prefix apps/mobile run compat-server`；用 `reverse --no-rebind tcp:18790 tcp:18790` 建立新映射，并在 App 重新核验 fixture。不覆盖不明映射、不使用 `reverse --remove-all` 或正式 `local-runtime`。

未暂存、commit、push；当前产品代码、APK、安全配置和正式服务保持不变。
