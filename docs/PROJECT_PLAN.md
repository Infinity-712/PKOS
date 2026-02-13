
---

# 📘 项目总策划案

## 项目代号：Personal Knowledge OS（PKOS）

**当前版本**：v0.3  
**状态**：设计中（Design Phase）  
**维护者**：<你的名字>  
**最后更新**：2026-02-13

---

## 版本变更摘要（v0.2 → v0.3）

- Weekly Digest 明确定位为**知识进展周报**（objects 增量索引），不固化行动建议。
    
- 输出通道拆分为 Knowledge Blog（严格 trusted 门禁）与 Creative Output（人类决定是否发布，不强制门禁）。
    
- Creative 生命周期（draft/revised/published/archived）仅用于组织与筛选，不进入可信知识状态机。

---

## 一、项目背景与核心问题

### 1.1 背景动机

在大模型深度介入学习、写作与知识生产的背景下，个人学习面临两类结构性风险：

1. **认知退化风险**
    
    - AI 生成内容高度流畅但低可验证
        
    - 原始来源被“总结/复述”遮蔽，逐渐丧失判断力
        
    - 人从“建模者”退化为“提示词操作员”
        
2. **知识系统脆弱性风险**
    
    - 知识碎片堆积但无法复盘/纠错/升级
        
    - “信息管理”与“知识形成”混在一起，导致可信度无法分层
        
    - 缺乏机制化的复习与对抗，长期遗忘与幻觉污染不可避免

### 1.2 核心问题

如何构建一个 3–5 年后仍可维护的个人知识系统，使其：

- 可靠：可复现、可审计、可追溯
    
- 可维护：边界清晰、规则可升级
    
- 可纠错：可证伪、可回滚、证据链完整
    
- 抗退化：避免把“思考”外包给 LLM

---

## 二、总体目标与成功标准

### 2.1 总体目标（Goal）

建立一个以“对象 + 状态机 + 门禁 + 复习调度”为核心的 Personal Knowledge OS，使知识从收集到可信形成具备明确流转机制，并能稳定输出到博客/创作渠道。

### 2.2 成功标准（Success Criteria）

**基础闭环（v0.1–v0.3 必须达成）**

- 所有知识以文件为权威层（Git 可审计）
    
- 三类对象（fact/skill/claim）可被校验、可追踪状态
    
- trusted 有硬门禁（缺证据/缺对抗不可进入）
    
- SRS 复习队列可生成并可稳定运行
    
- 博客发布门禁可阻断非可信引用
    
- Weekly Digest 可生成“知识进展周报”（不固化行动建议）
    
- Creative 内容可独立存放与发布（由人类决定，无强制门禁）

---

## 三、核心原则（必须长期保持）

1. **人类裁决优先**
    
    - LLM 不拥有最终判断权
        
    - 可信迁移必须可审计，且人类承担裁决责任
        
2. **抗退化优先于便利**
    
    - 任何自动化必须保留可证伪性、可追溯性、可回滚性
        
3. **规则硬化在仓库中**
    
    - 对话不是权威；规则、模板、门禁必须写进仓库（AGENTS.md + schema + CI）
        
4. **主动对抗幻觉**
    
    - trusted 层不得出现“无来源的确定性结论”
        
    - LLM 输出默认是“待验证材料”，而非事实

---

## 四、知识对象模型（Objects）

### 4.1 对象类型（Types）

|类型|含义|典型例子|trusted 最低条件（门禁）|
|---|---|---|---|
|fact|可验证事实/定义/数据点|概念定义、语法规则、API 行为|至少 1 条 verification_sources + 最易错点/反例|
|skill|可练习技能/程序性知识|算法题型、写作套路、口语表达|practice_log：至少 1 成功 + 1 失败复盘|
|claim|观点/论断/模型假设|论文观点、社会理论判断|counter_arguments 非空 + 至少一次强反对记录 + scope/失效条件|
|creative|表达性创作（非真伪对象）|随笔、诗文、灵感碎片|不进入 trusted；可选生命周期用于组织|

> 注：creative 不属于认识论对象，因此不参与 raw→trusted 的可信状态机。

### 4.2 通用字段（建议 schema）

- `id`：全局唯一
    
- `type`：fact/skill/claim/creative
    
- `status`：见状态机（creative 用独立枚举）
    
- `title`：标题
    
- `summary`：一句话摘要
    
- `tags`：标签
    
- `source`：来源类型（原始材料指针）
    
- `anchors`：定位（页码/时间戳/URL fragment）
    
- `verification_sources`：验证来源列表（fact 强制）
    
- `counter_arguments`：反对意见列表（claim 强制）
    
- `created_at / updated_at`
    
- `srs`：复习字段（fact/skill/claim 可用；creative 默认不用）

---

## 五、状态机与流转门禁（可信知识层）

### 5.1 状态机（fact/skill/claim）

`raw → parsed → challenged → trusted → deprecated`

- raw：原始收集或未结构化材料
    
- parsed：已结构化为对象，字段完整但未对抗
    
- challenged：已进行反对/验证尝试（反例、对照来源、失败记录）
    
- trusted：满足门禁、可对外引用
    
- deprecated：失效、被替代或证伪

### 5.2 trusted 门禁（硬规则）

- fact：必须有 `verification_sources` ≥ 1；必须记录最易错点/反例（字段由 schema 定义）
    
- skill：必须有 `practice_log`（成功+失败复盘）
    
- claim：必须有 `counter_arguments` + “强反对”记录 + scope/失效条件

---

## 六、复习系统（SRS）

### 6.1 设计目标

- 把“记得”变成系统调度而非意志力
    
- 复习过程可记录、可复盘、可调参

### 6.2 当前策略（v0.3）

