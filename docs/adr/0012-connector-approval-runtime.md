# ADR-0012：连接器审批与 Runner 边界

- 状态：Gate 4 已采用
- 日期：2026-08-23

## 决策

四类海洋数据源共用两个最小接口：`ConnectorMetadataProbe` 只返回变量、单位、选中形状、元素字节数、来源与内容哈希；`ConnectorDownloader` 只接收已批准请求并返回内容寻址 Artifact。官方客户端、凭据和远端响应不进入 Agent 上下文。

状态机固定为：元数据探测 → `pending_approval` → `approved/rejected` → `downloading` → `completed/failed/cancelled`。服务端把探测结果哈希与原始请求哈希绑定，客户端不能修改元数据摘要后扩大下载范围。下载中断后不会自动重试或恢复公网写入，重启时显式记为失败，等待用户重新确认。

当前开发默认适配器是明确标注的离线 fixture，用于验证审批、拒绝、持久化、Artifact 哈希和 UI；它生成带 `Not scientific data` 警告的 JSON，不能被当作科研数据。生产适配器将在受控 Runner 容器中复用 ERDDAP/argopy/copernicusmarine/harmony-py，并保持相同接口。

## 凭据边界

凭据只在命中 Copernicus 或 NASA 的单次 Runner 任务中临时提供，不进入请求哈希、任务 JSON、Artifact、日志或模型上下文。未配置相应账户时，服务端在元数据探测前拒绝请求。真实下载仍需 UI 中的独立二次确认。

## 冒烟门禁

离线测试覆盖：未批准拒绝执行、显式拒绝、批准后成功、内容哈希 Artifact、任务持久化与恢复、路径哈希校验。真实公网小切片将在生产适配器接入后单独确认，不由 smoke 自动触发。
