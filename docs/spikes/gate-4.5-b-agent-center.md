# Gate 4.5-B：服务端 Agent 中枢隔离垂直切片

> 状态：实现与自动化验证已完成，确认点 B 已通过
> 日期：2026-08-24
> 保护线：未迁移正式 Chat、Canvas、Wiki 或 Evidence 数据

> 历史说明：该保护线仅描述 4.5-B 验收时的事实；确认点 B 通过后，4.5-C 已切换正式 Chat/Canvas。

## 1. 实际边界

`@xiling/agent-harness` 是 Pi 无关的宿主协调包；它只依赖汐灵事件契约，通过 `HarnessRuntimeFactory` 获取运行时。Server 组合根把 `PiRuntimeAdapter` 注入该窄端口。因此，上游 Pi 升级仍只需改动 `pi-runtime`，不会迫使耐久会话 schema 跟着变化。

Agent 事实写入独立 `agent-center.sqlite`：

- `agent_sessions`：项目作用域、格式版本和写者租约。
- `agent_runs`：耐久 run identity、幂等 command ID 和终态。
- `agent_operations`：模型、工具、恢复和取消操作。
- `agent_entries`：完整 user/assistant/tool/compaction entry。
- `agent_usage`：每次 provider assistant message 的 usage，快照内汇总全回合。
- `agent_events`：按 run 单调序号的可重放事件。
- `agent_compactions`：覆盖范围、retained tail、来源哈希、模型、usage 和原因。

Knowledge SQLite 仍拥有 Project/Wiki/Evidence/Legacy Chat。两类数据库分开是有意的事实所有权隔离，不是微服务拆分。

## 2. 已证明的行为

| 场景 | 证据 |
|---|---|
| 服务端单写者 | 同一 session 的第二个活动 run 被 SQLite 唯一索引拒绝；不同 session 可并行 |
| 消息和工具落盘 | user、tool-call、tool-result、assistant 以 session 序号持久化；工具成功与 `tool.failed` 分离 |
| 全回合 usage | Pi 每个 assistant `message_end` 都写入 usage，snapshot 统一汇总 |
| 断线和重订阅 | start command 立即返回 run identity；SSE 使用 `afterSequence`，订阅断开不取消 run |
| 取消 | 同一 `abort()` 链进入 Pi provider/tool signal，终态为 `cancelled` |
| 重启恢复 | 启动时把未完成 run/operation 转为 `suspended`，标记 `restart-interrupted-turn` 可恢复策略 |
| 失控保护 | 重复工具签名、工具总数、总时长和总费用可中止 run |
| Compaction 样例 | 保留近期 tail，记录覆盖 entry、源哈希、usage、模型和触发原因；原 entry 不删除 |
| 重启持久性 | 关闭 Server 并重新打开后，已完成 snapshot 和事件仍可读 |

## 3. 隔离验收 API

- `POST /api/agent-center/sessions`
- `POST /api/agent-center/runs`
- `GET /api/agent-center/runs/:id`
- `GET /api/agent-center/runs/:id/events?afterSequence=N`
- `POST /api/agent-center/runs/:id/cancel`
- `POST /api/agent-center/runs/:id/resume`
- `POST /api/agent-center/sessions/:id/compact`

`GET /api/agent-center/status` 明确返回 `formalChatMigrated: false`，防止 UI 或文档把隔离样例冒充成主路径切换。

## 4. 尚未执行

- 未把旧 `chat_sessions/chat_messages` 回填为 Agent entries。
- 未让正式 Chat/Canvas 使用新 command/snapshot/subscription API。
- 未把 Canvas `messageId` 替换或补充为 `sourceEntryId`。
- 未开启生产自动 Compaction；本阶段只验证耐久记录与可审查语义。
- 未迁移 Wiki、Evidence、Workflow 或 Artifact 领域所有权。

上述任何一项都必须等确认点 B 通过后，在 4.5-C 以 dry-run、备份、dual-read 和可回滚方式执行。
