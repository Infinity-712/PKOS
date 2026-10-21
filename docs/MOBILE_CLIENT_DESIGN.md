# PKOS Mobile Client Design

> 后续证据导航（2026-10-21）：下文保留真机验证前的设计快照；随后已有 [2026-10-05 P60 Pro 部分真机基线](verification/MOBILE_COMPATIBILITY_P60PRO.md)及[兼容性测试壳说明](../apps/mobile/README.md)。这些记录不代表完整兼容性通过或多端同步完成。

> Status: Draft / Compatibility & Design Preparation
> 审计日期：2026-10-05。目标设备：用户提供的 HUAWEI P60 Pro / HarmonyOS 4.2.0，尚未连接真机核验。
> 本文是设计草案，不代表移动端已实现、APK 已兼容或多端同步已完成。

## 0. 工作区与证据边界

实际执行 `git status --short`、`git log --oneline -8` 和完整 porcelain 状态检查。HEAD 为 `9904346 chore(legacy): quarantine obsolete static and fastapi services`；此前为 `5d4f127 feat(v0.8): add review srs authority and human review workflow`，再前为 v0.7 service identity / reminder / task 提交。

工作区非空：已有 v0.8 Object/Review authority、Agent Server/共享客户端、Web/Desktop 双语 UI、启动脚本、文档及测试修改；另有未跟踪的 Object Authority 文件、UI 文件和测试临时产物。暂存区为空。本次审计对象是**当前工作区源码**，不是仅审计 HEAD；保留所有既有修改。

本轮只新增本文。没有运行产品测试、构建、安装依赖、访问运行中 API、读取正式 Data Root/密钥、调用模型、启动或停止服务、修改 runtime profile、提交代码。测试源码只作覆盖范围参考，不视为本轮通过证据。未发现已有移动客户端专项设计文档。

## 1. Desktop 功能与复用矩阵

当前 Desktop 主要是聊天、快速记录、状态三页，不是完整 Web Dashboard。

| 当前源码已有功能 | 可复用部分 | 手机需要适配或补齐 |
| --- | --- | --- |
| 创建/选择 session，读取聊天历史，流式回复、停止生成 | `AgentApiClient`、协议类型/guards、NDJSON parser；`chatModel` 的按会话归并逻辑 | 单栏会话导航、触控输入、后台恢复、历史分页、生成状态核验 |
| Provider/model/reasoning 选择及状态显示 | 类型、查询及选择接口 | 当前选择是全局的；首个壳只读显示，不能假装是手机独立设置 |
| Inbox/State 显式 append、结果显示与同请求重试 | `RequestAttempt`、输入约束、错误分类 | 移动表单及未决请求恢复；现有 attempt 只在组件内存中 |
| 最新状态、过期提示、健康/服务身份与版本检查 | 状态 DTO、服务身份合同、上海时区格式化 | 回前台刷新、离线/陈旧状态区分、连接设置页 |
| 到点提醒列表、手动刷新 | reminder notification 查询 | 仅前台列表；Desktop 也没有锁屏推送、原生通知或提醒管理全套 UI |
| 中文默认/英文切换、会话头、输入与滚动体验 | 翻译文案、状态标签和交互规则 | 独立移动布局、IME、安全区、返回键；现有窄屏 CSS 不等于真机验收 |
| 打开 Dashboard、桌面窗口/导航安全策略 | 可借鉴安全意图 | Electron main/preload、IPC、`BrowserWindow`、自定义 scheme 和 Node 文件接口全部不移植 |

复用层级：

- 可直接复用纯 TypeScript 规则：`packages/agent-client/src/{types,guards,constraints,RequestAttempt}.ts`；请求 ID/时间生成仍有运行时依赖。
- 可移植但须测 WebView 的代码：`AgentApiClient.ts`、`NdjsonStreamParser.ts`、`time.ts`，依赖 fetch/Streams/TextDecoder/AbortController/Intl，不是无环境依赖的纯函数。
- 可按需小幅提取：Desktop `chatModel.ts` 的事件归并、历史合并、键盘/滚动判断，以及真正重复的文案。不要先建大而全共享 UI 包，也不要让 mobile 导入 Desktop 的平台入口。
- 客户端含 Object/Task/Review 等协议，不代表 Desktop 已有对应页面，更不代表应全部移植。

