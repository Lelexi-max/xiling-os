# 自研模块冒烟测试门禁

## 统一约定

- 主入口：`pnpm smoke`。
- Windows 入口：`./scripts/smoke.ps1`。
- Python 子集：`pytest -m smoke`。
- 默认离线、固定 fixture、单项原则上不超过 60 秒。
- 每项覆盖启动、最短成功路径、关键失败路径和资源清理。
- 自研能力没有 smoke 测试不得合并。

## Gate 2 起必须存在的测试

| 模块 | 成功路径 | 失败/清理路径 |
|---|---|---|
| Pi Runtime / Harness | 多轮流式消息、连续工具调用、累计 usage、compaction 后继续 | 工具错误、循环上限、客户端脱离/重连、取消、服务重启恢复 |
| Pi Upgrade Boundary | core/ai 锁步、公共适配类型、Session/Skill/Compaction fixture | 版本漂移、应用绕过适配包、私有 dist import 被阻止 |
| Pi Package Importer | 固定本地 Skill/Prompt 包完成审计、确认、原子发布和懒加载 | lifecycle script、未固定 git、代码扩展、路径越界和回滚失败被阻止 |
| Context Broker | 正确投影活动科研实体、有限两跳邻域、显式引用和有效胶囊，只激活命中能力；整图不进入模型 | 循环关系保持有界；窗口不足时按语义层级降级并解释，无关能力不进入上下文 |
| Scientific Canvas Layout | 项目/视图隔离、拖动/纵向整理/viewport 重启恢复，且不改变 Research Graph | revision 冲突返回 409，投影外实体拒绝写入 |
| Canvas Patch | 预览后确认并原子写入 | 拒绝不落盘，撤销恢复 |
| Project/Wiki | CRUD、版本和重启恢复 | 冲突更新返回明确错误 |
| Literature Graph | fixture 生成引用/共被引分数 | 缺失论文和重复 DOI 可降级 |
| Connector | 元数据→计划→模拟下载 | 超时取消且无半成品 |
| Runner | xarray fixture→PNG/CSV/manifest | 中断内核并回收容器 |
| Provenance | RO-Crate 写入再读取 | 哈希不符进入 quarantined |
| Approval | 批准后仅开放声明资源 | 未批准/过期操作被拒绝 |
| Token Ledger | 记录多组成 token 与费用 | 未知模型保留原始 usage |
| Windows Doctor | WSL/Docker/端口检查通过 | 缺失组件给出无副作用建议 |
| Windows Path Bridge | 中文、空格、C/D 盘导入 | UNC、非法名、越界被阻止 |
| Import/Export | NTFS→WSL→Artifact→NTFS | 空间不足不留下有效记录 |
| Stop/Recovery | 优雅停止并再次启动 | Runner 卡死后超时升级 |
| Encoding | UTF-8/LF 跨平台一致 | 非法编码返回定位信息 |
| Research Graph | 冲突证据、多跳 Artifact 溯源、分项投影、applied ledger 幂等、Checkpoint 后重开 | 无效端点整体回滚；projection key 内容冲突拒绝；进程非优雅退出后恢复已提交 WAL 且无拓扑变化 |
| Research Graph Projector | Knowledge/Wiki/Evidence 与 Workflow/Agent journal 形成计划、审批、快照、Run、Artifact、Review、生命周期关系 | 源已提交/目标未写和目标已提交/源未确认均可重放；旧 ProjectItem/Wiki/Canvas settlement 不再发生 |
| Literature Evidence Promotion | 原文摘录、定位、解释、局限、立场、置信度生成 Paper/Fragment/Assertion，并以 ASSERTS 指向已接受 ClaimRevision | 临时发现结果不入图；未接受 proposal 不生成 ClaimRevision；跨项目/不存在 ClaimRevision、非法立场或置信度拒绝 |
| Source Content Resolver | 只对入选上下文按 kind 读取 Evidence 原文、Paper 摘要、Wiki Revision、Agent Entry、Workflow 与受管 Artifact | 无精确来源时明确标记非原文；跨项目、路径越界和大 payload 不进入模型 |
| Human Factors / Responsive UI | Chat 中栏与 Artifact 联动、窄屏抽屉、科研画布一跳聚焦/关系筛选、文献详情关闭恢复、键盘焦点可见 | 720/1024/1440 宽度无遮挡；减少动态模式下无强制动画；旧静态 Artifact 和 Gate 3 页面不再出现 |
| Agent Execution Graph | Project/Session 作用域从耐久 Session、Run、Operation、Entry、Usage 投影正确关系 | 跨项目拒绝、Tool-call 去重、返回上限标记截断；拖动不写 Agent Store |
| Multi-Agent Orchestrator | single/parallel/chain 使用独立 child session，父子血缘、ContextManifest hash、结果和 usage 可恢复；UI 只显示低密度任务卡 | 兄弟历史不泄漏、并发/任务/预算上限、禁止递归、父取消级联、部分失败不产生科研事实 |
| Science Domain Registry | `general-science` 与项目所选领域组合提示、能力、角色、连接器和 Artifact 声明 | 未知/重复领域拒绝；未选择领域的工具不激活；API 不暴露角色 system prompt；Manifest 不自动获得执行权限 |

Gate 4.5 说明：4.5-B 已完成中枢垂直切片；4.5-C 已完成增量 Compaction、正式 Chat/旧 Canvas 切换、`sourceEntryId` 全文覆盖判定、压缩历史按需回读、旧数据逐条幂等迁移、会话归档边界和不可变双数据库备份。4.5-D 已删除旧 Chat 写 API 与 Web retained 真相源，并增加 durable-first Workflow 草稿投影、稳定幂等键、启动 reconcile、项目作用域和 Harness 关闭等待。RG-2 进一步将 Workflow 主仓储切到 SQLite，增加 Knowledge/Workflow outbox、Agent journal 重放、Research Graph applied ledger，并删除旧三处文件级 settlement。`scripts/gate-4.5-b-agent-center-smoke.mjs`、`scripts/gate-4.5-c-migration-smoke.mjs` 与 `scripts/gate-4.5-d-main-path-smoke.mjs` 验证中枢、迁移和主路径。`scripts/mcp-adapter-smoke.mjs` 使用固定离线 stdio fixture 验证独立 Pi MCP Host、宿主元数据命中、惰性目录和真实工具调用。`scripts/research-graph-smoke.mjs` 验证 LadybugDB 类型化科研图、事务、applied ledger、Checkpoint 与异常退出恢复；RG-1 的 Agent Execution Graph 由单元/API 测试覆盖，并通过真实浏览器验证作用域切换、节点详情、拖动、自动整理与面板恢复。真实 Windows 11 + WSL2 专机仍是发布门禁。

## CI 矩阵

- Linux：单元、集成、smoke、E2E、许可证、SBOM。
- macOS：核心、路径、启动和浏览器 smoke。
- Windows 原生 hosted runner 不属于支持目标，不作为合并门禁。
- WSL2 自托管 runner（可选）：在 Windows 主机的 WSL2 Linux 环境中运行 TypeScript、路径/编码、SQLite、Docker 和完整闭环；标签为 `xiling-wsl2`。

## 首个科学金标准

固定生成一个小型 CF-compliant SST NetCDF：12 个时间点、规则经纬网、已知异常值和缺测值。验证：

- 时间、经纬度和单位识别。
- 指定区域和时间切片。
- 气候态与异常计算。
- 缺测值不污染平均。
- CSV 数值在三平台容差内一致。
- 图像使用相同数据摘要；RO-Crate 中输入、代码、环境和输出哈希齐全。
