# ADR 0029：文献证据提升与旧 Canvas 完全退役

- 状态：接受
- 日期：2026-08-27

## 背景

文献工作台曾同时提供“加入证据库”和“固定到科研画布”两个命令。前者写 Knowledge SQLite，后者直接修改旧 `CanvasGraphDocument` JSON。结果是同一论文可能存在于临时 Discovery Graph、Evidence 表和旧 Canvas 三份状态中；旧 Canvas 还让页面坐标看起来像科研关系。文献详情中的摘要也是固定演示文本，无法支持真实阅读判断。

## 决策

1. Literature Discovery Graph 只负责检索、关系发现和选文，不进入项目科研事实。
2. Semantic Scholar 与 OpenAlex Provider 只投影声明过的真实字段，并按需获取原生摘要。上游不返回摘要时 UI 明示缺失，禁止生成内容冒充原文摘要。
3. 用户在文献工作台记录阅读标注，并显式选择 `supports`、`refutes`、`qualifies` 或 `insufficient` 与 0–1 置信度，再执行一次“提升为项目证据”。
4. 提升命令在 Knowledge SQLite 中保存不可变 Evidence 捕获记录并与 outbox 同事务提交。Projector 生成 `Paper`、`SourceFragment`、`EvidenceAssertion`，其中：
   - `Paper HAS_FRAGMENT SourceFragment`
   - `EvidenceAssertion BASED_ON SourceFragment`
   - `EvidenceAssertion EVALUATES ResearchQuestion`
5. Scientific Canvas 只读 Research Graph，因此证据提升后自动出现；文献模块不能直接写布局或节点。
6. 删除旧 Canvas HTTP 模块、文件仓储、Web 组件和文献固定入口。开发期不迁移旧 Canvas JSON。
7. `CanvasBranchContext`/数据库 `canvasContext` 暂保留为存储兼容名称，但只表示 Research Graph 当前实体与显式引用；不得重新引入旧 Canvas 语义。

## 结果

- 文献搜索结果不会因为被浏览就污染项目事实。
- 阅读标注、证据立场、置信度、来源片段和研究问题之间形成可查询证据链。
- UI 坐标与科研事实继续由不同存储负责。
- 旧 Canvas 单独的状态、路由和并发模型被移除，组合根和 Wiki 不再依赖它。

## 后续

首版 EvidenceAssertion 直接评价 ResearchQuestion。Claim/ClaimRevision 编辑与“证据断言目标选择”在 proposal/confirm 协议完成后加入；不得用原地修改 Evidence 记录替代版本化 Claim 关系。