证据入口：[App](../apps/desktop/src/renderer/App.tsx) L24、[AgentPage](../apps/desktop/src/renderer/pages/AgentPage.tsx) L35/L96、[ChatPanel](../apps/desktop/src/renderer/features/chat/ChatPanel.tsx) L63/L112、[chatModel](../apps/desktop/src/renderer/features/chat/chatModel.ts) L102/L136、[QuickInboxCapture](../apps/desktop/src/renderer/features/capture/QuickInboxCapture.tsx) L34、[ReminderNotificationsCard](../apps/desktop/src/renderer/features/reminders/ReminderNotificationsCard.tsx) L12、[agent-client](../packages/agent-client/src/AgentApiClient.ts) L73。

## 2. Capacitor / APK 的适用条件

**推荐候选：独立 React + TypeScript UI，以 Capacitor Android 容器打包 APK；先做兼容性运行壳，再决定正式采用。** 不把 HarmonyOS 4.2 当成 HarmonyOS 5/NEXT 原生 ArkTS/HAP 目标，也不要求换手机系统。

华为官方针对 HarmonyOS 4.2 说明了通过安装包安装应用的流程，这是评估 APK 路线的依据，但不是本项目 APK 的设备认证。安装限制由用户在真机核实，不自动变更手机防护设置。[华为安装包说明](https://consumer.huawei.com/cn/support/content/zh-cn01089223/)

当前 Capacitor v8 文档列出 Android API 24+、Chrome WebView 60+；配置另有 `minHuaweiWebViewVersion`，默认 10。Huawei WebView 与 Chromium 版本号不能直接等同，这些最低门槛也不足以证明 PKOS 的现代 JS/CSS 可运行。[Android 支持](https://capacitorjs.com/docs/android)、[配置参考](https://capacitorjs.com/docs/config)

v8 的开发工具要求包括 Node 22+ 和 Android Studio 2025.2.1+。这些是**电脑构建环境**要求，不是在手机运行 Node/Python；本轮未安装或核验工具链。版本应在真机 WebView 与工具链调查后锁定，不以盲目降低安全版本解决兼容问题。[环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)

当前 agent-client 编译目标是 ES2022，Desktop 使用较新的 Electron/React/Vite；不能把 Electron Chromium 的能力推定给手机。若原生 WebView fetch 无法满足流式需求，先记录阻断并比较替代传输，不静默改用原生 HTTP 或扩大到 HarmonyOS NEXT 重写。浏览器原型只能辅助排查，不能替代 APK 验收。

## 3. 设备与 WebView 待验证项

以下均为**待验证**，不能用模拟器结果填作真机通过：

| 项目 | 真机要记录/验证的内容 |
| --- | --- |
| 安装环境 | 完整机型/地区及系统 build、Android compatibility API level、ABI、签名 APK 安装/启动；是否允许 USB 调试 |
| WebView | 实际 provider、版本和 UA，不用华为浏览器版本代替；可用时读取 `adb shell dumpsys webviewupdate`，命令不支持则记录 |
| JS/网络 | `Response.body.getReader()`、流式 `TextDecoder`、`AbortController`、async iteration、URLSearchParams、UUID/安全上下文、Intl 上海时区 |
| 中文流 | 延迟发送且跨 UTF-8 字符/JSON 行切块，逐步显示而非结束后一次吐出；无乱码、丢尾行或重复消息 |
| 输入/布局 | 华为中文输入法候选确认不能误发送；软键盘不遮输入框；返回键先关闭键盘/局部页面；状态栏、挖孔和底部手势安全区；系统字体放大 |
| 生命周期 | 切后台/锁屏/系统回收/回前台/断网重连；区分恢复页面与恢复 generation，不承诺后台持续连接 |

保留 WebView 原生 fetch 作为第一验证路径。`CapacitorHttp` 的 fetch patch 默认关闭，其原生请求 API 返回完整 `HttpResponse`；不能假定开启后仍保留当前 NDJSON 流式语义。[Capacitor HTTP](https://capacitorjs.com/docs/apis/http)

生命周期与返回键可在后续使用 Capacitor App 适配，插件事件本身不恢复服务端会话或生成任务。[Capacitor App](https://capacitorjs.com/docs/apis/app)

## 4. 客户端、服务器、数据职责

建议未来新增 `apps/mobile`，只依赖共享客户端及少量无平台耦合的逻辑；本轮不创建目录或修改 Desktop。

| 层 | 职责与禁止事项 |
| --- | --- |
| Mobile UI | 聊天、快速记录、状态、连接设置四个入口；中文优先/英文可切换。独立单栏布局；不嵌入整套 Dashboard |
| 共享客户端 | 类型校验、HTTP/NDJSON、错误/请求状态；连接配置注入 base URL。将来认证 transport 必须限制凭证目标 origin，不能把凭证带往用户任意输入的地址 |
| Agent Server | 唯一聊天/session/generation 协调者，持有 Provider 配置及厂商密钥；执行访问控制、许可、白名单动作和审计 |
| Python Core / Data Root | 只在服务端执行；Git 文本文件仍是知识/任务等 authority，append-only 与人类裁决规则不变 |
| 手机存储 | 只保存连接偏好、语言、会话/请求/生成的恢复标识等最小非权威元数据；不复制 vault、agent.sqlite、聊天历史库或厂商 API key，不建立离线写回队列 |

服务器 SQLite 保存聊天和运行状态，手机恢复历史以服务器为准，但聊天记录不是 PKOS 知识 authority。手机连接设置不包含 Data Root 路径、Provider endpoint 或厂商密钥编辑。

远程阶段的 PKOS 访问凭证需独立于厂商 key，使用受保护的原生存储，例如 Android Keystore 保护的加密存储；普通 Web storage/Preferences 不作为安全凭据库。具体华为设备能力届时验证。[Android Keystore](https://developer.android.com/privacy-and-security/keystore)

## 5. 两阶段数据流

### A. 本地兼容性验证，优先 USB

```text
手机 APK 的本地 UI
  -> WebView fetch http://127.0.0.1:18790
  -> 指定设备的 adb reverse
  -> 电脑 127.0.0.1:18790 独立测试 Agent Server
  -> 独立测试 Data Root + 独立 agent.sqlite + 合成数据/模拟 Provider
```

`18790` 只是候选测试端口，使用前检查占用；不用正式 `8790`。手机的 loopback 不指电脑，只有该 USB 映射存在时才转到电脑。以下为**后续步骤示例，本轮未执行**：

```text
adb devices
adb -s <serial> reverse --list
adb -s <serial> reverse --no-rebind tcp:18790 tcp:18790
adb -s <serial> reverse --remove tcp:18790
```

只移除本次创建的映射，不 `remove-all`，不停止未知进程。USB 授权/转发不是应用身份认证，手机其他应用也可能访问转发端口，所以只连接隔离测试实例。[ADB reverse 语义](https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/docs/user/adb.1.md)

测试实例必须显式指定临时 `PKOS_DATA_ROOT` 和独立 `PKOS_AGENT_DB_PATH`，从合成 fixture 初始化，禁止复制正式 vault/SQLite。使用受控测试环境，不载入正式 runtime profile、`.env` 或 Provider 密钥。不要通过当前 `local-runtime.ps1 start/restart` 改动正在使用的实例。

**USB 不会绕过浏览器网络策略。** Capacitor Android 默认 UI origin 是 `https://localhost`，当前服务端并未放行。下一轮需要独立测试启动配置精确允许实测 origin，不能给默认服务加通配 CORS。可评估仅 debug flavor 使用 `http://localhost` 页面 origin，并仅对 loopback 开放明文网络；若保留 HTTPS origin，还须实测 WebView mixed-content 策略，不能只改 CORS。[Capacitor 配置](https://capacitorjs.com/docs/config)、[Android 网络安全配置](https://developer.android.com/privacy-and-security/security-config)

生产 APK 必须剔除调试明文/mixed-content 例外，不用 `server.url` 把远程页面当正式包内容，不禁用证书校验。受控局域网仅作为替代：专用测试实例仍保持 loopback，由受认证且受防火墙限制的入口接入；不得直接把当前无认证服务绑定到 `0.0.0.0`。

### B. 远程使用，另行实施

```text
手机 UI / Desktop UI
  -> HTTPS + 可撤销、限权的 PKOS 客户端认证
  -> 同一个 Agent Server
  -> 同一 Data Root + 同一服务器聊天/运行数据库
  -> 服务器侧 Provider / Python Core
```

前置条件：TLS、真实服务端认证与授权、凭据安全存储/撤销、稳定数据集身份、生成恢复及并发规则。可以设计认证网关，但必须保护全部数据/写入路径，阻断旁路直连并保留流式传输，不能只保护首页。Desktop 的固定连接地址与 CSP 也要在后续小任务中参数化，不能仅改手机就宣称双方已连接同一远程实例。

## 6. 连接、安全与恢复审计

### 已存在的相关接口

| 接口 | 当前用途 |
| --- | --- |
| `GET /health`、`GET /api/runtime-info` | 健康、合同/能力、构建和运行身份；不是登录或认证证明 |
| `GET/POST /api/chat/sessions` | 会话列表/创建 |
| `GET /api/chat/sessions/:id/messages?limit=&before=` | 服务器历史，默认 100、最多 200 条；Desktop 尚无翻页 UI |
| `GET /api/chat/provider-status`、`GET /api/chat/provider-profiles` | 模型配置摘要，不提供厂商 key 值 |
| `POST /api/chat/provider-selection` | 修改共享 active selection |
| `POST /api/chat/send` | NDJSON；另有 `?stream=false`，不是续流接口 |
| `POST /api/chat/generations/:id/abort` | 请求服务端取消 |
| `GET /api/pkos/state-timeline` | Python Core 状态读取及 freshness |
| `GET /api/runtime/reminder-notifications` | 扫描到点提醒并维护派生运行态，不等于推送服务 |
| `POST /api/actions/inbox-append`、`POST /api/actions/state-append` | 固定动作写回，带 requestId |
| `GET /api/actions/requests/:requestId` | 已有 action 结果查询；共享客户端尚需小幅补方法，不能当作 chat generation 查询 |

路由证据：[chatRoutes](../apps/agent-server/src/server/chatRoutes.ts)、[ActionRoutes](../apps/agent-server/src/actions/ActionRoutes.ts) L180/L266、[StateTimelineRoutes](../apps/agent-server/src/pkos/StateTimelineRoutes.ts)、[ReminderRuntimeRoutes](../apps/agent-server/src/reminders/ReminderRuntimeRoutes.ts)。

### 明确结论与缺口

| 审计问题 | 当前事实 | 设计要求，尚未实施 |
| --- | --- | --- |
| base URL 是否固定？ | Desktop renderer 与 Electron CSP 固定 `http://127.0.0.1:8790`；agent-client 本身支持注入 baseUrl | Mobile 自己管理连接；不能复制 Electron 地址/CSP/main/preload |
| 是否只接受 Web/Electron origin？ | CORS 只列 `http://127.0.0.1:5173`、`pkos-desktop://app`，仅放行 `Content-Type` 请求头；拒绝预检，但普通请求仍进入路由 | 当前限制浏览器读取/预检，不是拒绝所有其他客户端。Capacitor origin 要单独配置与测试 |
| 真正的服务端控制？ | 入口固定 loopback；固定动作校验字段、大小、注册工具、权限等级、confirmation、requestId+payload hash；外部 Provider 要 `allowExternalProvider=true` | **没有客户端身份认证。** `confirmed`、`requestedBy=user_explicit`、CORS 和隐藏按钮都不证明调用者身份；远程前补认证与最小权限 |
| WebView 能消费 NDJSON？ | client 用原生 fetch + reader + 流式 TextDecoder，处理跨块缓冲和尾行 | 协议可复用，目标 WebView 能力与真实逐块到达尚未验证；HTTP 200 也可能含流内错误 |
| abort 是真取消？ | Desktop 先调用 abort API，再 abort 本地读取；流连接提前关闭也向 runner/provider 传播取消；非流请求无对应 close 钩子 | 不等于撤销厂商已处理内容；取消请求可能失败/等待，应限时并核验终态，不能只展示“已停止” |
| 重建如何恢复？ | App 内按 session 保存视图；进程重建后拉 sessions，默认选排序首项，再拉 history；不保证上次所选 session | 可保存按连接身份分区的 lastSessionId 指针，服务器确认后恢复；回前台重新拉取并按服务端 message ID 合并，不复用“已恢复”标志跳过刷新 |
| 断流怎样找回原 generation？ | 无已注册 generation GET、active 列表或事件回放；send 无请求幂等键。内部 generation/event store 不等于 HTTP 能力 | 先设计按 generationId 查询快照/终态、按 session 发现未决 generation，以及 clientMessageId/requestId 到 generation 的持久映射；恢复只查询，不重发 POST |
| 两端同 session 并发？ | runner 没有 session 锁或 busy 检查；Desktop 防重复仅限本地。两请求可并行写 user 消息并生成，上下文顺序有风险 | 建议一个 session 一个活动 generation，服务端原子占位，冲突返回明确 busy/active ID；不同 session 可并行，暂不做队列 |
| Provider 属于谁？ | SQLite `id='active'` 是全局选择；run 开始取快照，运行中切换不改当前生成，但影响后续请求 | “选择然后发送”存在跨端竞态。后续考虑 send 携带选择/版本并原子验证，保持服务端外发许可，不把全局选择包装成 session 设置 |
| 稳定数据集身份？ | dataRootFingerprint 是绝对路径哈希；runtimeFingerprint 还含 coreRoot/DB 路径。搬路径会变，同路径换数据可能不变 | 现有指纹用于诊断，不是永久 datasetId 或认证凭据。正式多端前定义稳定 datasetId、独立实例/聊天库身份与克隆语义；未匹配时停止恢复旧请求 |

关键证据：[Desktop config](../apps/desktop/src/renderer/config.ts) L1、[securityPolicy](../apps/desktop/src/main/securityPolicy.ts) L1、[入口](../apps/agent-server/src/index.ts) L13、[cors](../apps/agent-server/src/server/cors.ts) L3、[HTTP 分发](../apps/agent-server/src/server/httpServer.ts) L44、[WritebackRouter](../apps/agent-server/src/writeback/WritebackRouter.ts) L114、[AgentRunner](../apps/agent-server/src/runtime/AgentRunner.ts) L89、[ProviderRuntimeSelection](../apps/agent-server/src/providers/ProviderRuntimeSelection.ts) L54、[RuntimeIdentity](../apps/agent-server/src/runtime/RuntimeIdentity.ts) L75。

补充恢复边界：成功 assistant 消息才写入历史，失败/取消时 partial 位于 generation 运行态，history 不能完整还原。尚未确认服务器进程崩溃后的 running 清理语义，必须作为恢复测试项。首包丢失且 generationId 未收到时，仅保存内存 ID 无效，所以请求映射是必要缺口；无需首期实现事件重放，快照查询也可满足安全恢复。

Capture 不同于 chat：服务端已有动作结果重放、冲突和 `indeterminate` 人工核对机制。Mobile 后续只持久化 requestId/连接身份/摘要哈希等未决标识，先查结果；原 payload 仍在内存时才显式以同 ID 重试。重启后不自动重建 payload、不以新 ID 偷偷重发。丢失标识或结果不确定时提示人工核对，不谎报成功，也不扩展成离线双向同步。

## 7. 最小运行壳与验收标准

**下一实施片只验证兼容性，不交付完整手机客户端。** 可包含独立 Android debug 壳、中文/英文界面框架、连接设置、服务身份只读检查、模拟中文 NDJSON 展示，以及使用合成历史验证重建。暂不启用真实模型、authority 写入或全局 Provider 切换。

后端允许的必要准备应单独评审：隔离测试实例的 origin 配置、测试 transport/模拟流入口，不改默认服务暴露面。正式 generation 恢复接口属于后续小片；在此之前，断流显示“结果待核对”，不能声称支持无损续流。

验收清单，必须记录设备 build/WebView、APK 版本及结果：

1. 签名 APK 在这台 P60 Pro 安装、冷启动、再次启动成功；不依赖 Google 登录或新增 GMS 服务。
2. USB 连接到**隔离实例**，读取身份/合同/能力；错服务、错身份、接口不兼容均明确阻断。不能只看 `/health.mode`，当前代码该字段固定为 `dry-run`，应另核查测试配置与 provider-status。
3. 模拟中文流跨字符/跨行分片仍逐段正确显示，处理异常尾行、终态和流内错误；不调用外部模型。
4. 中文 IME、换行/发送、防连点、返回键、软键盘、安全区、字体放大与滚动阅读分别真机通过。
5. 切后台/回前台、进程重建后从合成服务端历史恢复；两个 session 不串台。网络失效不自动重发聊天/写请求，未决状态可见。
6. 网络恢复后核对服务身份；有 generation 查询能力时回查原 ID，没有时如实显示恢复能力尚缺，不伪造完成或新建生成。
7. 测试前后正式 Data Root、当前 runtime profile 和原有服务不变；只清理本测试拥有的进程、数据与 USB 映射。

已有 [agent-client smoke](../packages/agent-client/scripts/smoke.ts) 涵盖流解析/动作重试部分断言，[Desktop history smoke](../apps/desktop/src/scripts/chatRestartRestoreSmoke.ts) 涵盖历史恢复部分逻辑。本轮只审阅，未运行；未来需新增移动 WebView/生命周期/双端并发验收，不能用这些脚本替代真机证据。

## 8. 后续功能移植顺序

1. **兼容性壳**：独立测试数据、连接身份、中文模拟流及设备交互，通过后决定是否采用 Capacitor APK。
2. **恢复协议**：generation 查询/请求映射、同 session 并发规则、选择竞态及稳定数据身份；用两个测试客户端验收，不动当前 Desktop 正式连接。
3. **聊天日常页**：session/history/分页/停止/恢复，服务器仍持有模型 key；Provider 操作仅在明确全局语义或请求绑定完成后开放。
4. **快速记录与状态**：显式 Inbox/State append、未决请求查询、状态读取与回前台刷新，复用现有受控写回，不自动创建 object/task/trusted。
5. **Desktop 日常能力补齐**：前台提醒列表、语言与服务诊断；远程 HTTPS/认证/安全存储及 Desktop 连接配置作为独立上线门禁，不等同于增加业务功能。

不纳入：完整 Objects 管理、硬删除、复杂 Audit、整个 Web Dashboard、离线双向同步、锁屏推送、语音、Live2D、多 Agent；不恢复旧公开发布链路。APK 打包通过不等于多端同步完成，共用服务也不自动解决缓存刷新、并发和恢复问题。

## 9. 需要用户补充的信息

- 完整 HarmonyOS build/机型地区版本，当前 WebView provider 与版本；不要提供序列号、账户或密钥截图。
- 是否可以通过数据线连接开发电脑，并人工开启/授权 USB 调试、安装测试 APK；不要求本轮改手机设置。
- 第一阶段是否只需在这台 Windows 电脑运行时使用？后续服务放在常开电脑还是私有服务器，是否需要外网访问？
- 是否保留手机当前系统、不计划近期升级？若设备切换到其他 HarmonyOS 大版本，应重新评估而非继承本次兼容结论。
- 双端同 session 时是否接受“当前正在另一端生成，请等待或明确停止”的最小策略？模型切换是否期望只影响本次请求？

本草案的推荐决策：先批准隔离、无真实模型的最小运行壳；远程认证、生成恢复及并发设计分别评审，不在本轮顺带实现。
