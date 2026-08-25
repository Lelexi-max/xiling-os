# ADR 0023：Pi 升级边界与 Package 分级兼容

## 状态

**已接受，2026-08-24。**

## 背景

汐灵需要持续复用 Pi 的模型、Agent、Session、Compaction 与 Skill 能力，同时保持 Web 科研产品、审批、容器和领域数据边界。Pi Package 还可以包含拥有完整系统访问能力的 Coding Agent Extension，不能与纯文本 Skill 等同处理。

## 决策

1. `@xiling/pi-runtime` 是唯一允许直接依赖 Pi 包的模块，对外提供 `PiCompatibilityPort` 和汐灵类型。
2. core/ai 同版本精确锁定，通过 `pnpm pi:compat` 执行版本、导入边界与行为测试。
3. 产品存储不直接采用无版本包裹的 Pi schema；Session 变化必须迁移预览和回滚。
4. Pi Package 作为资源分发格式兼容：Skill/Prompt 可审计导入，Tool Extension 隔离适配，TUI/Theme/Coding Command 不兼容。
5. 不引入完整 `pi-coding-agent` 作为 Web 后端插件宿主，不在 Server 进程运行任意第三方 Extension。ADR-0024 允许受审计的 `pi-mcp-adapter` 在 `@xiling/pi-runtime` 管理的独立子进程运行，不改变此主进程边界。

## 影响

- Pi 升级的主要修改和测试面被限制在一个适配包。
- 不能承诺所有 Pi Coding Agent 插件零修改运行。
- 插件安装功能晚于兼容协议和隔离执行器；设置页在此之前保持只读。
- MCP 已按 [ADR-0024](0024-isolated-pi-mcp-host.md) 由独立 Host 显式接入，不通过 Pi Package 隐式安装或扫描外部配置。

详细机制见 [Pi 升级与 Package 兼容架构](../architecture/pi-package-compatibility.md)。
