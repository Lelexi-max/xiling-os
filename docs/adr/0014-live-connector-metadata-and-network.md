# ADR-0014：正式连接器元数据、体积置信度与网络配置

## 决策

正式模式由 `XILING_CONNECTOR_MODE=live` 显式启用。元数据探测和下载都在非 root Runner 容器中执行，凭据与代理配置只经 stdin 传入，不进入命令行、数据库、日志、Agent 上下文或 Artifact。

元数据体积必须标记为 `exact`、`estimated`、`upper_bound` 或 `unknown`。`unknown` 不允许生成下载审批单；UI 必须展示估算方法。ERDDAP 使用 NcML 维度上界，Argo 使用 GDAC 索引估算，Copernicus 使用官方 `subset(dry_run=True)`，Harmony capabilities 不提供体积时诚实阻止审批。

正式元数据按请求哈希缓存 15 分钟。缓存只保存短结构摘要和来源哈希，不保存远端原文或凭据。

## 网络兼容

Runner 支持标准 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY`、`REQUESTS_CA_BUNDLE` 和 `SSL_CERT_FILE`。这些值随密钥一同经 stdin 注入进程环境，不写入 Docker `create` 参数。企业自定义 CA 文件应安装在受管 WSL2/Runner 环境并通过上述路径指向；不得从任意 Windows 路径直接挂载。
