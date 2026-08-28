# ADR-0010：Pi 模型目录与显式在线路由

> 2026-08-28：产品 `offline/live` 双模式已由 [ADR 0037](0037-real-model-routing-and-role-overrides.md) 取代。本文件仅保留早期决策历史。

- 状态：Gate 4 已采用
- 日期：2026-08-23

## 决策

汐灵不维护独立的完整模型清单。服务端从当前 Pi `pi-ai` provider factory 读取模型目录，只向设置视图暴露每家最多六个推荐文本模型。模型目录不会进入 Agent 上下文。

运行时持久化 `offline/live`、提供商、模型和推理强度。默认始终是离线；启用在线模式需要完整模型选择、对应凭据和用户二次确认。缺少任一条件时，服务端在创建 SSE 流和公网请求前返回 `409`。

凭据不写入进程环境。服务端只在一次选定 provider 请求的 `apiKey` 参数中注入解密后的值，并设置有限重试、最大退避等待和请求超时。Chat 断开继续通过 Pi `abort()` 的信号链取消。

## Token 经济性

- 不把所有模型、MCP、Skill 或工具 schema 放进系统提示。
- 模型选择在宿主路由层完成，每次请求只得到一个 `provider/model`。
- 推理强度是任务级选择，不以统一 token 上限截断科研回答。
- 后续自动路由只允许读取结构化任务类型和模型能力摘要，不读取完整模型目录。

## 替换边界

`createProviderRoute` 是 provider 调用边界，`ModelRuntimeStore` 是本地偏好边界。未来可以替换模型目录排序或配置存储，而不改变 Chat SSE 和 Pi Agent Adapter。

## 冒烟测试

- 离线默认与重启恢复。
- 在线模式缺少模型或凭据时拒绝。
- 目录有界且来自四个 Pi provider。
- 凭据只注入选定 provider 的一次请求参数。
- 未知模型拒绝、Chat 离线回退和断开取消。
