# ADR 0018：项目级科研闭环编排

- 状态：已接受
- 日期：2026-08-24

## 背景

汐灵 OS 已有 Pi 工具调用、官方数据连接器、审批、容器 Runner、Reviewer、RO-Crate、项目、Wiki 和画布，但它们此前是相互独立的技术样例。Chat 只能生成自然语言计划，无法形成可恢复、可审批、可执行的项目科研链路。

## 决策

增加窄职责的 `ProjectWorkflowService`，复用现有模块并维护以下持久化状态机：

`draft → probing → pending_approval → approved → downloading → analyzing → completed`

同时支持 `rejected`、`failed`、`cancelled` 和显式 `reset`。

- Pi 的 `plan_ocean_data_subset` 工具返回经过 schema 验证的结构化详情；Chat 将其持久化为项目工作流，而不是解析自然语言。
- 元数据探测与数据下载分阶段执行。审批卡必须披露变量、区域、时间、深度、预计体积和目标存储。
- “批准并执行”只批准当前计划哈希对应的连接器任务；下载和分析继续使用应用级取消令牌。
- 真实 Argo NetCDF 由隔离 Docker Runner 执行 xarray 混合层分析、Reviewer 和 RO-Crate；首版不对其他连接器假装存在原生分析配方。
- 无 Docker 镜像时，自动化测试使用明确标注为“非科研证据”的 fixture Runner。其 Reviewer 必须拒绝科学证据检查。
- 运行完成后，以同一工作流 ID 幂等回写项目实验、Wiki 页面和画布节点。

## Token 与上下文

模型只接收短结构化计划和工具结果。下载数据、完整日志、Reviewer 文件和 RO-Crate 均作为 Artifact 保存，不进入模型上下文。审批和执行阶段不需要再次调用大模型。

## 替换边界

编排层依赖 `ConnectorMetadataProbe`、`ConnectorWorkflowService` 和 `ProjectAnalysisRunner` 三个稳定接口。未来可替换为队列、Slurm 或远程 Runner，而无需修改 Chat、审批卡和项目域模型。

## 验证

- 状态机测试覆盖未审批拒绝、探测、审批、运行、Reviewer、RO-Crate、取消和重置。
- Server 集成测试覆盖项目隔离和项目/Wiki/画布自动沉淀。
- 浏览器验收覆盖 Pi 工具 → 审批卡 → fixture 执行 → Reviewer 拒绝科学证据 → 三视图沉淀。
