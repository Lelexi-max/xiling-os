# ADR 0024：隔离的 Pi MCP Host 与单代理工具

## 状态

**已接受，2026-08-25。**

## 背景

汐灵需要连接用户配置的 MCP Server，但不能把全部 Server 的工具 schema、说明和连接状态常驻模型上下文，也不能让 Pi Extension 或未知 stdio 命令运行在 Fastify 主进程。`pi-mcp-adapter` 已提供成熟的代理工具、惰性连接、目录缓存、输出保护和审批拦截，直接复用优于重新实现 MCP 客户端协议。

## 决策

1. 精确固定 `pi-mcp-adapter@2.27.0` 与 `@earendil-works/pi-coding-agent@0.84.2`，纳入 `pnpm pi:compat`、许可证与 SBOM 门禁。
2. `pi-coding-agent` 只运行在 `@xiling/pi-runtime` 管理的独立子进程；Fastify 与领域包不导入 Extension API。
3. 主进程与 Host 只使用版本化 JSONL 协议。外部 stdio MCP 由 Host 以 `shell: false` 启动；Windows 首版仍在 WSL2 Linux 后端执行。
4. MCP 配置由汐灵宿主管理，不自动扫描 Cursor、Claude、Codex 或用户现有 Pi 配置；`PI_CODING_AGENT_DIR` 指向汐灵受管隔离目录。
5. Agent 仅在提示命中 Server 名称、用途或宿主关键词时获得一个固定的 `mcp` 代理 schema。完整工具目录和参数 schema 留在 Host 缓存中，通过 search/describe 按需读取。
6. Bearer Token 使用现有 AES-256-GCM 凭据库；设置 API 只返回已配置状态。OAuth 由 adapter 的按需动作处理。
7. 默认 `approval-required`。用户显式把某个 Server 标记为 trusted 后，adapter 才允许工具调用；连接测试和目录发现不等于批准外部写入。
8. 大输出由 adapter output guard 截断；后续需读取的大结果继续进入 Artifact，而不是追加到对话历史。

## 影响

- Pi 上游升级仍集中在 `@xiling/pi-runtime`，但兼容基线新增 coding-agent 与 adapter 两个精确版本。
- MCP Host 失败、重载或退出不会使 Chat、Canvas、Wiki 和本地项目存储崩溃；没有配置时不启动子进程。
- 当前设置页支持 HTTP/stdio、none/Bearer/OAuth 配置、启停、信任级别、删除和连通性测试。
- 不承诺任意 Pi Coding Agent Extension 可直接安装；MCP adapter 是经过单独审计的例外，不扩大通用插件权限面。

## 验证

- `packages/pi-runtime/src/mcp-host.test.ts` 使用真实离线 stdio MCP fixture 验证连接、搜索和调用。
- `apps/server/src/modules/mcp/mcp-service.test.ts` 验证配置、密钥脱敏和连通性测试。
- `scripts/mcp-adapter-smoke.mjs` 验证生产构建中的隔离 Host、宿主匹配和最短调用路径。
