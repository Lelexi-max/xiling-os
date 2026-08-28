# ADR 0033：以受约束的 R0–R8 Gate 演进为通用科研 OS

- 状态：已采用
- 日期：2026-08-28

## 背景

系统已经具备 Pi 反腐层、耐久 Agent Harness、三图分离、Research Graph、审批式海洋工作流和按需上下文，但通用领域能力主要停留在 Manifest；Artifact、Workflow、Runner、多智能体隔离和第二领域验证尚不足以支撑“先进通用科研 OS”的产品定义。继续按页面或连接器追加功能会固化海洋专用 contracts 和早期 Gate 兼容层。

## 决策

1. 保留 Pi Runtime、ResearchAgentHarness、三图边界、模块化单体和 Windows/WSL2 部署边界，不推倒重写。
2. 按 R0–R8 依赖顺序实施：宪法与基线、v1 契约、Artifact、通用执行、Graph/Context、多智能体安全、工作台、第二领域、发布门禁。
3. 开发期采用破坏性 v1 契约切换，不维护 `/api/gate4`、Knowledge Chat 消息或 Gate 3 Snapshot 兼容路径。
4. R0–R5 完成前暂停堆叠新 Provider、数据源和顶层页面。
5. 每一 Gate 同时受《科研内核架构宪法》和黄金科研任务约束；文档声明、代码存在和 UI 演示都不能替代离线 smoke 与失败路径验收。

## R0/R1 首批结果

- 新增确定性的 `node scripts/offline-check.mjs`，不依赖 pnpm 自更新或在线 registry 检查。
- 正式 Workspace API 切换为 `/api/v1`。
- 产品项目类型改为 `ResearchProject`，删除 `Gate3ProjectSnapshot`。
- Knowledge 只拥有 Chat Session 目录和 Research Graph selection；消息唯一事实源为 Agent Store。
- Knowledge schema v7 删除 `chat_messages`，Server 删除旧消息导入、回退读取和迁移备份代码。

## 后果

- 开发数据库升级到 schema v7 后旧 Knowledge Chat 消息被删除；这是经用户确认的开发期破坏性变更。
- Agent Store 中的正式消息和运行记录不受影响。
- 后续实现不得重新引入旧 API alias 或消息 fallback。
- Runner 容器和真实 Windows/WSL2 仍是独立发布门禁，离线 TypeScript 门禁不能替代它们。

