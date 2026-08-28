# ADR 0032：受控 Pi 多智能体科研编排

- 状态：已接受并实现主干
- 日期：2026-08-27

## 背景

Pi 核心刻意不内置多智能体；上游 `subagent` 示例以独立 Pi 进程提供 single、parallel、chain、流式状态、usage 和取消。它是扩展示例，不拥有汐灵的耐久 Agent Store、科研证据、审批、Research Graph、上下文投影或跨平台运行约束。

现有 `ResearchAgentHarness` 已保证单 session 单写、不同 session 可并行、事件可重放、usage/compaction 耐久化。多智能体应建立在该基础上，而不是绕过 Harness 或让任意 Coding Agent Extension 进入 Server 主进程。

## 决策

1. 采用一个耐久 `Research Director` 主智能体和多个短生命周期子智能体，不采用 peer swarm。
2. `@xiling/multi-agent` 保存 Pi 无关的角色目录、委派判定、并发调度、TaskPacket 与 Handoff 契约；Pi 仍只经 `@xiling/pi-runtime` 接入。
3. 每个子任务使用独立 Agent Session；父会话全文、兄弟结果和未声明 Research Graph 区域不继承。
4. 主 Agent 仅在任务命中可并行探索、竞争假说、系统检索或独立复核时获得 `delegate_research_tasks` 工具。子 Agent 永远不获得该工具，首版禁止递归委派。
5. 委派模式兼容 Pi 示例的 single、parallel、chain；产品调度默认最多并发 3、父任务最多 6 个子任务。
6. 父子血缘、ContextManifest 哈希、预算、状态与结构化结果写入 `agent-center.sqlite`。子 session/run 继续使用既有 Harness 表和事件。
7. Agent Execution Graph 可投影 `delegated` 关系，但默认只显示一个子任务节点并折叠内部工具细节。
8. Research Graph 不保存委派过程。只有通过现有 proposal/approval 边界提升的 Paper、Evidence、Run、Artifact、Review 等科研对象进入科研图。
9. 上游 `subagent` 示例作为兼容与行为测试参考，不直接成为 Web Server 插件宿主；第三方 Extension 仍遵守 ADR 0023 的隔离规则。

## 上下文与权限

- `scoped`：TaskPacket + 项目简报 + 有界科研图实体。
- `blind`：额外排除主 Agent 结论和兄弟结果，用于 Reviewer 与竞争假说。
- `execution`：在 scoped 基础上要求受控 Runner/容器，适用于代码和数据执行。
- 子角色按 capability allowlist 装配工具；Skill 正文和 MCP schema 继续按需加载。
- 下载、计算、外部写入、Wiki 发布和科研事实接受仍需现有审批，不因委派而扩大权限。

## 预置角色

只保留三个稳定基础角色：

- `research-explorer`：文献、多数据源与竞争假说探索，默认 `scoped`。
- `domain-executor`：按当前项目领域提示规划或核验执行，默认 `execution`；领域包提供能力与约束，不再各自复制角色。
- `independent-reviewer`：默认 `blind`，按任务动态选择 `evidence`、`reproducibility`、`methods` 或 `adversarial` 审查清单。

数据规划优先由确定性预检和 Approval Gate 完成；证据、复现和方法差异属于审查清单，而不是额外人格。委派工具按当前 prompt 只暴露命中的 1–3 个角色。最终综合与用户沟通由 Research Director 完成。

2026-08-28 以前的六角色目录已删除；`@xiling/multi-agent` 不再内置另一份角色常量，角色唯一事实源是 `general-science` Manifest。

## 验证

- 兄弟/父子 session 历史不泄漏。
- 并发上限、任务数上限、禁止递归、取消级联和子预算。
- 委派记录重启后存在，运行图能重建父子关系。
- 子 Agent 不能直接写 Research Graph/Wiki，也不能绕过 Approval Gate。
- macOS/Linux/Windows WSL2 使用相同取消协议，不依赖 POSIX 信号。
