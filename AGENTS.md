# PKOS 项目宪法（AGENTS.md）

本文件定义 PKOS 仓库内的硬约束。凡在本仓库中进行的自动化、协作与发布流程，均应遵守以下规则。

## 1) 基本定位

- PKOS 是一个“**人类裁决优先**”的个人知识操作系统。
- LLM 是协作者，不是裁决者。
- 系统核心是可审计、可回滚、可证伪，而非“自动生成更多内容”。

## 2) 权威数据与存储边界

- 权威层仅允许仓库内文本文件：Markdown / YAML / JSON。
- 禁止引入数据库作为权威事实层。
- 所有关键规则、状态迁移、发布判断必须能在 Git 中 diff 与回滚。

## 3) 知识对象状态机（强制）

所有对象必须属于以下状态之一：

`raw -> parsed -> challenged -> trusted -> deprecated`

要求：
- 不允许跳过必要阶段直接进入 `trusted`。
- 状态变更必须有可追溯记录（变更原因、时间、执行者）。
- `deprecated` 用于显式下线过时知识，不能静默删除。

## 4) 对象类型与 trusted 最低条件（强制）

对象类型固定为：`fact / skill / claim`（可信知识轨道）；另支持 `creative` 作为独立创作轨道。

### fact
- 最低条件：
  - 至少 1 个可靠来源；
  - 已标注最易错点（或反例提醒）。

### skill
- 最低条件：
  - 至少 1 次成功实践；
  - 至少 1 个失败案例分析。

### claim
- 最低条件：
  - 至少 1 次强反对（结构性反驳）；
  - 明确适用范围与失效条件。

补充：进入 `trusted` 的最终裁决权属于人类维护者。

### creative（独立轨道）
- 生命周期建议：`draft / revised / published / archived`
- 不进入 trusted，不强制证据链，不参与默认 SRS。

## 5) SRS 与复习日志（强制）

- 复习采用 SRS（间隔重复）调度。
- 复习日志必须 append-only（只追加，不改写历史记录）。
- 复习系统推荐双队列：
  - Daily：Fact + Skill
  - Weekly：Claim

## 6) 博客发布门禁（强制）

发布到 `blog/published/`（Knowledge Blog）的内容必须满足：
- 引用对象全部处于 `trusted`；
- 文章应标注假设、失效条件、最后更新日期；
- 发布前执行门禁校验，失败即阻断发布。

Creative 输出由人类决定是否发布，不强制 trusted 门禁。

## 7) LLM 允许 / 禁止角色

### 允许
- 结构化提取器
- 反对意见生成器
- 复习出题者
- 草稿生成助手（非终稿）

### 禁止
- 最终事实裁定者
- 引用来源伪造者
- 未经检索却给出确定性结论

## 8) 必须运行的命令（占位，v0.1）

以下命令在 CI 与发布流程中应被实现并执行：

```bash
# 全量结构与规则校验
pkos validate

# 生成复习队列
pkos gen-queue

# 博客发布门禁检查
pkos publish-check
```

> v0.1 初期可先以占位脚本返回明确提示；后续逐步替换为真实校验逻辑。


## 9) GUI 分站与导出边界（v0.3）

- 分站边界：
  - `site-public` 仅用于公网部署（Knowledge Blog / 可公开 Creative 输出）
  - `site-private`（dashboard/objects/queues/digests/chat 等）仅本地预览，不部署公网
- `pkos export-site-data` 必须只读：不得修改 `objects/`、`review/logs/`、`digests/`、`blog/` 源文件。
- 严格隐私边界：
  - public 只导出 `blog_index` 白名单字段
  - private 才能导出 objects/queues/digests 索引
- GUI 不可写：
  - Create 仅生成模板文本（复制/下载）
  - Review 评分仅生成命令片段/日志片段（复制），不直接写入
- Creative 输出独立通道：`/creative/` 独立路由 + 独立模板，不与 blog 混用主题。

## 10) 正文规范（v0.4）

- `content` 是对象的规范化正文（canonical body）。
- Dashboard 预览与 LLM 上下文优先使用 `content`。
- `definition / canonical_example / claim_statement` 等字段属于可选附块（blocks），用于类型化补充，不再作为正文主来源。
- 兼容旧对象：允许缺少 `content`，但新对象与 demo 必须优先填写 `content`。

