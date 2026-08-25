# Gate 4.5-D：主路径所有权与清理报告

> 状态：实现完成，确认点 D 已由用户确认
> 日期：2026-08-25

## 结果

正式 Chat 与 Canvas 现在只有一条 Agent 写路径：

```text
Web command
  → Agent Center 创建耐久 Run/User Entry
  → Pi Runtime 产生事件
  → Harness 保存 Operation/Entry/Usage/Event
  → Server Host 投影已持久化的计划结果
  → Workflow draft + 独立 workflow.projected Event
  → Web 仅刷新视图
```

`POST /api/chat/stream` 和 `POST /api/gate4/chat-sessions/:id/messages` 已删除。`GET .../messages` 保留为 Agent Entry 的界面恢复接口，并在迁移窗口内只读回退旧 Knowledge 消息。Knowledge 的旧消息表不再有生产写入口。

## Workflow 投影一致性

- 原始 `tool.finished`、Tool Operation 和 Tool Result Entry 先写入 Agent Store。
- Projector 位于 Server Host，不进入 Pi Runtime 或 `@xiling/agent-harness`，因此不扩大 Pi 升级耦合面。
- 投影只接受通过共享 connector schema 校验的 `plan_ocean_data_subset` 结果。
- 稳定键由 projector 版本、Project、Session、Run 和规范化请求哈希组成；恢复后 callId 改变不会重复创建草稿。
- 投影只能创建 `draft`，不能自动 probe、approve、download 或 run。
- 成功和失败使用独立 `workflow.projected` / `workflow.projection.failed` 事件，不修改原始工具事实。
- 启动 reconcile 扫描已有 tool result；缺失 projection event 时幂等补建草稿或事件。
- Workflow 写文件按快照串行保存，避免并发 rename 的旧写覆盖新写。
- Approval 保存当前 request hash；Run 只接受与批准哈希一致的计划。

Agent SQLite 与 Workflow JSON 仍不是同一事务。当前单机模块化单体通过“durable source event + stable idempotency key + reconcile”获得可恢复的最终一致性；未来只有在多进程写入时才需要 SQLite outbox 或统一事务存储。

## 作用域与前端边界

- Workflow list、action 和 Artifact 读取校验 active Project、Workflow.projectId、Knowledge Chat Session.projectId。
- Action body 与 Artifact query 必须显式提供 `projectId`；跨项目访问返回 404。
- Chat 删除模块级 retained message/run/abort Map。组件级 `AbortController` 只触发 Server cancel，不是 Run 真相源。
- 切换会话后旧 Run 的事件不再污染当前视图；Run 结束后从 Agent Entry 重读耐久消息。
- Canvas/Chat 只消费 projection event，不创建 Workflow。

## 上下文清理

旧 branch Capsule 会生成并入库，也会改变 `projectionHash`，但 Context Assembler 从未使用它的正文。该路径已删除。当前机制为：

- DAG 决定活动祖先与显式 Quote；
- 较早节点使用各自 node Capsule；
- 近期节点与 Quote 使用原文；
- 对话由 Agent Compaction 处理，原 Entry 永不删除。

历史 branch 行可留在旧数据库中作为无害迁移残留，不再读取、生成或影响模型请求；后续 Knowledge schema 清理时统一删除。

## 自动化证据

- Projector 单元测试覆盖成功、无关工具、无效 schema、可重试失败、恢复后 callId 改变和启动 reconcile。
- Workflow 测试覆盖稳定键幂等、冲突拒绝、批准哈希和审批门禁。
- Agent Harness 测试覆盖服务关闭等待在途执行，避免 SQLite 已关闭后的尾写。
- Server 集成测试覆盖旧写 API 404、正式 Agent 上下文预算、Canvas context、跨项目 Run/Workflow/Artifact 404 和完整科研闭环。
- Context 测试继续覆盖分支选择、Quote、node Capsule、窗口降级与组装缓存。
- `scripts/gate-4.5-d-main-path-smoke.mjs` 离线验证旧写入口关闭、正式 Agent Run、重启恢复、Workflow 项目隔离与未审批拒绝执行。

最终门禁及数量以本次 Gate 交付消息为准。
