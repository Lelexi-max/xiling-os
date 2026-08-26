# 架构现代化执行计划（2026-08-24）

> 2026-08-26 更新：Canvas/科研事实与持久化部分已由 [ADR 0025](../adr/0025-research-graph-database.md)、[ADR 0026](../adr/0026-agent-execution-graph-in-chat.md)、[ADR 0027](../adr/0027-durable-research-graph-projection.md) 和 [Research Graph 架构](research-graph.md)替代。RG-2 已完成 durable projection chain 并退役 Workflow JSON/旧文件级 settlement。当前开发期不迁移旧数据，也不保留双写兼容；其他模块化单体与 Pi Harness 边界继续有效。

## 评估结论

原 Gate 计划正确建立了产品闭环、审批、容器、跨平台和上下文经济原则，但“按 Gate 追加功能”的实现方式已经不适合继续扩展。主要风险是：单一 Server 文件承载过多领域、前后端重复协议、JSON 画布并发覆盖、SQLite 无显式迁移、KnowledgeService 暴露面过宽，以及开发时 workspace 源码/产物混用。

本轮选择模块化单体，不改成微服务。原因是汐灵仍是本地优先的个人科研工作台，拆服务会增加 Windows/WSL2 安装、端口、升级和故障诊断成本，却不能解决现阶段的边界问题。

## 执行阶段

1. **构建边界**：workspace 包在运行时只暴露 `dist`；开发先构建再并行 watch；增加依赖方向门禁。
2. **共享协议**：建立 `api-contracts`，前后端共享 Zod 契约；统一 JSON 客户端与 SSE 解码。
3. **服务端模块化**：按 workspace、literature、research-graph、connectors、workflows、settings 与 legacy-gate3 注册路由；旧 Canvas 模块已删除，`app.ts` 只保留装配和跨模块 Agent/投影编排。
4. **持久化可靠性**：Knowledge 数据库使用版本迁移和窄 ports；Scientific Canvas 布局使用独立 SQLite 与 revision，科研事实使用 Research Graph。
5. **上下文机制纠偏**：使用用户选择的 Research Graph 活动实体、有限两跳邻域、显式引用、Capsule、按需 Skill/tool、组装缓存和 TokenLedger；不把循环科研图当成对话树，也不引入正常任务固定 token 上限。
6. **回归门禁**：新增 API 契约、SSE 分片、迁移版本、画布并发与架构依赖测试；运行全量 typecheck/test/build/smoke/compliance。

## 对旧计划的修订

- Gate 1–4 不再作为代码目录的长期架构；它们只保留为产品验收记录。
- `Gate3ResearchService` 降为兼容层；`ProjectWorkflowService` 是新功能唯一科研闭环。
- “SQLite/Drizzle”修订为“SQLite + 明确 Repository/Port 边界”。当前实际适配器使用 Node SQLite；在没有迁移收益前不强行引入第二套 ORM。
- 旧 Canvas 项目图文档已经删除；Scientific Canvas 是 Research Graph 的表现投影，布局保存不能伪装成科研事实版本史。
- 固定 token 数字只保留为安全和模型窗口保护；优化目标是上下文拓扑、去重、按需加载与可观测性。
- Gate 5 源码候选与本地架构收口已完成；[Gate 4.5](../gate-4.5-agent-center-correction.md) 已把短命 Agent、前端结果持久化、Compaction 和旧 Canvas 来源截断问题收拢到服务端 Research Agent Harness。后续不再设置普通开发确认点，真实 Windows/WSL2、签名和外部发布权限仍按发布门禁处理。

## Gate 4.5 补充阶段

1. **事实样例**：核对固定 Pi 版本的 Agent、Session、Compaction 与 Harness 实际能力，不按目标文档假设实现已经可用。
2. **服务端中枢**：建立耐久 session/run/operation、单写者、snapshot/event subscription、取消与恢复。
3. **双层上下文**：Pi Compaction 管理对话和工具轨迹；Scientific Capsule 管理科研语义和证据引用。
4. **无损引用**：Canvas 展示摘要通过 source entry 引用完整消息，不复制截断正文作为事实源。
5. **主路径切换**：Web 不再持久化 Agent 结果或编排工具业务状态；迁移必须先 dry-run、备份并经用户确认。

详细确认点、迁移顺序和验收矩阵以 Gate 4.5 文档为准。

## 完成标准

- 架构依赖门禁通过；共享包可独立构建。
- Chat、画布、项目、Wiki、文献、连接器与 Workflow 现有集成测试不回退。
- 并发画布更新不会静默覆盖；旧数据库与旧画布文件可读取。
- 文档中的类型、主闭环和发布状态与代码一致。
