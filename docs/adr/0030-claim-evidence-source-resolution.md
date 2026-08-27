# ADR 0030：Claim 提案、证据断言与来源解析闭环

状态：已接受
日期：2026-08-27

## 背景

Research Graph 已能显示论文、证据和运行产物，但旧链路仍有三个真实性风险：Claim 没有正式生产入口，Evidence 只能粗粒度绑定论文/研究问题，Context 可能把画布摘要当作来源内容。它们会让图看起来完整，却无法回答“这条结论来自哪段原文、支持哪个版本、模型实际看到了什么”。

## 决策

1. Claim 新建与修订必须先写 `ResearchGraphProposal`；接受后才在 LadybugDB 事务中写 Claim、不可变 ClaimRevision 和版本关系，拒绝不改变科研事实。
2. Evidence 捕获是一条不可变阅读记录，保存 `sourceQuote`、`sourceLocator`、`note`、`limitations`、`stance`、`confidence` 与可选 `claimRevisionId`；同一论文允许产生多条证据。
3. Projector 用 `BASED_ON` 连接 EvidenceAssertion 与 SourceFragment，用 `ASSERTS` 连接具体 ClaimRevision，并保留对 ResearchQuestion 的 `EVALUATES`。
4. Context 先做 Research Graph 有界投影，只对入选节点调用 `SourceContentResolver`。解析结果必须携带来源等级和 locator；图摘要只能标记为非原文。
5. Artifact、PDF、NetCDF、日志等大 payload 继续通过受管 URI 和范围读取，不进入科研图数据库或系统提示。

## 后果

- 科研结论获得版本、证据、原文与 Agent 使用上下文之间的可审计链路。
- 写入多一个确认步骤，但避免 Agent 把推断直接固化为事实。
- Proposal Store 与 Research Graph 是跨库关系；接受操作以 proposal 状态和 applied entity IDs 保证重复请求可审计，图写入仍由唯一单写者负责。
- 后续批量图修改应扩展同一 proposal 协议，不开放任意 Cypher 或前端直接写图。

## 验证

- API 集成测试覆盖 pending/accept/reject、不可变版本、Evidence `ASSERTS`、精确 SourceFragment。
- Source resolver 单元测试覆盖原文优先、明确非原文降级、项目作用域与 Artifact 安全读取。
- `pnpm architecture` 阻止旧 Gate 3 产品路由重新进入 apps。
