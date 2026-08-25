# Gate 4.5-C：上下文与 Canvas 无损迁移报告

> 状态：实现已完成并确认；后续清理见 Gate 4.5-D
> 日期：2026-08-24

## 主路径变化

- Web Chat 和 Canvas 现在发送 `command`，然后读取 snapshot 并按序号订阅事件。
- 用户 entry 在 Run 被接受时由 Server 先落盘；assistant/tool/usage 也只由 Server 写入。
- Web 不再调用旧消息 POST 接口双写用户和 assistant 消息。
- Canvas Chat 节点保存 `sourceEntryId + runId`，展示截断文本不再是上下文原文事实源。
- `GET /api/agent-center/sources/entries/:id` 按项目作用域和字符上限解析完整来源。

## 迁移策略

1. 首次迁移前用 SQLite `VACUUM INTO` 同时快照 Knowledge 与 Agent 数据库；不可变目录保存完整性检查、SHA-256 与 manifest，迁移报告关联 backup ID。
2. 每个旧 Chat Session 创建同 ID Agent Session，将尚未导入的旧消息追加到已完成 migration Run。
3. Schema v3 使用 `(sessionId, legacyMessageId)` 唯一映射表；新 Entry 同时保存旧状态与时间，迁移可逐条补导入并幂等重跑。
4. Canvas 依据旧 `messageId` 补写 `sourceEntryId`，不改写用户可见 body 或领域主键。
5. 生成 `data/gate4/agent-migration-report.json`，记录导入消息和链接节点数。
6. 迁移后 Chat GET 以 Agent Entries 为主；尚无 Entry 的开发 fixture 才回退旧表。

## 上下文与压缩

- Harness 从最新 Compaction 加载“累计结构化索引 + retained tail”，而不重新注入全部历史；后续压缩只处理新增覆盖区间并继承上一版摘要。
- Canvas 只有在节点正文与耐久 Entry 全文完全一致时才去重；1,800/2,000 字符预览不会替换全文历史。
- 当前分支存在截断来源时才动态加载 `read_agent_entry`；存在压缩历史时才加载 `search_agent_history`，模型可先检索再分段回读全文，未命中时工具 schema 不进入上下文。
- Compaction 同时参考 Entry 数、估算字符与 Token 压力。每个被压缩 Entry 保留 ID、研究标签、来源 URI 与短索引；原 Entry 永不删除。
- Scientific Capsule 继续保存画布科研语义，Paper/Dataset/Artifact 仍是原始证据所有者，Compaction 不代替证据。

## 生命周期与项目边界

- Knowledge Chat 归档会取消活动 Run 并归档同 ID Agent Session；归档历史仍可按项目只读查看，不能继续写入、恢复或压缩。
- Run snapshot、事件、来源读取、取消、恢复和压缩均要求显式 `projectId`；Server 同时校验 Project、Knowledge Chat、Agent Session 与 Run 的归属。
- 4.5-C 切换期旧消息 POST 返回 `410 Gone`；4.5-D 已删除路由，当前返回 404，不再接受只写 Knowledge Store、随后不可见的幽灵记录。
- Canvas 超长 Prompt 只保存 2,000 字符预览与 `sourceEntryId`；完整 Prompt 先由 Agent Store 落盘，因此不会因 Canvas schema 上限丢失或阻断 Run。

## 自动化证据

- 旧 Chat 导入后的 Entry ID 与旧 message ID 不同，内容不变。
- Canvas 同时保留旧 `messageId` 和新 `sourceEntryId`。
- 迁移后新回合直接追加到同一 Agent Session，重启后可恢复。
- 跨项目 source entry 读取返回 404。
- 自动 Compaction 保留 source hash、覆盖范围、tail、模型、usage、原因、上一摘要与按需全文恢复路径。
- 2,001 字符 Canvas 来源不会被当作全文去重；归档会话拒绝写入但允许历史读取；4.5-D 删除旧消息 POST 后返回 404。
- 迁移备份覆盖双数据库 WAL 已提交内容，校验失败只清理本次 `.incomplete` 目录，不覆盖旧快照。
- `scripts/gate-4.5-c-migration-smoke.mjs` 验证迁移、主 Chat Run 和重启持久性。

## 4.5-D 后续结果

- `/api/chat/stream` 与旧消息 POST 已删除；Agent Entry 恢复 GET 继续保留。
- Web retained run/message Map 已删除，组件级 Abort 仅作为取消控制句柄。
- 工具结果到 Workflow 的投影已收回 Server，并采用 durable-first、稳定幂等键与启动 reconcile。
- 详情见 [Gate 4.5-D 主路径所有权报告](gate-4.5-d-main-path-ownership.md)。
