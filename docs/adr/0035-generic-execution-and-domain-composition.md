# ADR 0035：通用执行内核与领域组合边界

- 状态：已采用
- 日期：2026-08-28

## 背景

海洋 Workflow 证明了审批式科研闭环，但把数据连接器、分析配方、运行状态和临时目录绑在一个领域状态机中。继续按此方式增加领域，会把通用科研 OS 退化为多个互不兼容的专用工作流。

## 决策

1. `packages/execution` 定义领域中立的 `ExecutionPlan`、`ExecutionSpec`、`ApprovalReceipt`、`ExecutionRecord`、Repository 与 Runner port。
2. 审批绑定规范化的计划哈希。计划至少包含输入选择器、代码快照、参数、随机种子、环境、资源和网络策略；输入物化后再产生包含内容哈希的执行规范。
3. `ExecutionCoordinator` 只负责审批校验、幂等收据、超时、取消和状态持久化，不包含海洋、表格或其他学科分支。
4. `packages/domain-ocean` 与 `packages/domain-tabular` 拥有各自类型、Manifest、导入器或算法；`packages/contracts`、Agent Harness、Context 与 Research Graph 保持领域中立。
5. 已安装领域只在 `apps/server/src/installed-domains.ts` 组合。Manifest 贡献元数据，不获得任意代码执行权。
6. 表格实验领域作为参考纵向切片，通过同一 Artifact Registry 和 ExecutionCoordinator 完成 CSV 导入、描述统计、失败校验与结果固化。

## 约束

- Runner 输出必须先进入内容寻址 Artifact Registry，随后才可成为 API、Agent 或 Research Graph 的正式 URI。
- 相同 `projectId + idempotencyKey` 只能对应同一 ExecutionSpec；冲突必须拒绝。
- 环境引用在发布构建中必须是不可变 digest。开发 fixture 可使用确定性占位 digest，但不能被描述为生产容器验收。
- 海洋 Workflow 当前保留为领域适配器；后续只允许向通用 Execution port 收敛，禁止复制第二套通用协调器。

## 验收

- 修改计划哈希后旧 Approval 失效。
- 相同执行重试复用收据和 Artifact 记录。
- 取消、超时、运行失败与输入格式失败可确定性测试。
- 增加第二领域不修改通用核心联合类型或 Agent loop。

