# 上下文经济架构：让系统天然省 Token

> 本文同时区分已实现与目标机制。当前主路径已实现用户选择的 Research Graph 实体、确定性的两跳有限邻域、显式引用、node Capsule、按需 Skill/tool、整回合历史选择、增量 Compaction、来源回读和组装缓存；TaskPacket、稳定提供商前缀、分层 Capsule 与每次工具继续回合的重新组装仍是后续能力。Agent Execution Graph 是只读可观测投影，绝不直接进入模型上下文；旧 Canvas 已退出 Context 主路径。

## 原则

汐灵不以固定 token 上限驱动科研任务。不同模型、任务和证据量需要不同上下文，强制统一限额会伤害科研完整性。系统优化目标改为：**同一信息只表达一次、只在需要时解析、只沿明确的上下文路径流动，并尽量复用已计算结果。**

Token 数字只用于可观测性、异常保护和成本预估，不作为正常任务的硬裁剪规则。

## 1. 科研图选择即上下文入口

### Active entity

用户在科研画布显式选择一个科研实体作为 Chat 上下文。普通浏览和单击详情不会悄悄改变 Agent。系统只读取：

1. 活动科研实体；
2. 按关系优先级确定的两跳局部邻域，默认最多 8 个；
3. 邻域中较早实体的增量 Context Capsule；
4. 明确引用的 Artifact、论文证据和数据摘要。

Research Graph 可以有环，因此不会按对话祖先递归整图。其他项目、无关子图和 Agent Execution Graph 天然不进入请求。

### Explicit references

用户可选择一个或多个科研实体作为显式引用。系统装载被选实体，不自动附带其完整子图。需要正文时再通过 Source Resolver 或 Artifact reader 读取，而不是重复全部消息。

### Synthesis

跨实体综合将来产生新的 Claim/Artifact proposal，记录引用实体、投影哈希和输出。确认写入 Research Graph 后继续复用该结果，不再次输入所有原始来源。

## 2. 增量 Context Capsule

- 当前每个科研实体维护一个内容寻址 Capsule；新增或修改实体只更新该实体派生缓存。用户选择后，`SourceContentResolver` 才按 source kind 读取精确 Evidence 摘录、Provider Paper 摘要、Wiki Revision、耐久 Agent Entry/Run、Workflow 或受管文本 Artifact。
- 组装结果逐项标记来源等级和 locator；无精确来源时必须写明“结构化摘要（非原文）”或“阅读解释（非原文）”。
- 分支祖先按 DAG 计算，较早节点使用各自 Capsule，近期节点与 Quote 使用原文。系统不再生成一个未被消费的 branch Capsule。
- 胶囊保存目标、约束、关键决策、未解决问题、证据 URI 和覆盖节点哈希。
- 原节点编辑后，依赖其 `sourceHash` 的胶囊失效并延迟重建。
- 最近内容保留原文；稳定的旧内容优先使用胶囊。若任务需要精确措辞，可按节点 ID 回取原文。
- 胶囊不是证据，模型输出中的引用仍指向论文、数据或 Artifact。

## 3. 内容寻址与引用传递

- PDF、NetCDF、图、表、代码、日志和长文档只保存一次，以 `artifact://sha256` 引用。
- 节点之间传递 URI、结构化摘要和选择器，不复制 payload。
- 同一数据切片、论文段落、工具结果或模型输出按内容哈希去重。
- 工具先返回 schema、统计摘要和 Artifact URI；模型需要具体内容时再按变量、页码、行或空间范围读取。
- 子 Agent 接收 `TaskPacket`：目标、输入 URI、必要证据、输出契约和权限，而不是继承主会话全文。

### 原生图像上下文

- 当前轮上传图像按模型原生内容块发送，不转写、不 OCR、不抽帧；二进制不会进入系统提示、消息文字或压缩摘要。
- 对话仅持久化附件 ID、名称、MIME、大小与 SHA-256。图片字节位于项目作用域附件存储，模型请求构造完成后不保留额外 base64 副本。
- 历史图片默认只提供描述符。仅当新问题明确引用上一张、此前图片或图中内容时，加载最近一个相关历史回合的原始图片；因此会话变长不会导致所有旧图片每轮重复计费。
- ContextProjection 缓存键仍基于耐久消息与投影；附件完整性由 ID + SHA-256 独立校验，不能用同名文件替换。
- 音频、视频在 Pi 缺少原生内容块时保持不可用，禁止通过预处理伪装成文字或图像来绕过能力门控。

## 4. 能力发现而非能力常驻

