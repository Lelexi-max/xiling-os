# ADR 0025：Research Graph 使用嵌入式属性图数据库

- 状态：有条件接受（RG-0 技术门禁进行中）
- 日期：2026-08-26

## 背景

现有 Knowledge SQLite 只把收藏论文保存为很薄的 `evidence` 记录，Workflow、Canvas 和 Artifact 又分别落在 JSON、SQLite 与文件系统。文献、证据、科研结论、计算输入、运行、审查和 Artifact 生命周期之间没有可查询的统一关系事实源。继续向 Canvas JSON 或 SQLite 通用边表追加关系，会让展示布局承担领域事实、使多跳溯源依赖应用层拼接，并难以表达带立场、出处和置信度的证据断言。

产品已经确认三个边界：Agent 运行图移入 Chat；新的顶层科研画布展示项目 Research Graph；文献工作台保留发现、阅读和标注。当前处于开发阶段，不迁移旧 Canvas、Evidence 或 Workflow 数据，也不保留双写兼容。

## 决策

建立独立的 `@xiling/research-graph` 领域包与 `ResearchGraphStore` 端口。默认候选后端为 LadybugDB 0.19.1，数据文件为 `research-graph.lbdb`，由 Server 进程持有唯一可写 `Database` 对象；读写连接必须从同一对象创建。

LadybugDB 只在 RG-0 门禁完整通过后成为正式默认后端。门禁覆盖：

- Node 22 TypeScript 绑定和固定版本安装；
- macOS Apple Silicon、Linux x86_64、Windows 11/WSL2 Linux 后端；
- 原子 ChangeSet、失败回滚、WAL、Checkpoint、异常退出恢复；
- 冲突证据、Artifact 反向溯源、项目分项投影等真实 Cypher 查询；
- 固定小型离线 fixture、资源清理、许可证和 SBOM；
- Server 单写、多读连接隔离、并发查询、查询超时与关闭顺序。

若其中任何发布平台或恢复门禁失败，保持 `ResearchGraphStore` 不变，将默认适配器替换为隔离部署的 Neo4j Community；首版不同时维护两个生产适配器。

图 Schema 使用一个稳定的 `ResearchNode` 实体表和一组明确的关系表，如 `ASSERTS`、`BASED_ON`、`USED`、`GENERATED`、`DERIVED_FROM`、`EVALUATES`、`CITES`。不使用万能 `edges(kind)` 表。需要携带立场、置信度、原文定位和审查状态的证据关系必须重化为 `EvidenceAssertion` 节点。

科研画布坐标、缩放、折叠和临时选择不写入 Research Graph；它们属于独立布局仓储。PDF、NetCDF、脚本和图像仍保存在 Artifact 文件系统，图中只保存稳定 URI、哈希、版本与溯源。

## 图语义

证据使用显式断言：

```text
Paper → HAS_FRAGMENT → SourceFragment
EvidenceAssertion → BASED_ON → SourceFragment | DatasetSnapshot | ArtifactVersion
EvidenceAssertion → ASSERTS → ClaimRevision
```

计算溯源采用 PROV 风格的 Entity/Activity/Agent 关系：

```text
ResearchRun → USED → DatasetSnapshot | ArtifactVersion
ResearchRun → GENERATED → ArtifactVersion
ArtifactVersion → DERIVED_FROM → DatasetSnapshot | ArtifactVersion
ReviewReport → EVALUATES → ResearchRun | ClaimRevision
ResearchRun → ASSOCIATED_WITH → Actor
```

Graph 中的事实更新以单事务 ChangeSet 写入。Agent 未来只能产生待审批 ChangeSet；布局变更不需要科研事实审批。

## 后果

- 科研画布、项目 Wiki、Agent 上下文和 Artifact 查看器可以共享同一关系事实，而不复制整张图。
- Agent 上下文可以按用户焦点、关系白名单和有限跳数查询局部邻域，天然减少无关 token。
- 新增一个含原生二进制的 MIT 依赖，需要跨平台安装、版本锁定、恢复与发布测试。
- LadybugDB 同一文件只能有一个可写 Database 对象；Server 必须保持单写所有权，调试 CLI 不得在应用运行时直接打开该文件。
- Knowledge/Agent/Research Graph 跨库仍需 durable outbox 与幂等 projector；RG-0 不用假双写掩盖这个边界。

## 未选择方案

- **SQLite 通用边表**：实现简单，但复杂多跳、路径、图算法和语义约束最终会回到应用层，不满足 Research Graph 的数据所有权要求。
- **Neo4j Community 默认**：成熟且有官方 Driver，但引入常驻 Java 服务、Docker/内存成本、GPL 隔离和 Community 离线备份约束；保留为失败回退。
- **Apache AGE**：Apache-2.0 且能组合 SQL/Cypher，但需要 PostgreSQL 与扩展版本运维，增加本地优先安装复杂度。
- **独立 RDF 三元组库**：标准互操作很好，但当前交互和查询更适合属性图；对外通过 RO-Crate、PROV/JSON-LD 导出保持标准兼容。

## 验证

- `packages/research-graph/src/index.test.ts`
- `scripts/research-graph-smoke.mjs`
- `pnpm architecture`
- `pnpm compliance`

完整目标与对象所有权见 [Research Graph 架构](../architecture/research-graph.md)。
