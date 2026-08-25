# ADR 0021：模块化单体与版本化存储

- 状态：已接受
- 日期：2026-08-24

## 背景

Gate 1–4 已完成主要产品闭环，但 Server 路由、持久化和前端协议随功能累积形成耦合。继续按页面追加逻辑会使 Canvas、Wiki、连接器和 Agent 难以独立替换与测试。微服务会显著增加本地优先和 Windows/WSL2 部署复杂度。

## 决策

采用模块化单体：公共领域类型位于 `contracts`，运行时请求校验位于 `api-contracts`；Server 作为组合根注册按领域拆分的路由模块；Knowledge 通过窄 ports 暴露能力；Canvas 通过 Repository 管理带修订号的项目图文档。

SQLite 使用单调 schema migration。Canvas 更新使用乐观并发、项目内串行化与原子文件替换。前端统一 API、SSE 和研究会话协议。

`Gate3ResearchService` 冻结为兼容层，新科研功能进入项目级 Workflow。暂不拆微服务，暂不处理 MCP 连接实现。

## 后果

- 新模块可以针对端口测试，并能在不改视图协议的情况下替换适配器。
- 应用仍保持单进程 Node 服务和独立 Runner，安装与诊断成本不增加。
- 组合根仍负责跨模块事务式编排；在 SQLite 与 Canvas 之间暂不承诺分布式原子性，必须用幂等 settlement 恢复。
- Repository 和迁移成为新增持久化能力的强制门禁。

## 验证

- `pnpm architecture` 检查 workspace 依赖方向。
- 测试覆盖数据库版本、旧数据恢复、Canvas revision 冲突/并发更新和 SSE 分片。
- 全量 smoke 保持离线可执行。
