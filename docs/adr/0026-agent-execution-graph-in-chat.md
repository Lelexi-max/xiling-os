# ADR 0026：Agent Execution Graph 归入 Chat 并从耐久日志投影

- 状态：已接受并实现（RG-1）
- 日期：2026-08-26

## 背景

旧顶层 Canvas 同时承担提示分支、Agent 运行观察、手工笔记和科研对象展示。它保存的是可编辑 `CanvasGraphDocument` JSON，而真实 Agent 执行已经由 `agent-center.sqlite` 中的 Session、Run、Operation、Entry、Usage 和 Compaction 记录。继续从 Canvas JSON解释 Agent 关系，会产生两套相互冲突的执行历史，并把拖动、删除或手工连线误当成运行事实。

产品已经确认三类图的边界：Agent 运行图属于 Chat；Scientific Canvas 属于 Research Graph；Literature Discovery Graph 属于文献工作台。

## 决策

1. Web 顶层导航撤下旧 Agent Canvas。Chat 顶部提供“对话 / 运行图”切换。
2. Agent Execution Graph 只通过 `GET /api/agent-center/graph` 查询，由 Server 从耐久 Agent Store 实时投影，不读取旧 Canvas JSON。
3. 图支持 `project` 和 `session` 两个作用域。项目作用域显示项目内全部 Session 和受界限的近期 Run；当前对话作用域只显示选中 Session。
4. 节点语义为 Project、Session、Run、Model Operation、Tool Operation、Message/Tool Result Entry 和 Compaction；关系为 contains、started、continued、invoked、returned、produced、compacted。
5. Tool-call Entry 与 Tool Operation 表达同一调用时，投影只显示 Operation；Tool-result Entry 保留并通过 `returned` 连接，避免重复节点。
6. API 不返回原始模型请求、工具参数、工具完整结果或事件 payload，只返回短摘要、稳定 source ID、状态、时间和用量指标。默认限制 24 Session、80 Run、160 Operation 和 160 可见 Entry，并明确返回 `truncated`。
7. 图节点可自由拖动、自动纵向整理、缩放和平移，但位置只属于当前浏览器视图，不写回 Agent Store。拖动绝不改写执行关系。
8. 进入运行图时默认收起 Artifact 面板，让项目级关系获得完整工作区；返回对话时恢复用户此前的面板状态。
9. Chat 不再把回答写入旧 Canvas。待 RG-3 Scientific Canvas 接入后，科研沉淀通过 Research Graph proposal/confirmation 流程完成。

## 后果

- Agent 执行只有一个事实源，重启后仍可重建相同语义图。
- Chat 与运行图从两个维度观察同一个 Harness：前者适合阅读当前交互，后者适合检查项目级运行、工具和恢复状态。
- RG-4 已按 [ADR 0029](0029-literature-evidence-promotion-and-canvas-retirement.md) 删除旧 `CanvasView`、Canvas HTTP 模块与文件仓储。
- Context Assembler 已在 RG-3 切换为 Research Graph 当前实体、有限邻域与显式引用；Agent Execution Graph 本身不参与模型上下文组装。

## 验证

- Project/session 作用域投影和跨项目拒绝集成测试。
- Operation/Entry 去重、Tool returned、Model produced 与 Token 指标单元测试。
- Web typecheck/build。
- 浏览器验证项目/当前对话过滤、节点详情、自由拖动、自动整理、面板恢复和控制台零错误。

## 被替代关系

本 ADR 替代 [ADR 0004](0004-flowith-style-context-canvas.md) 中“旧 Canvas 同时是 Agent 运行图”的部分。Flowith 式空间交互仍可用于 RG-3 Scientific Canvas，但其科研关系必须来自 Research Graph，而不是 Agent Session Tree 或旧 Canvas JSON。
