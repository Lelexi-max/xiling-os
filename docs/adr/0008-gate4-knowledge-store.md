# ADR-0008：Gate 4 项目、Wiki 与证据存储

- 状态：Gate 4 已采用
- 日期：2026-08-23

## 背景

项目管理、Wiki、文献证据和画布引用需要跨重启持久化，但不能把完整 Markdown、论文图或运行日志反复复制到 Agent 上下文。首版还必须兼容 macOS、Linux 与 Windows 11 的 WSL2 后端。

## 决策

- 使用 Node 22 自带的 `node:sqlite`，数据库位于受管 Linux/WSL ext4 数据目录。
- 使用 Apache-2.0 的 Drizzle ORM 提供类型化查询；运行时迁移保持为显式、幂等 SQL，避免启动时依赖 CLI。
- Wiki 修订只新增、不覆盖；反向链接从当前 Markdown 的 `[[slug]]` 引用计算。
- 证据以项目和论文 ID 幂等保存；画布只保存论文摘要节点，不复制全文。
- Wiki 编辑器使用 Milkdown Kit 的 CommonMark、history 和 listener 最小组合，整个模块按视图懒加载；AI、完整代码语言包和图片上传默认不加载。
- 删除项目和 Wiki 页面采用可恢复归档；任务事项允许物理删除。

## 替换边界

`KnowledgeService` 与 `/api/gate4/projects`、`/api/gate4/project-items`、`/api/gate4/wiki`、`/api/gate4/evidence` REST 契约构成替换边界。若 `node:sqlite` 或 Drizzle 的实验接口不能在发布候选版本冻结，可在不改变 Web 契约的情况下切换到稳定 SQLite 驱动。

## 验证

- 项目与事项创建、状态更新和归档。
- Wiki 页面创建、版本追加、反向链接和重启恢复。
- 文献证据去重、固定画布幂等和布局恢复。
- SQLite 文件不位于 Windows `/mnt/c` 活动目录；Linux/macOS hosted CI 覆盖通用编码与数据库测试，真实 Windows 路径由 WSL2 自托管门禁覆盖。
