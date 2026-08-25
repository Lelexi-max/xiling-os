# Gate 3 评审清单

## 已交付闭环

1. 确定性生成 8 条 Argo 风格温盐剖面的 NetCDF fixture，并读取变量、维度、范围、体积和 SHA-256。
2. 生成变量、区域、深度、时间、预计体积和目标 URI 的切片计划；对递归规范化 JSON 计算计划哈希。
3. 未批准时服务端拒绝执行；批准仅绑定当前计划哈希和声明资源。
4. 正式 Server 通过无网络、限时 Linux 容器运行 QC、混合层深度和上层海洋热含量分析。
5. 生成 CSV、MLD 地图、温度剖面图、计划、环境、Reviewer、manifest 和 RO-Crate。
6. 自动 Reviewer 检查剖面数、位置 QC 和有限数值；结论与局限写入项目快照。
7. 运行结果以 Artifact URI 链接到 Flowith 式画布分支，并形成版本化 Wiki 修订。
8. 并发运行互斥、应用级取消、重启悬挂恢复、Artifact 哈希复验与安全读取接口。

## 验证证据

- TypeScript：5 个测试文件、19 项测试通过。
- 容器：8 profiles、6 analysis artifacts、Reviewer accepted。
- 正式适配器：`DockerArgoResearchRunner` 通过 create/copy/start/copy/cleanup 冒烟，返回 7 个 Artifact URI 和 3 项 Reviewer 检查。
- 当前主机：macOS 宿主 + Docker Linux Runner 已验证。
- Windows 兼容机制：业务层无平台绝对路径；执行仍走 WSL2/Linux 容器；PowerShell doctor/path smoke 延续 Gate 2 门禁。

## 评审限制

- 这是固定 synthetic fixture 的方法闭环，不是现实观测结论。
- 当前环境无法替代真实 Windows 11 + WSL2 机器验收；Windows 完整演示仍须在发布候选专机执行。
- Gate 3 只包含单项目纵切；公网 Argo/Copernicus/NASA 连接器和完整文献图属于 Gate 4。

## 用户确认

2026-08-23：用户授权自检无关键问题后进入 Gate 4；修复自检发现项并重跑完整门禁后，Gate 3 确认完成。
