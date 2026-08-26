# ADR 0028：科研画布布局与 Research Graph 局部上下文

- 状态：接受
- 日期：2026-08-26

## 背景

旧 Canvas 同时承担 Agent 对话树、科研事实展示、布局和 Chat 上下文锚点，导致执行关系与科研证据关系混淆。Research Graph 已成为科研事实唯一图源后，节点拖动也不能再修改或伪装科研事实。

## 决策

1. 顶层“科研画布”只读取 `ResearchGraphProjection`，提供 `all`、`literature`、`evidence`、`provenance`、`artifacts` 五个服务端投影视图。
2. 坐标和 viewport 保存到独立 `scientific-canvas-layout.sqlite`，以 `projectId + view` 隔离，并用 revision 乐观并发控制。
3. Layout API 只接受当前投影内的实体 ID；布局保存不调用 Research Graph ChangeSet，也不触发科研审批。
4. 用户可从科研画布显式选择一个实体作为当前 Chat 上下文，并添加至多 12 个显式引用。选择操作不会隐式发生在普通节点点击上。
5. Context Broker 不把 Research Graph 当作树，也不加载整张图。它从活动实体进行确定性的两跳局部遍历，默认最多选择 8 个邻域实体，再叠加显式引用、内容寻址 Capsule 和 Artifact URI。
6. 旧 Canvas 不再参与 Chat 上下文；开发期旧会话中的旧节点 ID 在下一轮自动回退到项目 ResearchQuestion。

## 理由

- 把事实与表现状态分开，避免拖动节点污染科研溯源。
- 图数据库负责复杂科研关系；SQLite 布局仓储负责高频、可覆盖的 UI 状态，各自采用适合的事务语义。
- 节省 token 来自稀疏选择、局部关系查询、Capsule 复用和 Artifact 引用，而非固定 token 配额。
- 显式“设为 Chat 上下文”使用户能理解并审计上下文来源，普通浏览不会悄悄改变 Agent 行为。

## 后果

- `CanvasBranchContext`/`canvasContext` 字段名暂为数据库兼容名，其语义已变为 Research Graph selection；后续存储 schema 清理可改名，不得恢复旧 Canvas 语义。
- Research Graph 图很大时仍需在服务端增加焦点查询端点；当前项目级投影适合 MVP 数据量，但不能演化为浏览器下载无限整图。
- 自动布局是确定性的纵向语义层级，同级横向排布；用户拖动后的布局按视图独立保存。

## 验证

- Layout Store 重启恢复、项目/视图隔离、revision 冲突测试。
- Layout API 拒绝投影外实体。
- 循环 Research Graph 的上下文投影保持有界、确定且活动实体最后进入精确上下文。
- Chat 只接收有限邻域和显式引用，整张图与 Agent Execution Graph 均不进入模型。
