# ADR 0007：文献图数据与渲染边界

状态：Gate 4 已采用

## 决策

使用 Cytoscape.js 3.34.1 作为按需加载的前端图引擎。后端独立生成 `LiteratureGraph`，区分 citation、recommendation、co-citation 和 bibliographic-coupling；算法版本、provider 和 fetchedAt 必须随图返回。

Semantic Scholar 是主数据源，OpenAlex 是降级源。提供商响应先投影为统一 `PaperRecord` 并按 paper ID/响应哈希缓存，Cytoscape 与项目领域对象不感知远端响应结构。

默认最多 40 个节点，用户显式扩展时最多 100 个。此限制是产品交互和远端请求控制，不是把文献正文裁进模型上下文的 token 限制。

## 自研范围

自研部分仅为数据投影、确定性局部图构建和关系解释。图渲染、选择、缩放和布局复用 Cytoscape.js。算法必须使用固定 fixture 冒烟测试，并明确 synthetic fixture 不是现实文献推荐结果。
