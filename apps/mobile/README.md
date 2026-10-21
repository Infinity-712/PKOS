# PKOS Mobile Compatibility Shell

> 记录范围：下文工具链、APK 与真机实测描述来自 2026-10-05，属于历史基线；不是当前进程状态或最新构建证明。当前项目进度请查看 [项目手册](../../handbook/status.md)。

独立的 React/TypeScript + Capacitor Android **测试壳**。目标设备为 HUAWEI P60 Pro / HarmonyOS 4.2.0，已完成 Windows debug APK 构建及首次真机安装、连接、流式和历史恢复基线；仍有已知横屏缺陷，不是完整兼容性通过。不把 HarmonyOS 4.2 当作 NEXT，不声称 APK 构建或浏览器测试等于手机兼容或多端同步完成。

只有连接诊断、模拟聊天、合成历史三页；中文默认，支持英文。无真实模型、authority 写入、Provider 切换、离线发送队列或认证。本机偏好不是未来的凭据库。

## 环境与版本

| 组件 | 锁定/要求 |
| --- | --- |
| Node / npm | 本轮实测 24.14.1 / 11.11.0；项目要求 Node 24+ |
| Capacitor core / cli / android | 8.5.2，同版本锁定在 package-lock.json |
| 官方插件 | App 8.1.2，Keyboard 8.0.6，Preferences 8.0.1 |
| React / Vite / TypeScript | 19.2.7 / 7.3.6 / 5.9.3 |
| Android Gradle Plugin / wrapper | 8.13.0 / 8.14.3 |
| JDK | Android Java 编译要求 21；当前 wrapper 支持运行 JDK 21..24，本机使用 Studio JBR 21.0.8 |
| Android SDK | compile/target 36，min 24；AGP 默认 Build Tools 35.0.0，已安装 Platform 36 revision 2 与 platform-tools 37.0.1 |
| JS target | 仅 mobile 使用 ES2020，未降低其他包目标；具体手机 WebView 待验证 |
| APK 标识 | `dev.pkos.mobile.compat`，名称 `PKOS Mobile 测试`，versionName `0.1.0-compat`，versionCode `1` |

