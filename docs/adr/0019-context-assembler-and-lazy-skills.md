# ADR 0019：持久化上下文组装与 Skill 按需加载

## 状态

已接受，2026-08-24。

> 过渡说明（2026-08-24）：Capability 投影、Skill 正文按需加载、活动分支/Quote 与 Artifact 局部读取原则继续保留。提议中的 [ADR 0022](0022-research-agent-harness.md) 将纠正两项实现假设：旧 SQLite Chat 消息不再独自承担 Agent 执行真相源，Canvas 截断 `body` 不再作为近期节点完整原文。正式迁移前当前实现仍有效。

## 背景

早期 Gate 4 每轮把画布节点机械截断后拼入系统提示，Capability 展示与实际 Pi 工具由两套关键词规则驱动，Pi 的 `transformContext` 和会话消息恢复未启用。Skill 只存在于设计文档，MCP 尚未进入运行时。

## 决策

- MCP 继续保持未接入状态，本 ADR 不增加任何 MCP 依赖、配置或传输层。
- Capability Catalog 成为投影标识、Pi 工具和 Skill 选择的共同来源，每个能力必须映射到一个真实工具。
- `SKILL.md` 使用 Pi 原生格式。宿主启动只读取 `skills/catalog.json` 元数据，命中能力后才读取正文，并按 `name@version` 在进程内缓存。
- 节点 Capsule 由完整正文、标题和 Artifact URI 的内容哈希驱动，持久化到 SQLite；未变节点复用，变更节点及其活动分支 Capsule 才重建。
- Context Assembler 根据所选模型的 `contextWindow`、最大输出、稳定提示、工具 schema 和 Skill 正文计算可用空间。
- 近期活动节点和显式 Quote 保留原文，较早祖先使用 Capsule。显式证据仍无法容纳时返回可解释错误，不静默截断。
- 未被画布投影覆盖的会话记录作为 Pi 消息恢复；模型窗口不足时只省略较早的补充历史，并通过 `context.ready` 事件向用户披露。
- Pi 运行时启用 `initialMessages` 和 `transformContext`。SQLite 仍是跨重启的权威会话存储，避免依赖仅存在于进程内的 Agent 状态。
- 文本 Artifact 通过受管 URI、允许类型和字节范围局部读取；二进制科学数据必须使用专用查看器。

## 可观测性

每轮记录投影哈希、估计上下文、模型可用空间、组装缓存命中、Capability/Skill 数量和省略历史数量。前端显示本轮原文节点、Capsule、Skill、缓存与语义降级说明。

## 验证

- Capability 与实际工具一一对应。
- Skill 未命中时不读取正文，重复命中使用版本缓存。
- Capsule 跨重启保持，节点变更后 revision 改变，节点删除后失效。
- 近期节点和 Quote 保留完整文本，旧分支使用 Capsule。
- 模型窗口不足时明确失败或披露省略，不发生字符级静默截断。
- Artifact 读取限制在受管文本文件和声明的字节范围内。
