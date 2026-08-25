# 汐灵 OS（Xi Ling OS）

面向物理海洋与气候研究者的本地优先 AI 科研工作台。

当前状态：**Gate 1–4.5 功能与 Agent 中枢纠偏已实现，Gate 5 Beta 发布候选正在执行**。项目级科研 Workflow 已串联 Chat、审批、官方数据连接器、隔离 Runner、Reviewer、Artifact、画布与项目 Wiki。当前架构采用模块化单体，保留本地启动体验并为未来替换 Runner、文献源和连接器提供稳定边界。

> 开发、评审或扩展任何模块前，请先阅读仓库的 [活设计文档](DESIGN.md)。它是当前架构、数据所有权、不变量和演进规则的首要入口；Gate 文档只保留为历史验收记录。

## Gate 1 入口

- [评审清单](docs/gate-1-review.md)
- [开源复用与许可证矩阵](docs/oss-evaluation.md)
- [三平台部署与 Windows/WSL2 设计](docs/architecture/deployment.md)
- [统一科研领域模型](docs/architecture/domain-model.md)
- [上下文经济架构](docs/architecture/context-budget.md)
- [冒烟测试门禁](docs/testing/smoke-matrix.md)
- [五视图交互说明](docs/prototypes/ux-spec.md)
- 交互原型：`prototypes/gate-1/index.html`

## Gate 2 开发入口

- `pnpm dev`：启动 Web 与 Server。
- `pnpm start`：构建并由 Server 托管正式 Web，访问 `http://127.0.0.1:4317/`。
- `pnpm smoke`：TypeScript、测试和 Web 生产构建。
- `pnpm architecture`：检查 workspace 模块依赖方向。
- `docker build -t xiling-runner:gate2 services/runner`：构建受控科研 Runner。
- `docker run --rm xiling-runner:gate2 python smoke.py`：运行固定 NetCDF → xarray → Artifact → RO-Crate 闭环。
- [Gate 2 评审清单](docs/gate-2-review.md)

正式应用不能通过 `file://` 双击运行；直接打开 HTML 时会展示启动说明，不再显示空白页。

## Gate 3 评审入口

- `docker build -t xiling-runner:gate3 services/runner`：构建固定版本科研环境。
- `docker run --rm xiling-runner:gate3 python gate3_smoke.py`：离线验证固定 Argo/NetCDF 闭环。
- Web “项目”视图：生成计划、批准声明资源并调用真实容器运行。
- Web “Wiki”视图：检查 Reviewer 结论、局限和 Artifact URI 的版本化沉淀。
- [Gate 3 评审清单](docs/gate-3-review.md)

## Gate 4 当前入口

- Web “项目”视图底部：ERDDAP、Argo GDAC、Copernicus Marine、NASA Harmony 懒加载连接器目录与预检。
- Web “文献图”视图：Cytoscape.js 种子网络，区分引用、推荐、共被引与书目耦合。
- Web “科研画布”视图：节点自由拖动/连线、自由笔记、自动整理、MiniMap，以及跨重启布局恢复。
- [Gate 4 官方接口基线](docs/gate-4-sources.md)
- [Gate 4 开发检查点](docs/gate-4-review.md)

## 当前架构入口

- [模块化单体与替换边界](docs/architecture/modular-monolith.md)
- [本轮架构现代化计划](docs/architecture/modernization-plan.md)
- [上下文经济机制](docs/architecture/context-budget.md)
- [ADR 0021：模块化单体与版本化存储](docs/adr/0021-modular-monolith-and-versioned-storage.md)

## Gate 5 发布候选

- [Gate 5 发布门禁与尚未完成项](docs/gate-5-review.md)
- [活设计文档](DESIGN.md)
- [第三方声明](THIRD_PARTY_NOTICES.md)
- `pnpm check`：架构、Pi 兼容、类型、测试与 smoke 总门禁。
- `pnpm compliance && pnpm sbom:generate`：许可证检查与 SPDX 2.3 SBOM。

当前 GitHub 版本是开发阶段 Beta 候选，不应被视为已完成真实 Windows 11/WSL2 专机验收或正式 WinGet/签名安装包发布。