依据：[Capacitor 环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)、[v8 升级说明](https://capacitorjs.com/docs/updating/8-0)、[配置参考](https://capacitorjs.com/docs/config)。版本同时以 npm 元数据及本次实际生成的 Android 模板核对。JDK 21 来自锁定版本的 Android Java 编译要求，不是手机运行 Java/Node。

## 安装项目依赖

在仓库根目录的 PowerShell 中执行。只安装这些包自己的依赖，不批量升级其他项目：

```powershell
npm.cmd --prefix packages/agent-client ci
npm.cmd --prefix packages/agent-client run build
npm.cmd --prefix apps/agent-server ci
npm.cmd --prefix apps/mobile ci
```

已有依赖可以跳过安装。Android 工具链使用下述本地环境入口，不修改全局环境。

## Windows Android 工具链

本机安装记录（2026-10-05）：Windows x64，Android Studio Otter 2 Feature Drop 2025.2.2 Patch 1（包版本 2025.2.2.8），JBR/java/javac 21.0.8。Studio 使用官方 ZIP 解包，未启动 IDE 向导；未替换其他 JDK，未修改系统 PATH/JAVA_HOME 或执行策略。

| 用途 | 本机位置 / 版本 |
| --- | --- |
| Studio / JBR | `E:\Development\AndroidToolchain\android-studio` / 其 `jbr` 子目录 |
| Android SDK | 复用 `D:\Android\android-sdk`，保留原 Platform 35 revision 1 |
| 本轮 SDK 包 | `platforms;android-36` revision 2、`build-tools;35.0.0`、`platform-tools` 37.0.1 |
| Command-Line Tools | `cmdline-tools\22.0`，官方包 build 15859902 |
| Gradle / 临时缓存 | `E:\Development\AndroidToolchain\gradle-cache` / `temp` |
| 个人配置 | ignored `apps/mobile/.local/android-toolchain.json` |

安装路径只作本机记录，不是公共构建默认值。没有安装 emulator、系统镜像、NDK、CMake，也没有生成 release 签名密钥。SDK Manager 要求的 `android-sdk-license`（2019-01-16）已由用户阅读并明确接受，随后仅对此项输入一次 `y`。未伪造 licenses 文件；以后出现新协议仍需单独确认。

官方来源与完整性记录：

- [Android Studio 官方归档](https://developer.android.com/studio/archive)：`android-studio-2025.2.2.8-windows.zip`，下载自 `dl.google.com`，SHA-256 与官方公布值一致：`d63603d6bbc433484b4059060319cc116a50c9bdf0d37610dd83ac68d77a1294`。`studio64.exe` 的 Google LLC Authenticode 签名为 Valid。
- [Android 官方命令行工具](https://developer.android.com/studio)：`commandlinetools-win-15859902_latest.zip`，SHA-256 与官方公布值一致：`90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a`。SDK 组件通过官方 SDK Manager 安装，未用第三方镜像。
- [Gradle 官方校验和](https://gradle.org/release-checksums/)：wrapper 8.14.3-all 的 `distributionSha256Sum` 已固定为 `ed1a8d686605fd7c23bdf62c7fc7add1c5b23b2bbc3721e661934ef4a4911d7c`，首次下载由 wrapper 校验。wrapper JAR 也与官方值 `7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172` 一致。

兼容依据：[Studio/AGP 表](https://developer.android.com/studio/releases)、[AGP 8.13 要求](https://developer.android.com/build/releases/agp-8-13-0-release-notes)、[Gradle 8.14 Java 兼容表](https://docs.gradle.org/8.14/userguide/compatibility.html)。AGP 最低 JDK 17 不代表 Capacitor 的 Java 21 源码可以用 JDK 17 编译；本机 wrapper 的 Launcher/Daemon JVM 均已核对为上述 JBR 21.0.8。

### 新 PowerShell 构建

在仓库根目录运行，第一行的点和空格表示把配置加载到**当前进程**：

```powershell
cd E:\Creation\Codex\PKOS
. .\apps\mobile\scripts\android-env.ps1
java -version
javac -version
adb version
.\apps\mobile\android\gradlew.bat --version
npm.cmd --prefix packages/agent-client run build
npm.cmd --prefix apps/mobile run check
npm.cmd --prefix apps/mobile run android:debug
```

无需继承上一个终端的变量。helper 设置 JAVA_HOME、ANDROID_HOME、GRADLE_USER_HOME、临时目录并在原 PATH 前添加工具路径。ANDROID_SDK_ROOT 冲突时明确警告并仅在当前进程对齐；Gradle JVM override、JVM 注入变量或冲突的 `local.properties` 会报错要求核对，不静默覆盖。properties 检查支持等号、冒号、空格或 tab 分隔；转义键或续行则保守拒绝，要求显式核对，不冒充完整 Java properties 解析器。此机器无需 `local.properties`；已有文件会保留。

换机器时，在 ignored `.local/android-toolchain.json` 配置 `javaHome`、`sdkRoot`、`gradleUserHome`、`tempRoot` 四个绝对路径，或传 `-JavaHome` / `-SdkRoot` / `-GradleUserHome` / `-TempRoot`；路径含空格时加引号。不自动改全局变量，不使用 ExecutionPolicy Bypass。遇到组织执行策略限制时应让管理员处理。

本次网络排障：Studio redirector 跳转主机直连超时，改用相同文件的 Google 官方直链并核验官方 hash；Gradle distribution 经 `services.gradle.org` 跳转 GitHub 时直连超时。经用户许可，仅在本项目专用的外部 Gradle cache `gradle.properties` 中使用已有本机代理；Maven Central 经代理返回 403、同 URL 直连返回 200，因此只为 `repo.maven.apache.org` 配置直连例外。未关闭 TLS、改全局代理或换未知镜像。新终端构建仍需该本机代理可用，或自行审核这个私有配置后调整网络；不要提交代理配置。

## 先在电脑浏览器运行

终端 A，从仓库根目录运行前台测试服务：

```powershell
npm.cmd --prefix apps/mobile run compat-server -- --browser-origin http://127.0.0.1:5185
```

终端 B：

```powershell
npm.cmd --prefix apps/mobile run dev
```

打开 <http://127.0.0.1:5185>。`dev` 先构建再预览打包资源，不是热更新；修改源码后重启该命令。这样预览和 APK 使用同一份 CSP，不为 Vite 热更新开放 inline scripts 或 WebSocket。若端口已占用会失败，不终止任何未知进程。

两个终端各按 Ctrl+C 停止自己启动的进程。测试服务通过 IPC 优雅关闭并删除自己创建的临时目录；不访问正式 runtime 进程清单。强制结束进程/断电可能留下系统临时目录，本壳不会扫描或自动删除其他运行的目录。

手机测试时，不需要浏览器预览，终端 A 改为：

```powershell
npm.cmd --prefix apps/mobile run compat-server
```

默认只监听 `127.0.0.1:18790`；禁止 `8790` / `0.0.0.0`。每次启动生成新的随机 fixtureId 和两个明显不同的合成 session。会话 ID 不固定；关闭测试服务会清除历史。App 重开时，只有同一测试服务仍在运行才能恢复原合成历史。

若需要另一个测试端口，必须同时显式指定后端 `--port`、在**当前终端**设置 `$env:PKOS_MOBILE_PORT='18791'` 后重新构建/同步 APK，并同步调整 adb 映射。UI 不会绕过构建时 CSP 切换到任意地址。

## 构建与检查

```powershell
npm.cmd --prefix apps/mobile run check
npm.cmd --prefix apps/mobile test
npm.cmd --prefix apps/mobile run build
npm.cmd --prefix apps/mobile run test:browser
npm.cmd --prefix apps/agent-server run check
npm.cmd --prefix apps/agent-server run mobile-compat-smoke
npm.cmd --prefix apps/agent-server run mobile-compat-regression
npm.cmd --prefix apps/mobile run android:doctor
npm.cmd --prefix apps/mobile run android:sync
npm.cmd --prefix apps/mobile run android:debug
```

`test:browser` 只使用新建测试实例与新浏览器上下文，占用 18790/5185，结束后清理自己的服务器。优先使用 Playwright Chromium；本机已有缓存时可复用，也可在当前终端设置 `MOBILE_BROWSER_PATH` 为已安装的 Chromium 可执行文件。没有浏览器时明确报阻断。截图位于 gitignored `apps/mobile/test-results/`，不是手机实测记录。

`android:sync` 无需 JDK：先同步 release 默认资源，再生成 debug source-set 资源。不要用裸 `cap sync` 替代，否则只会同步禁用测试网络的 release 配置。`android:debug` 先检查工具，缺失时退出，不自动下载 SDK/接受许可；具备环境后使用 wrapper 构建 debug APK 和 release merged Manifest，再验证合并结果及 APK 内 Capacitor 配置。

运行 Android 命令前先加载上面的 `android-env.ps1`。本机 `android:doctor` 已无缺失项，首次 Gradle 构建需要下载 Maven/Gradle 依赖。构建明确禁用 Gradle 自动补装 SDK；缺包时先通过 SDK Manager 核对许可并安装。

### 本轮实测结果

`APK_BUILD_OK`：首轮 native build 146 个任务成功；另开 Windows PowerShell 5.1 `-NoProfile`，从默认 ignored 配置重新加载环境后再次构建成功（21 executed / 125 up-to-date），APK hash 相同。测试曾发现 PowerShell 5.1 在参数默认表达式中无法取得 `$PSScriptRoot`，已将默认路径计算移到脚本体，并覆盖不带参数的真实 PowerShell 调用及含空格路径。

| APK 实际核验 | 结果 |
| --- | --- |
| 完整路径 | `E:\Creation\Codex\PKOS\apps\mobile\android\app\build\outputs\apk\debug\app-debug.apk` |
| 大小 | 4,420,900 bytes |
| SHA-256 | `5b5239b5e37d70910b77428d47f86b5ec94fcc67016617787d3d70394e30bc5c` |
| applicationId | `dev.pkos.mobile.compat` |
| versionName / versionCode | `0.1.0-compat` / `1` |
| compile / min / target SDK | 36 / 24 / 36 |
| 包类型 | `application-debuggable`，`testOnly` |
| 签名 | `apksigner verify --verbose --print-certs` 成功，APK v2，单个 Android Debug 签名者；非发布签名 |

身份与 SDK 来自 Build Tools 35.0.0 `aapt dump badging` 对实际 APK 的读取，不是由文件名推断。debug/release merged Manifest 及 APK 内配置均通过现有验证；`cap sync` 前后源码哈希比对没有修改原生安全配置。自动生成的 debug keystore 不在 Git 中。

通过：共享客户端构建、mobile TypeScript check、71/71 单元测试、release/debug Web build、Capacitor sync、wrapper version、debug APK 构建和新 PowerShell 重建。没有修改锁文件或升级产品依赖。

**已知失败保留**：`npm.cmd --prefix apps/mobile run test:browser` 仍在 852×393 横屏下失败：`composer must remain visible`，发送按钮 `y=395.5, height=44` 超出视口。对应 `scripts/browser-test.mjs` 断言未修改、未跳过；没有修复 UI。此 APK 不是已完成人工验收的版本。

构建仍有非阻断警告：Capacitor `flatDir`、新版 SDK XML 与现有 AGP reader 格式差异、Vite 对独立经典 `bootstrap.js` 的提示。未为消除提示改动产品依赖或安全策略。本轮未访问正式 Data Root，未修改 runtime profile，未调用真实模型；未暂存、commit 或 push。

## USB 安装与运行

Windows adb 1.0.41（platform-tools 37.0.1）已安装。2026-10-05 已在单台授权 P60 Pro 上安装相同 hash 的 debug APK，并通过 App WebView 验证模拟连接和分段回复，详细结果见 [P60 Pro 验证记录](../../docs/verification/MOBILE_COMPATIBILITY_P60PRO.md)。以下命令用于后续受控安装与连接；已有安装或映射时先检查，不无条件重复覆盖。不要将完整设备序列号提交到文档。

```powershell
. .\apps\mobile\scripts\android-env.ps1
$adb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
if (-not (Test-Path -LiteralPath $adb)) { throw '请将 $adb 设置为实际 adb.exe 路径' }
& $adb devices
$serial = Read-Host '输入目标手机序列号（仅本机使用）'
& $adb -s $serial reverse --list
```

设备为 `unauthorized` 时，等待手机上人工授权。多设备必须指定目标。不修改手机防护设置，不运行 `adb kill-server`。

确认不存在不明用途的同端口映射后：

```powershell
& $adb -s $serial reverse --no-rebind tcp:18790 tcp:18790
if ($LASTEXITCODE -ne 0) { throw '映射未创建，不覆盖已有映射' }
$createdReverse = $true
$apk = Join-Path (Get-Location) 'apps\mobile\android\app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path -LiteralPath $apk)) { throw '尚无 APK，先完成 android:debug' }
Get-FileHash -LiteralPath $apk -Algorithm SHA256
& $adb -s $serial install -r -t $apk
& $adb -s $serial shell am start -n dev.pkos.mobile.compat/.MainActivity
```

`-t` 对应 debug Manifest 的 testOnly 标识。只安装本测试包，不卸载其他 App。测试结束关闭本轮前台服务；只有本终端成功创建过该映射才移除：

```powershell
if ($createdReverse) { & $adb -s $serial reverse --remove tcp:18790 }
```

不要 `reverse --remove-all`。如果中途端口映射被其他操作替换，先重新核对，不盲目移除。

## 架构与安全边界

- `src/store.ts`：独立外部 view store，session-scoped messages、epoch/请求序号、单次发送门闩、稳定消息 ID 合并；没有复制 Desktop main/preload。
- `src/compatClient.ts`：复用 `@pkos/agent-client` 的 HTTP、响应 guards、NDJSON parser；发消息前核验 test-info、真实 runtime-info 合同、dry-run Provider。仅 HTTP loopback 测试端口，禁止重定向、credentials 和正式 8790。
- `src/main.tsx`：Preferences 单一键 `pkos.mobile.compat.preferences.v1`。只保存 language/baseUrl/fixtureId/lastSessionId/未决 sessionId、generationId。消息正文、输入内容、frozen payload 不落本机盘；无 IndexedDB/history cache。浏览器的 Preferences fallback 使用 localStorage，不是安全存储。
- 服务使用原 factory、AgentRunner、GenerationManager、EventStore 和 SQLite/history；只注入固定 mock、合成 ContextBuilder、独立临时 paths/DB/Registry。测试入口不开 authority/tool/scheduler 路由，不读取 Flow Hub 或正式 Provider profile。
- 子进程环境采用系统运行所需变量白名单；不传入 Provider key、PKOS_DATA_ROOT、NODE_OPTIONS。测试数据路径通过显式依赖注入覆盖，不继承正式路径环境变量。
- 仅允许 health/runtime-info、只读 provider-status、session 列表/历史、send、现有 abort 和 test-info。create session、provider-selection、actions、objects/tasks/review 等均拒绝。
- CORS 不是认证。debug origin 预期 `http://localhost`，真机实际值待验证。测试服务精确允许此 origin；浏览器预览需显式开启 `http://127.0.0.1:5185`，拒绝 `null` 与其他 origin，正式服务白名单不变。
- debug 只对 localhost/127.0.0.1 开启明文例外；主 Manifest 明文默认禁用，release network-security-config 无例外。debug CSP 的 connect-src 仅固定 loopback 测试端口；release 为 `none`。无 server.url、GMS、mixed-content、证书绕过、CapacitorHttp patch 或外部链接入口。
- Android wrapper/native 工程跟踪；node_modules、assets 构建副本、APK、keystore、local.properties、测试截图均忽略。无 authority 范围的新增 ignore。

## 恢复和模拟场景

正常/慢速流、HTTP 200 流内失败、尾行截断、断连均由真实测试 HTTP 链路产生。Provider 延迟产出中文与 emoji，测试 transport 刻意拆分 UTF-8/JSON 行、合并多行、去掉最终换行。TCP/WebView 不保证保留服务端每次 write 的边界，因此 parser 字节测试与浏览器/真机中途显示分别验收。

Enter 换行，仅点击发送；composition 期间禁发，连点只有一个请求。切后台停止本地读取并保留未决标识；回前台/重建会重新核验 fixture、读 sessions/history，不自动 POST，不实现 generation resume。同 fixture 缺少结果显示“结果待核对；本版尚不支持中途续传。”，不将缺少消息解释为从未执行。未知结果期间阻止继续发送，需核对历史或明确重启合成 fixture。

停止按钮调用现有取消 API，并在有限等待后停止本地读取。只有服务端终态确认才能显示已取消；请求超时/断网为 unknown，不承诺服务器一定停止。fixtureId 改变则清除旧视图与未决指针。服务端 dry-run 的 `keyConfigured=true` 表示该无密钥 Provider 已就绪，不代表载入了真实 key。

真机验收清单和实际结果见 [P60 Pro 验证记录](../../docs/verification/MOBILE_COMPATIBILITY_P60PRO.md)。若真机网络策略不成立，记录实际 origin、错误阶段和 WebView，不自动扩大安全例外。
