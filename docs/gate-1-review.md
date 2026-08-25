# Gate 1：开源与跨平台设计评审

## 本次需要确认的结论

1. **产品边界**：首版是单用户、本地优先、Python 物理海洋/气候科研工作台；团队协作、R、Slurm 和 Windows 原生计算后端后置。
2. **技术边界**：Web UI + Node/Pi 控制面 + Linux 容器化 Python Runner；Windows 采用 WSL2 后端。
3. **数据边界**：原始数据不进入模型；Windows 数据先从 NTFS 导入 WSL ext4，再参与高频计算。
4. **画布边界**：科研画布是 Flowith 式空间化对话与 Context Playground，不是工作流/DAG 编辑器；输入、回答、素材、工具结果、Recipe 和 Artifact 都是可分支、引用和重组的节点。
5. **Agent 边界**：Wiki、联网下载、环境安装、新增挂载以及 Agent 对既有画布内容的覆盖修改均经过可审阅补丁或审批；新回答和新分支可直接生成。
6. **开源边界**：优先宽松许可证依赖；Plane 等 AGPL 项目只参考交互与领域概念，不复制代码。
7. **上下文边界**：不强行给研究任务设置统一 token 上限；通过活动分支投影、显式跨节点引用、增量 Context Capsule、Artifact 外置和能力发现，让无关内容天然不进入请求。

## Gate 1 交付物

| 交付物 | 状态 | 评审重点 |
|---|---:|---|
| 开源与许可证矩阵 | 完成 | 直接依赖、参考实现、自研边界是否合理 |
| macOS/Linux/Windows 部署图 | 完成 | Windows 是否接受 WSL2 + 容器模式 |
| Windows 数据目录与路径策略 | 完成 | 大文件导入、导出和 OneDrive 处理 |
| 五视图低保真交互原型 | 完成 | 导航、主工作流和信息层级 |
| 统一科研领域模型 | 完成 | Chat/画布/项目/Wiki/文献是否共享对象 |
| 上下文经济架构 | 已重构 | 是否接受“活动分支 + 显式引用 + 增量胶囊”取代硬 token 限制 |
| smoke 测试门禁 | 完成 | 自研模块是否都有最短验证路径 |

## Gate 2 进入条件

- 用户明确确认 Gate 1，或指出需要修改的条目。
- 开源矩阵中没有未解决的许可证阻断项。
- Windows WSL2 数据位置、导入/导出规则获得确认。
- 五视图原型的主导航、Flowith 式科研画布和科研闭环获得确认。

## Gate 2 首个纵向样例

使用一个固定的小型海表温度 NetCDF fixture：

1. 在 Chat 提出“计算区域平均海温异常并绘图”。
2. Context Broker 只激活数据检查和 Python Runner 工具。
3. 生成计算计划并等待审批。
4. 容器内通过 xarray 计算并生成 PNG、CSV 和 RO-Crate。
5. Chat 展示 Artifact，将其固定到画布和 Wiki 草稿。
6. macOS、Linux、Windows/WSL2 运行同一 smoke 流程。
