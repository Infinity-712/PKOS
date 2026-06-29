# PKOS 项目宪法（AGENTS.md）

本文件定义 PKOS 仓库内的硬约束。凡在本仓库中进行的自动化、协作、Agent 调用、数据写回与系统演进，均应遵守以下规则。

## 1) 基本定位

* PKOS 是一个以 **人类裁决优先** 为核心原则的个人知识与能动性操作系统。
* LLM / Agent 是协作者与执行辅助，不是事实裁决者、人生裁决者或权威写入者。
* 系统核心目标是：可审计、可回滚、可证伪、可维护、抗认知退化。
* 当前阶段不建设博客发布系统；PKOS 不承担公开发布链路。

## 2) 权威数据与存储边界

* 权威层仅允许仓库内文本文件：Markdown / YAML / JSON / JSONL。
* 禁止引入数据库作为权威事实层。
* RAG、搜索索引、前端导出数据、Agent 上下文包均为派生缓存，不是权威层。
* 所有关键规则、对象状态、复习日志、运行日志、Digest 与 Agent 边界必须能在 Git 中 diff 与回滚。
* `PKOS_DATA_ROOT` 可将真实数据根目录与代码仓库分离；它只影响 `objects/`、`review/`、`digests/`、`raw_vault/`、`inbox/`、`state/`、`runtime/` 等数据目录，不得改变 tools/docs/schema/AGENTS.md 的读取来源。

## 3) 知识对象状态机（强制）

可信知识轨道对象必须属于以下状态之一：

```text
raw -> parsed -> challenged -> trusted -> deprecated
```

要求：

* 不允许跳过必要阶段直接进入 `trusted`。
* 状态变更必须有可追溯记录：变更原因、时间、执行者。
* `trusted` 的最终裁决权属于人类维护者。
* `deprecated` 用于显式下线过时知识，不能静默删除。
* LLM 不得自行将任何对象迁移到 `trusted`。

## 4) 对象类型与 trusted 最低条件（强制）

对象类型分为两类：

### 4.1 可信知识轨道

固定类型：

```text
fact / skill / claim
```

#### fact

最低条件：

* 至少 1 个可靠来源；
* 已标注最易错点或反例提醒；
* 适用范围清晰。

#### skill

最低条件：

* 至少 1 次成功实践；
* 至少 1 个失败案例分析；
* 有可复习或可练习的最小单位。

#### claim

最低条件：

* 至少 1 次强反对或结构性反驳；
* 明确适用范围；
* 明确失效条件；
* 能区分事实依据、推理链与主观判断。

### 4.2 内部创作轨道

支持类型：

```text
creative
```

`creative` 用于内部写作、童话、宣言、随笔、灵感、草稿与表达性材料。

* 生命周期建议：`draft / revised / archived`
* 不进入 trusted 状态机。
* 不强制证据链。
* 不参与默认 SRS。
* 不绑定公开发布流程。
* 可引用可信知识对象，但 creative 自身不得被当作事实来源。

## 5) SRS 与复习日志（强制）

* 复习采用 SRS（间隔重复）调度。
* 复习日志必须 append-only：只追加，不改写历史记录。
* 推荐复习队列：

  * Daily：Fact + Skill
  * Weekly：Claim
* 复习评分写回必须通过确定性接口执行。
* 复习写回应同时记录：

  * object_id
  * score / result
  * timestamp
  * next_due_at
  * 执行方式
* LLM 可作为复习出题者，但不得作为掌握度最终裁决者。

## 6) Flow Hub 边界（v0.5 预留）

Flow Hub 是 PKOS 与月洛洛 / 前端之间的运行中枢。

Flow Hub 负责：

* Inbox：低摩擦捕获池；
* Current State：当前状态记录；
* Today Queue：今日行动队列；
* Review Queue：SRS 复习队列；
* Recovery Queue：恢复队列；
* Writing Queue：写作队列；
* Flow Budget：本周主流、次流、暂存流；
* Agent Context Pack：供月洛洛读取的压缩上下文包。

Flow Hub 不负责：

* 将对象迁移到 trusted；
* 替代 PKOS 权威层；
* 替代人类做长期人生决策；
* 绕过 Git 审计直接写入权威文件。

## 7) 月洛洛 / Agent 权限边界

月洛洛是主动交互层、生活现场接口与主体性维护辅助系统。

### 允许

* 主动提醒；
* 状态询问；
* 快速捕获；
* 任务轻调度；
* 复习推送；
* 恢复建议；
* Operational Skill 调用；
* 生成草稿、总结、候选分类；
* 读取 Flow Hub 输出的 Agent Context Pack；
* 通过确定性接口执行低风险写回。

### 禁止

* 自动裁定事实；
* 自动将对象设为 `trusted`；
* 自动删除对象；
* 自动修改 AGENTS.md、docs/ 下的治理文件；
* 自动发布或对外输出内容；
* 伪造引用来源；
* 未经检索或验证却给出确定性结论；
* 将 RAG 召回内容直接视为权威事实。

## 8) 写回权限分级

所有写回必须分级处理。

### L0：只读

允许自动执行。

示例：

* 读取对象；
* 读取队列；
* 读取 Digest；
* 读取 Agent Context Pack。

### L1：低风险 append-only 写入