- 宿主侧 Capability Catalog 保存全部工具、MCP 和 Skill 元数据，不进入模型提示。
- 常驻的是能力索引；MCP 在任务命中已配置 Server 的名称、用途或关键词后只增加一个固定代理 schema。
- 只有被选择的 Skill/本地工具才通过 Pi 动态装载；具体 MCP 工具 schema 留在隔离 Host，通过代理 search/describe 按需读取，不批量进入 provider 请求。
- Skill 正文与连接器说明在首次使用时加载并按会话阶段缓存；MCP Server 元数据缓存由 adapter Host 持有。
- 阶段结束时建立新的稳定提示前缀；避免每轮增删工具破坏提供商 prompt cache。

工具数量没有人为统一上限；候选集合由任务相关性、schema 重复度和当前阶段决定。异常膨胀时告警并要求能力解析器重新聚类，而不是静默截断。

## 5. 稳定前缀与缓存

- 系统规则、领域安全约束和稳定工具定义组成版本化前缀。
- 项目简报引用 `project://brief/<version>`，仅变更时生成新版本。
- 对支持 prompt caching 的提供商保持前缀顺序和内容稳定。
- 数据元信息、文献元数据、分支胶囊、检索结果和工具结果均使用内容哈希缓存。
- 相同 ContextProjection 生成相同 `projectionHash`，允许复用组装结果与审计记录。

## 6. 检索策略

默认优先级：

1. 用户显式选择的节点与文件；
2. 当前分支祖先和 Recipe 当前步骤；
3. 结构化项目对象的直接关系；
4. Wiki/证据库的混合检索；
5. 跨画布召回。

只有前一级不足以完成任务时才扩大检索范围。检索采用“先目录/标题/摘要，后正文”的两阶段方式；不会把 top-k 结果机械拼接进提示。

## 7. 规划、执行与审查隔离

- Planner 只读取问题、约束、数据/证据目录，产出 Recipe。
- Executor 每个步骤只读取对应 TaskPacket，并将大结果写入 Artifact。
- Reviewer 读取声明、证据包、计算摘要和 provenance，不复制 Planner/Executor 全部对话。
- 阶段间通过结构化 Handoff 传递，而非自然语言全文转发。
- 多智能体委派使用内容寻址 `ContextManifest`：项目简报版本、显式科研实体、来源 URI 与 projection hash。每个子任务创建独立 Agent Session，不复制父会话全文或兄弟结果。
- `blind` Reviewer 可读取待审 Claim/Run 与证据，但不读取主 Agent 的偏好性解释；子 Agent 只加载角色 capability allowlist 命中的工具与 Skill，且不获得委派工具。
- 子结果的完整 transcript 留在 Agent Store，父 Agent 默认只接收摘要、来源、Artifact、局限与 usage；大结果继续写 Artifact。

## 8. 自适应组装与降级

Context Assembler 根据模型窗口、任务类型和现有投影计算可用空间。如果内容超出模型能力，按以下语义降级：

1. 用已有 Capsule 替换旧原文；
2. 将重复内容折叠为单个内容寻址引用；
3. 对表格、日志和数据应用结构化视图；
4. 将可独立子任务拆成 TaskPacket；
5. 若仍无法保证证据完整性，向用户说明缺口并请求缩小问题或换用更长上下文模型。

系统不得只因预设数字而静默删除用户证据。

## 9. 用户可见的上下文控制

- Composer 显示当前 Follow-up 锚点和 Quote 节点缩略卡。
- 每轮回答可展开“使用了什么”：原文节点、Capsule、Artifact、Skill 和工具。
- 用户可固定、移除或要求按原文读取某个上下文项。
- Canvas 搜索与跨画布召回只返回候选，用户选择后才进入主要上下文。

## 10. 观测指标而非硬门槛

持续记录：

- 有效内容 token 与重复 token 比例；
- 原文、Capsule、Artifact 摘要、工具 schema 各自占比；
- prompt cache 命中率；
- 每个结论的证据覆盖率；
- ContextProjection 中未实际使用的内容；
- 同一信息被重复发送的次数；
- 每个 TaskPacket 的输入/输出与成本。

回归目标是减少重复、提高缓存与证据密度。仅在模型窗口溢出、工具返回失控或用户设置费用预算时启用保护阈值。

模型目录和路由同样留在宿主层：设置页从 Pi 目录读取少量推荐项，Agent 每轮只收到最终选中的一个模型，不接收其他提供商、价格或模型清单。推理强度按任务选择，避免用统一输出上限替代任务判断。

## 11. 必测机制

- 选中一个分支后，兄弟分支内容不会进入 ContextProjection。
- Quote 两个节点只带入它们及最小依赖。
- 同一 Artifact 被十个节点引用时，payload 不重复。
- 新增一个节点只重建受影响胶囊。
- 编辑旧节点会使该节点 Capsule 与相关 projection cache 失效。
- 子 Agent 不继承父会话全文。
- 无关 Skill/MCP/tool schema 不进入模型请求。
- 超出模型窗口时语义降级可解释、可审计且不静默丢证据。
