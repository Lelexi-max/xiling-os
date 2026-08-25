# ADR-0001：通过适配器嵌入 Pi SDK

- 状态：Gate 1 待确认
- 日期：2026-08-23

## 背景

汐灵需要多模型、流式事件、工具调用、会话分叉、压缩和按需工具装载，同时必须拥有独立的科研领域模型、Web UI、审批和容器权限边界。

## 决策

使用 Pi SDK 嵌入 `apps/server`，不 Fork Pi CLI。所有 Pi 类型和事件只通过 `AgentRuntimePort` 进入业务层；业务对象不得直接依赖 Pi 内部文件或未公开符号。

## 结果

- 可直接复用 Pi 核心能力并跟进上游。
- 需要自研薄适配层及契约 smoke。
- Pi 不提供的权限沙箱由 Approval Gate 和 Runner 负责。
- 上游升级必须先通过 Runtime Adapter 兼容测试。

## 替换边界

若未来替换 Agent 内核，只需实现相同的 `AgentRuntimePort`、事件协议、取消和 usage 接口。
