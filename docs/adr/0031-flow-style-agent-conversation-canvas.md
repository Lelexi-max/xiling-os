# ADR 0031：Agent 运行图采用 Flowith 式低密度对话投影

- 状态：已接受并实现
- 日期：2026-08-27

## 背景

Agent Store 会记录 Session、Run、Model Operation、Tool Operation、Entry、Usage 与 Compaction。这些事实适合审计和恢复，却不适合作为默认画布节点。旧实现把所有事实平铺为卡片，节点数量随一次工具循环快速增长，用户难以判断哪一轮对话值得继续，也无法像对话画布一样从节点继续或组合引用。

Flowith 官方 Node Interaction Mode 的核心不是视觉复制，而是把输入和回答作为可导航节点，并提供 Follow-up First 与 Quote First 两种上下文选择方式。汐灵采用这一交互原则，但不让 Agent 对话节点替代 Research Graph 科研事实。

## 决策

1. `GET /api/agent-center/graph` 继续返回完整、有界、只读的 Agent 执行事实，作为审计与恢复真相源。
2. Web 增加纯投影层，把每个 Run 转成一个 Prompt 节点，把最终 Assistant Entry 转成一个 Response 节点；Model、Tool、Tool Result、Usage 与 Compaction 折叠到 Response 元数据和按需详情。
3. 默认作用域为当前 Session。项目全景只额外显示轻量 Thread 根节点，不恢复 Project/Operation/Entry 的默认平铺。
4. Prompt → Response 使用实线；上一轮 Response → 下一轮 Prompt 使用虚线。布局纵向表达先后关系，同级线程横向排列，节点可自由拖动且不写回 Agent Store。
5. “沿节点继续”选择单一节点及其祖先路径；“组合引用”允许选择多个节点。选中节点以精简摘要显式附加到同一个 Assistant UI Composer，再进入原有 Agent Harness，不建立第二套消息发送路径。
6. 节点普通点击只改变上下文选择。只有显式点击详情按钮才打开耐久运行信息，避免日志干扰主任务。
7. 该画布只表达 Agent 对话与运行脉络。Claim、Evidence、Paper、Run、Artifact 和 Provenance 仍由 Scientific Canvas 从 Research Graph 投影。

## Token 与人机功效影响

- 折叠只改变显示，不把隐藏 Operation 或 Tool Result 自动注入模型。
- Follow-up/Quote 只发送被选择节点的短摘要；当前 Session 历史仍由既有 Context Assembler 和压缩机制管理。
- 默认可见节点数约为 Run 数的两倍，不再随工具调用数线性膨胀。

## 验证

- 单元测试验证一次包含模型、工具与多条 Entry 的 Run 只产生 Prompt/Response 两个可见节点。
- 项目作用域只增加 Thread 根，并保持纵向层级。
- 浏览器验证当前对话默认、节点选择、组合引用、详情按需打开、自由拖动、画布 Composer 与窄屏无溢出。

## 参考

- [Flowith Node Interaction Mode Guide](https://flowith.io/docs/en/canvas/node-interaction/)
- [ADR 0026：Agent Execution Graph 归入 Chat](0026-agent-execution-graph-in-chat.md)
- [ADR 0028：科研画布布局与 Research Graph 局部上下文](0028-scientific-canvas-layout-and-context.md)