- daily/weekly 是**队列视图**，不是算法本体
    
- 底层使用 `srs` 字段驱动：`due_at / interval_days / ease / last_reviewed_at`
    
- 评分方式：人类复习后选择 1–5 档（熟练度），系统更新 `srs`（可采用 SM-2 子集）

> 完整 SuperMemo/复杂策略作为长期可选项，不阻塞 demo。

---

## 七、输出通道（Publishing）

### 7.1 Knowledge Blog（严格门禁）

- 文章引用对象必须全部 `trusted`
    
- publish-check 阻断：缺 frontmatter、缺结构字段、引用非 trusted 或不存在对象

### 7.2 Creative Output（人类决定）

- creative 可发布到静态站（与你的决定一致）
    
- 不强制可信门禁（可选仅做结构校验，且不得阻塞发布）

---

## 八、Weekly Digest（知识进展周报）

### 8.1 定位

- Digest 是派生索引，用于降低 LLM 上下文压力
    
- 不固化行动建议，不生成新事实
    
- 每条必须可追溯：包含 references（对象 id 列表）

### 8.2 文件规范

- 路径：`digests/YYYY-Www.md`（ISO 周）
    
- 内容：本周新增/更新/状态迁移的对象清单 + 索引式摘要 + references

---

## 九、系统架构（文件优先 + 工具层）

### 9.1 仓库层（权威层）

- objects/：权威对象文件（可审计、可回滚）
    
- raw_vault/：原始材料（append-only）
    
- review/：队列与日志（append-only）
    
- blog/：知识输出
    
- digests/：周报派生索引
    
- docs/：规则与策划案

### 9.2 工具层（CLI/CI）

- `pkos validate`：schema + 门禁
    
- `pkos gen-queue`：生成 daily/weekly 队列
    
- `pkos publish-check`：知识博客门禁
    
- `pkos gen-digest`：周报索引
    
- （计划）`pkos review-log append`：复习回写闭环（日志 + srs 更新）

---

## 十、版本路线图

### v0.1（已实现）

- 仓库骨架 + 三命令闭环（validate/gen-queue/publish-check）
    
- schema 驱动与公共解析层

### v0.2（已规划）

- 规则集中化、解析层统一、回归测试集扩展

### v0.3（当前）

- Weekly Digest（知识进展）
    
- Creative 类型与独立生命周期
    
- 输出通道拆分（Knowledge Blog vs Creative Output）
    
- SRS：5 档评分 + SM-2 子集（可选实现，demo 可先留接口）

---

## 十一、验收标准（v0.3）

- Digest 每条都有 references 且可解析到对象
    
- Creative 不进入 trusted 轨道，不影响现有门禁
    
- Knowledge Blog 发布仍严格阻断非 trusted 引用
    
- 规则与行为一致：docs/ 与 tools/ 实现一致，可审计可回滚

---

## 十二、未决问题清单（需人类裁决）

- SRS 策略接口：是否抽象为 pluggable strategy
    
- Creative 发布是否与 blog 共享同一静态站，如何路由与主题统一
    
- Digest 的粒度：按 updated_at 或 status 迁移事件为主（建议两者都支持）

---

# v0.3 增补：极简 GUI（与静态站配合，用于 demo）

> 你说 demo 需要一定 GUI、极简风、且不想纯 CLI。这里给出最小可维护的方案：**GUI 只做“只读浏览 + 过滤 + 跳转”，编辑仍在 VS Code。**  
> 这样不会破坏“文件权威层”，也不会引入服务端状态/数据库。

## A. 目标（Goal）

- 在静态站里提供一个极简 Dashboard：
    
    - 浏览 objects（按 type/status/tags 过滤）
        
    - 查看 daily/weekly 队列
        
    - 查看 digests（按周）
        
    - 查看 blog/creative 已发布内容的索引入口

## B. 约束（Constraints）

- 静态站可部署（GitHub Pages/Netlify 等）
    
- 不引入后端服务与数据库
    
- UI 只读；任何“写回对象文件”的行为仍由 CLI 完成（避免把浏览器变成权威写入端）

## C. 方案（Options）

### Option 1（推荐）：静态站 + 生成 JSON 索引 + 前端极简 JS 读索引

- 工具新增：`pkos export-index`（或并入 `gen-queue/gen-digest`）生成：
    
    - `site/_pkos/index.json`（对象索引：id/type/status/title/summary/tags/updated_at/path）
        
    - `site/_pkos/queues.json`（daily/weekly 的条目列表）
        
    - `site/_pkos/digests.json`（周报索引列表）
        
- 前端页面：`site/dashboard/index.html`（极简 CSS + JS）
    
- 优点：完全静态、可审计、可缓存；GUI 与权威层隔离清晰

### Option 2：直接在前端抓取仓库文件并解析 YAML

- 不推荐：浏览器端解析 YAML + 遍历大量文件会慢、也更难保证稳定性

## D. 推荐架构与接口

- **新增命令**：`pkos export-site-data --out site/_pkos/`
    
- **静态页面**：
    
    - `/dashboard/`：总览
        
    - `/dashboard/objects`：对象列表（过滤器：type/status/tags）
        
    - `/dashboard/review`：daily/weekly 队列
        
    - `/dashboard/digests`：周报列表
        
- **不做**：浏览器内编辑对象、写回 YAML、提交 Git

## E. 验收（demo 标准）

- 打开静态站即可看到 dashboard
    
- 不跑 CLI 也能浏览 objects/队列/周报（基于导出的 JSON）
    
- 任意条目能跳转到对应 markdown 页面或仓库路径（可选）

---

### 一句话结语（作为项目精神）

> **这个系统的目的，不是让你“知道更多”，  
> 而是让你在 5 年后，仍然知道哪些东西你真的知道。**
