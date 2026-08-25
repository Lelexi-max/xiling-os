# Gate 4.5-A：Pi Session / Compaction / Harness 隔离样例

> 日期：2026-08-24
> 范围：只读评估与离线测试；未连接正式 Chat，未读取或迁移用户项目数据。

## 结论摘要

固定依赖 `@earendil-works/pi-agent-core@0.84.2` 提供两类成熟度不同的能力：

| 能力 | 实测状态 | Gate 4.5 处理 |
|---|---|---|
| 低层 `Agent` 与 agent loop | 当前产品已使用 | 保留 |
| `JsonlSessionRepo` / `Session` / Entry tree | 可创建、追加、列举、重开并恢复活动 branch | 可作为语义参考与技术基线；正式存储仍需项目作用域和事务适配 |
| `prepareCompaction` / `shouldCompact` | 可离线确定性准备摘要范围与 retained tail | 复用；生成摘要另需受控模型调用、usage 与来源哈希记录 |
| `AgentHarness` 类型和配置读取 | 可创建空壳并读取/修改配置 | 不足以运行产品 |
| `AgentHarness.prompt/compact/resume/abort/...` | 抛出 `HarnessNotImplemented` | 0.84.2 不可直接采用 |
| `AgentHarness.create` 恢复既有 operation records | 抛出 `HarnessNotImplemented("create.restore")` | 0.84.2 不具备正式恢复闭环 |

## 样例覆盖

`packages/pi-runtime/src/harness-spike.test.ts` 使用固定离线 fixture 验证：

1. JSONL Session 在关闭原对象后可由 metadata 重开，entry ID、消息内容和 active leaf 保持一致。
2. `AgentHarness.create()` 能建立配置壳，但 `prompt()` 明确失败为 `HarnessNotImplemented`，没有误把声明 API 当成可运行实现。
3. Compaction preparation 在不调用模型、不使用密钥和网络的情况下，把历史划分为待摘要消息与近期 retained tail。

## 对正式实现的含义

- 当前依赖足以让汐灵复用 Pi 的 Agent loop、Entry/Compaction vocabulary 和算法原语。
- 它不足以提供耐久 Run、单写者、事件续传、断线/重启恢复和幂等领域投影；这些仍需薄的宿主应用层。
- JSONL 样例证明的是 Pi session 语义和跨打开恢复，不等于建议把正式项目数据库从 SQLite 全量替换为 JSONL。
- Canvas/Wiki/Evidence/Workflow 不进入 Pi Session Store；正式链路通过 `SourceContentResolver` 与 projector 引用它们。

## 路径比较准则

### 路径 A：当前 Pi primitives + 薄 `ResearchAgentHarness`

优势是依赖不变、迁移面可控，并能按汐灵的项目、审批和科研溯源边界设计。成本是需要自研宿主协调层，因此必须有 ADR、稳定端口和完整 smoke。

### 路径 B：升级到经验证的上游 Pi Harness

只有当上游公开版本已真实实现 prompt、tool、compaction、resume、abort、durable recovery，且通过 Windows/WSL、API 兼容与旧数据 dry-run 后才成立。不能仅因类型声明存在就选择升级。

## 上游核对（2026-08-24）

- Pi 官方 `main` 的 `@earendil-works/pi-agent-core` 已是 `0.84.3`，只比本项目固定的 `0.84.2` 高一个补丁版本。
- 官方 `0.84.3` 源码中 `AgentHarness.prompt()`、`compact()`、`resume()`、`abort()`、队列、watch 与 lane 操作仍统一返回 `HarnessNotImplemented`；`create()` 遇到既有 operation record 仍拒绝为 `create.restore` 未实现。
- 官方 changelog 显示 `0.84.3` 只修复 edit 参数和 Skill 目录识别；没有交付 Harness 运行闭环。`0.84.0` 还刚完成 v4 Session/Harness API 的破坏性升级，说明接口仍处于快速演进期。

官方来源：

- [Pi 0.84.3 AgentHarness 源码](https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/agent-harness.ts)
- [Pi Agent Core package metadata](https://github.com/earendil-works/pi/blob/main/packages/agent/package.json)
- [Pi Agent Core changelog](https://github.com/earendil-works/pi/blob/main/packages/agent/CHANGELOG.md)

因此路径 B 在本次 Gate 4.5-A **不成立**；升级到 0.84.3 不能获得 Harness，只会引入依赖变更。建议选择路径 A：维持 0.84.2，复用已验证的 Agent/Session/Compaction 原语，实现窄边界、可替换的 `ResearchAgentHarness`。未来上游 Harness 真正完成后再做适配比较，而不是让领域层等待上游。

## 本阶段未做

- 未改 `/api/chat/stream`、Chat/Canvas Web 客户端或 Knowledge schema。
- 未创建 `sourceEntryId` 回填、未改 Canvas `body`、未写 Wiki revision。
- 未使用用户模型密钥、OpenAlex 密钥或任何公网数据账户。
