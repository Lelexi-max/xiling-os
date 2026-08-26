# 模块化单体架构

## 目标

汐灵 OS 当前采用模块化单体，而不是提前拆成微服务。Web、Agent 编排、项目知识库与本地科研执行仍可一次启动，但模块间只能经公共契约和窄接口协作。这样保留个人科研软件的安装与调试体验，同时允许未来把 Runner、文献检索或连接器独立部署。

```mermaid
flowchart LR
  WEB["apps/web\nReact views"] --> API["apps/server\ncomposition root"]
  API --> AGENT["Agent / context orchestration"]
  AGENT --> HARNESS["Agent Harness / durable run store"]
  API --> WORKSPACE["Workspace routes"]
  API --> LITERATURE["Literature routes"]
  API --> LAYOUT["Scientific Canvas layout store"]
  API --> CONNECTORS["Connector routes"]
  API --> WORKFLOWS["Research workflow routes"]
  API --> RGAPI["Research Graph routes"]
  WORKFLOWS --> RUNNER["Python / Docker runner"]
  AGENT --> PORTS["Knowledge ports"]
  WORKSPACE --> PORTS
  LITERATURE --> PORTS
  PORTS --> SQLITE["KnowledgeService / SQLite"]
  RGAPI --> RGPORT["ResearchGraphStore"]
  RGPORT --> LADYBUG["LadybugDB / research-graph.lbdb"]
  API --> CONTRACTS["api-contracts + contracts"]
  WEB --> CONTRACTS
```

## 包依赖方向

- `contracts` 是无运行时依赖的领域类型核心。
- `api-contracts` 依赖 `contracts`，提供前后端共用的 Zod 运行时校验。
- `context`、`credentials`、`literature`、`connectors`、`knowledge`、`agent-harness`、`research-graph` 和 `pi-runtime` 只依赖允许的下层包。`agent-harness` 不依赖 Pi，由 Server 在组合根注入 `PiRuntimeAdapter`。
- `research-graph` 只依赖公共 contracts；LadybugDB 被封装在 `ResearchGraphStore` 后。`research` 是待删除的 Gate 3 旧聚合，不做数据迁移或继续扩展。
- `apps/server` 是组合根；允许装配所有模块，但业务模块不得反向导入应用层。
- `apps/web` 通过 HTTP/SSE 契约访问服务端，不导入服务端实现。
- 所有 `@earendil-works/pi-*` 依赖只能出现在 `pi-runtime`；Server 依赖 `PiCompatibilityPort` 和汐灵运行类型。

`pnpm architecture` 会静态检查 workspace 包依赖方向和 Pi 反腐层；`pnpm pi:compat` 额外检查 Pi 版本锁步与核心行为。新增跨包依赖必须先更新 ADR 和检查规则。

## 服务端模块边界

| 模块 | 责任 | 可替换边界 |
|---|---|---|
| `workspace` | Project、事项、Chat 目录/迁移读取、Wiki HTTP API | `ProjectStore`、`ConversationStore`、`WikiStore` |
| `literature` | 搜索/发现图、真实摘要、阅读标注与证据提升命令 | `LiteratureSearchService`、`EvidenceStore` |
| `connectors` | 元数据、审批任务、下载、Artifact 读取 | `ConnectorMetadataProbe`、`ConnectorWorkflowService` |
| `workflows` | 项目科研闭环状态机 HTTP API；SQLite 状态与 outbox 同事务 | `ProjectWorkflowService`、`SqliteProjectWorkflowRepository` |
| `research-graph` | Claim、EvidenceAssertion、计算溯源、Artifact 生命周期与受界限图投影 | `ResearchGraphStore` |
| `settings` | 凭据状态、模型路由、自定义 Provider | `CredentialStore`、`ModelRuntimeStore` |
| `agent-center` | Chat command、snapshot、event、source resolution 与 Agent Execution Graph 主 API | `ResearchAgentHarness`、`SqliteAgentSessionStore`、`HarnessRuntimeFactory` |
| `legacy-gate3` | 开发期待删除的旧 Gate 3 路由 | 不迁移数据，不再维护兼容 |

RG-2 已删除旧的“Workflow 完成后写入实验、Wiki、画布”文件级 settlement。新的运行事实先与 Workflow 状态同事务落入 outbox，再由幂等 projector 写入 Research Graph；Wiki 只保存正文和版本引用。

## 数据一致性

- SQLite 由顺序迁移器管理，版本保存在 `PRAGMA user_version`；应用拒绝打开比自身更新的数据库。Knowledge 与 Agent run 使用两个同进程 SQLite 文件。Research Graph 使用同进程嵌入式 LadybugDB，并保持独立 schema version；没有网络图服务或分布式事务。
- KnowledgeService 是当前适配器；调用方使用按能力拆分的 ports，不依赖整个实现类。
- Knowledge 拥有 Chat Session 目录；Agent Store 拥有消息、工具、Run、Usage 和 Compaction。Agent Execution Graph 只从 Agent Store 重建。旧 Canvas Web、HTTP 与文件仓储已经删除。
- Agent、Knowledge、Workflow 与 Research Graph 的跨库写入使用源存储 durable outbox/Agent journal、稳定投影键、目标 applied ledger 和启动/查询 reconcile；不使用前端双写或文件级 settlement。
- Scientific Canvas 只把坐标和视口写入按 `project + view` 隔离的 Layout SQLite，并使用单调 `revision`；科研关系只写 Research Graph。
- Artifact 和科研大数据不写入 SQLite，也不复制到模型上下文；业务对象只保存受管 URI。

## 前端基础设施

- `api-client.ts` 统一 JSON 请求、错误类型与序列化。
- `agent-stream.ts` 统一增量 SSE 解码，正确处理跨 chunk JSON 与末尾事件。
- `research-session-client.ts` 统一 Chat 的 Agent command、取消和耐久事件订阅；不持久化消息，不写 Workflow。Agent Execution Graph 使用独立只读查询，不启动 Agent turn。
- 视图组件只处理交互与局部状态；新视图不得复制 fetch/SSE/工作流协议。

## 演进规则

1. 新能力先在现有模块中增加端口和适配器。只有当数据拥有者、迁移节奏和写入模式显著不同时才允许独立数据库，并必须由 ADR 和恢复测试证明必要性。
2. 当模块确实需要独立扩缩容、故障隔离或远程部署时，再把端口实现迁出进程。
3. 不以“未来可能需要”为理由预先引入消息总线、分布式事务或微服务。
4. MCP 连接管理位于独立 Host；Server 只持有配置与单代理工具，完整 MCP schema 不常驻上下文，Extension 不进入主进程。
