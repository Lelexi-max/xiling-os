# ADR 0034：统一内容寻址 Artifact Registry

- 状态：已采用
- 日期：2026-08-28

## 背景

早期 Workflow 和 Connector 直接把目录结构编码进 URI。该 URI 同时承担临时执行定位、产品身份和科研图引用，导致同一 payload 不能跨运行去重，项目边界与完整性由各路由重复实现。

## 决策

1. `packages/artifacts` 是 payload 与元数据的唯一正式拥有者；payload 以 SHA-256 分层存放，元数据使用 SQLite。
2. 正式 URI 固定为 `artifact://sha256/{digest}`。临时 Runner/Connector URI 只允许在执行适配器内部存在，并在 Workflow 提交结果前导入 Registry。
3. 每条记录保存项目、名称、MIME、类型、大小、来源 URI、producer run、生命周期与校验时间；读取、验证和状态变更都校验 `projectId`。
4. API、Web 与 Agent 只读取 Registry。大型内容使用有界读取；Agent 只可读取声明为文本的受管 Artifact。
5. Blob 可以跨记录去重，但元数据记录保持项目隔离；同一 hash 不赋予跨项目读取权限。

## 后果

- 开发期旧 Workflow URI 不迁移、不回退；重新运行 fixture 即可生成正式记录。
- Runner 工作目录仍可使用普通路径，但不能成为外部身份或 Research Graph 最终 URI。
- 后续代码快照、环境锁、媒体和报告都必须经同一 Registry，不能增加专用 payload 表。

## 验收

覆盖去重、项目越权、Unicode 文件、分段读取、生命周期、篡改检测与 Workflow 端到端注册，并通过 `node scripts/offline-check.mjs`。
