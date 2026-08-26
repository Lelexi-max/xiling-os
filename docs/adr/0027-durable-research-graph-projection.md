# ADR 0027：Research Graph 使用 durable outbox 与目标应用账本

- 状态：已接受
- 日期：2026-08-26
- 决策阶段：RG-2

## 背景

Agent、项目知识、科研 Workflow 与 Research Graph 分属多个本地数据库。把 Workflow 完成结果依次写进 ProjectItem、Wiki 和旧 Canvas 只能做到“尽量幂等”，无法证明崩溃后没有漏写或半写，也会让同一科研事实出现多个所有者。

汐灵是本地优先模块化单体，当前没有引入消息总线、分布式事务或独立图服务的必要。开发阶段也不迁移旧 Workflow JSON 和旧 Canvas 数据。

## 决策

1. Knowledge SQLite schema v2 增加 `research_projection_outbox`；Project、WikiRevision、Evidence 捕获记录与 outbox 在同一 SQLite 事务提交。
2. Workflow 主仓储从 JSON 改为独立 `project-workflows.sqlite`；每次状态快照与 outbox 在同一事务提交。
3. Agent Store 已有追加式 `agent_events`，直接作为 Agent 侧 durable source journal，不复制第二份 outbox。
4. Research Graph schema v2 增加 `ProjectionLedger`。节点、关系与 projection key/source hash 在同一 Ladybug 事务提交。
5. 相同 projection key 与相同内容重放为 no-op；相同 key 对应不同内容视为确定性冲突并拒绝。
6. Server 启动时 reconcile，读取 Research Graph 前再做有界 reconcile。源端只在目标事务成功或确认已应用后标记 outbox。
7. 删除 Workflow → ProjectItem/Wiki/旧 Canvas 的文件级 settlement。Wiki 正文仍归 Knowledge；科研关系和计算溯源归 Research Graph。
8. 不把整个图或 outbox payload 放入模型上下文。后续 Agent 只通过受界限 Research Graph 查询工具读取局部投影。

## 崩溃语义

- 源事务已提交、目标未提交：outbox/journal 保留，reconcile 重试。
- 目标已提交、源未确认：applied ledger 命中，目标 no-op，随后确认源记录。
- 目标事务中途失败：科研节点、关系和 ledger 一起回滚。
- projection key 被不同内容复用：失败并保留源事件，等待人工修正 projector，而不是静默覆盖。

## 后果

- 获得至少一次传递、目标恰好一次效果和可测试的重启恢复，不需要常驻消息中间件。
- Workflow 状态不再是文件快照，Windows/WSL2 下也遵循 SQLite 单写与 ext4 存储边界。
- Research Graph 是派生但耐久的查询事实源；源命令记录仍由 Knowledge、Workflow 和 Agent Store 所有。
- 当前单 Server 实例是写入前提。未来多实例化前必须增加 projector lease 或队列，不能直接共享 Ladybug 文件。

## 验证

- `packages/research-graph/src/index.test.ts`
- `packages/knowledge/src/index.test.ts`
- `apps/server/src/project-workflow.test.ts`
- `apps/server/src/research-graph-projector.test.ts`
- `apps/server/src/app.test.ts`
- `scripts/research-graph-smoke.mjs`