可由 Agent 触发，但必须通过确定性接口，并自动 commit。

示例：

* inbox_item；
* state_snapshot；
* recovery_log；
* daily_note；
* review_log append。

### L2：确定性白名单写回

需要用户显式确认或前端点击触发。

示例：

* task done / postpone；
* review rating batch；
* tag add / remove；
* 有限字段编辑。

### L3：权威层变更

必须人工确认，不允许 Agent 自动执行。

示例：

* 状态迁移到 `trusted`；
* 删除对象；
* 修改 schema；
* 修改 AGENTS.md；
* 修改核心规则；
* 批量重构对象。

### L4：禁止

任何情况下均不允许。

示例：

* LLM 自行裁定事实；
* LLM 自行伪造来源；
* LLM 自动发布内容；
* LLM 绕过确定性 API 写文件；
* RAG 结果直接进入 trusted。

## 9) LLM 允许 / 禁止角色

### 允许

* 结构化提取器；
* 反对意见生成器；
* 复习出题者；
* 草稿生成助手；
* 查询解释器；
* Agent 上下文总结器；
* Operational Skill 建议器。

### 禁止

* 最终事实裁定者；
* 引用来源伪造者；
* 未经检索却给出确定性结论；
* 自动 trusted 迁移者；
* 自动发布者；
* 自动重构治理文件者。

## 10) 本地后端边界

* 本地后端默认仅允许监听 `127.0.0.1`。
* 禁止默认绑定 `0.0.0.0`。
* 写 API 必须采用白名单策略，不允许任意路径写入。
* 写回仅允许通过确定性接口执行，且必须：

  * 仅修改白名单目录；
  * 输出 diff 摘要；
  * 自动 git commit；
  * commit message 规范化；
  * 可回滚。

白名单目录初始建议：

```text
objects/
review/logs/
digests/
runtime/
inbox/
```

如需新增目录，必须先修改本文件或对应治理文档。

## 11) Digest 边界

Digest 是派生压缩层，不是新事实来源。

* Digest 每条关键结论必须带 references。
* Digest 不得凭空创造新事实。
* Digest 可分为：

  * Knowledge Digest：知识对象增量摘要；
  * Operational Review：任务 / 学习 / 恢复 / 写作运行回顾；
  * Creative Digest：写作材料整理。
* Digest 草稿可由 LLM 生成。
* Digest 最终写入必须由人类确认或通过确定性流程提交。
* 避免使用 `publish` 语义；推荐使用 `finalize` / `commit` / `archive`。

## 12) RAG Sidecar 边界

RAG 是派生检索层，不是权威层。

要求：

* RAG index 必须可删除、可重建。
* 每个 chunk 必须指向 source_path / object_id / status。
* 检索结果必须保留对象状态：raw / parsed / challenged / trusted / deprecated / creative。
* Agent 使用检索结果时必须区分状态：

  * raw：只能说“你曾记录过”；
  * parsed：只能作为候选材料；
  * challenged：必须提示存在反对或未定论；
  * trusted：可作为较可靠知识；
  * creative：只能作为表达或写作材料；
  * deprecated：默认不引用，除非说明历史版本。
* RAG 不得绕过 trusted 门禁。

## 13) 前端边界

当前前端主要用于私密操作台，不承担公开发布。

允许：

* Dashboard；
* Objects 浏览；
* Queues 浏览；
* Review 操作；
* Digest 浏览；
* Chat 页面；
* Flow Hub 状态面板；
* Inbox 管理；
* Recovery / Writing / Task 视图。

禁止：

* 建设公开博客发布流；
* 直接写文件；
* 绕过后端 API；
* 绕过 Git commit；
* 绕过 validate。

未来可扩展：

* PWA；
* Desktop App；
* Android App；
* 多端统一调用本地或私有 API。

## 14) 必须运行的命令

当前基础命令：

```bash
# 全量结构与规则校验
python -m tools.pkos validate

# 生成复习队列
python -m tools.pkos gen-queue

# 生成 Digest
python -m tools.pkos gen-digest

# 导出私密站数据 / Agent 上下文数据
python -m tools.pkos export-site-data
```

计划新增：

```bash
# 导出月洛洛上下文包
python -m tools.pkos export-agent-context

# 构建检索索引
python -m tools.pkos export-index

# 生成 Flow Hub 队列
python -m tools.pkos gen-flow
```

已废弃 / 当前禁用：

```bash
python -m tools.pkos publish-check
```

## 15) 删除范围声明

当前阶段明确不建设以下模块：

* Knowledge Blog；
* WordPress 发布；
* HTML 发布包；
* `blog_package/`；
* `site-public`；
* public creative route；
* public blog index；
* 公开发布门禁；
* WordPress REST API 集成；
* CDN / 图床 / 宝塔相关流程。

若未来重新引入公开发布，必须作为独立项目或独立模块重新设计，不得隐式恢复到 PKOS 主链路中。

## 16) 核心验收标准

任何修改必须满足：

* `pkos validate` 能通过；
* 复习日志 append-only；
* Agent 无 trusted 写权限；
* 权威层仍可 Git diff / rollback；
* 删除博客相关流程后，README、docs、CLI、前端、测试中不得残留必需依赖；
* Flow Hub / Agent / RAG 均不得替代权威层。
