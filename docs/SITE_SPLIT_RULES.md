# Site Split Rules (v0.3)

## 分站边界
- `site-public`：仅公网内容（Knowledge Blog + 可公开的 Creative Output）。
- `site-private`：Dashboard/objects/queues/digests/chat 等仅本地预览，不部署公网。

## 部署原则
- 不为 `site-private` 实现登录系统（因为不部署公网）。
- public 部署时只使用 `site-public` 目录。

## Creative 通道
- Creative 与 blog 不合并：`/creative/` 独立路由与独立模板。
- Creative 页面只显示 lifecycle：`draft/revised/published/archived` 与基础字段。
- 是否发布由人类决定，不新增强制门禁。

## GUI 边界
- GUI 不可直接写回权威层文件。
- Create/Review 操作只生成“可复制文本/命令片段”。
