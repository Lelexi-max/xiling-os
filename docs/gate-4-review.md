# Gate 4 开发检查点

> 模型配置部分是历史验收记录；当前产品模型路由已由 ADR 0037 改为统一真实调用、角色级分配和 Chat 单次覆盖，不再提供离线/真实开关。

状态：功能实现完成，正在做发布前架构加固；Gate 5 暂停，仍等待 Windows 11 专机验收。

## 已完成

- 四类连接器的轻量目录、统一请求、预检、元数据解析后体积计算契约。
- 缺少元数据和凭据时的显式状态，不伪造体积，不开放审批下载。
- 持久化连接器任务状态机：pending approval → approved/rejected → downloading → completed/failed/cancelled。
- 未审批下载拒绝、并发互斥、重启恢复和内容寻址 Artifact 校验。
- Cytoscape.js 3.34.1 按需加载的文献图视图。
- 独立、确定性的引用、推荐、共被引和 Jaccard 书目耦合算法与 100 节点上限。
- Semantic Scholar 主源、OpenAlex 降级源的统一 `PaperRecord` 边界。
- Flowith 式画布节点可自由拖动、连线和新建；完整布局与自由笔记原子持久化，刷新后恢复。
- 文献图支持论文搜索、关系类型筛选、种子节点区分、详情联动和一键适应视图。
- 画布布局 API 对节点数、字段长度和节点类型做边界校验，并覆盖重启恢复冒烟测试。
- 项目、任务、里程碑与实验事项采用 SQLite/Drizzle 持久化，并提供状态看板与科研运行切换。
- Wiki 采用按视图懒加载的 Milkdown Kit 最小组合，支持页面创建、不可变版本、反向链接和重启恢复。
- 文献“加入证据库”和“固定到科研画布”已接入幂等持久化命令。
- 项目/Wiki/证据/画布/凭据/模型路由/文献 provider/连接器审批均覆盖离线冒烟路径；测试数量以当前 CI 报告为准，不在文档中维护易过期的静态数字。
- 设置视图覆盖四类 Pi 模型提供商、Semantic Scholar、OpenAlex、Copernicus Marine 与 NASA Earthdata；只展示配置状态，不回传凭据值。
- 凭据使用 AES-256-GCM 加密，主密钥与密文分离、文件权限 0600、环境变量优先，并与项目备份和模型上下文隔离。
- 连接器目录读取安全状态接口；有凭据时从 `credentials_required` 推进到元数据检查阶段。
- 设置视图从 Pi provider catalog 按需读取有界模型目录，支持默认模型、推理强度与离线/真实模式选择。
- 真实模型路由默认关闭；缺少模型或凭据时在公网请求前拒绝，启用需要费用提示二次确认，凭据只注入单次选定 provider 请求。
- Web smoke 校验构建入口引用的哈希静态资源全部存在；生产启动必须遵循先构建、后启动服务的顺序。
- Semantic Scholar 搜索与 OpenAlex 降级已投影为统一论文对象，只请求文献图需要的字段；支持可选 API Key。
- 文献检索具备 SHA-256 查询缓存、24 小时 TTL、并发合并、429/5xx/网络退避、主源降级和 stale-cache 恢复。
- 文献图已接入公网检索入口，结果可继续加入证据库或固定到科研画布。
- 连接器 UI 已打通元数据摘要、体积预估、独立审批单、批准/拒绝、执行和内容哈希 Artifact；默认 fixture 明示为非科研数据，不会因配置凭据而自动访问公网。
- 元数据来源哈希与原请求哈希由服务端绑定，避免客户端篡改预估后扩大下载；中断任务在服务重启后显式失败，等待重新确认。
- Gate 4 Runner 已实现 erddapy、argopy、copernicusmarine 与 harmony-py 四个生产下载适配器，统一使用非 root 容器、CPU/内存上限和内容哈希 manifest。
- 凭据通过已批准容器的标准输入一次性注入，不进入命令行、环境变量、计划 JSON、Artifact 或 Docker inspect；取消使用 Docker stop/kill 升级路径。
- 官方客户端镜像完成真实构建；依赖冲突由 smoke 发现并固定为 xarray 2025.9.0、NumPy 2.1.3。四客户端的实际延迟导入和连接器 Artifact smoke 已在 `--network none` 容器中通过。
- 正式元数据探测已实现：ERDDAP NcML 上界、Argo GDAC 索引估算、Copernicus 官方 dry-run、Harmony capabilities 未给体积时阻止审批；短摘要缓存 15 分钟。
- Connector 审批记录锁定 fixture/live 模式，代理与自定义 CA 配置和 Provider 凭据一并只经 stdin 注入。
- ContextProjection 生成稳定哈希并记录 Artifact 去重；Provider usage 进入追加式 TokenLedger，以重复率和缓存命中做回归，不设置正常科研任务的固定 token 限额。
- Linux/Windows/macOS CI、禁网 Runner smoke、SPDX 2.3 SBOM 和许可证门禁已加入；Windows Doctor 增加 Windows 11、内存、虚拟化、WSL2、Linux 容器、端口、磁盘和网络配置检查。
- 已完成一次用户确认后的 NOAA ERDDAP 真实极小切片：`analysed_sst`、1×2×2，Artifact 7,228 bytes，SHA-256 `1bf83151bd0cc5eaf3dc8180d54971f428e8e28f7b9816af5f46b3d7a9e5d828`；禁网只读 xarray 复核数值有效。
- 已完成真实取消与恢复：94,165,066 bytes 计划启动后应用级取消返回 HTTP 499，持久化状态为 `cancelled` 且无 Artifact；服务重启后成功任务和取消任务均恢复正确。
- live 验证发现并修复非 root 请求文件权限、无效统一深度约束、重复 NcML 请求和 429 退避问题。ERDDAP 下载现直接复用官方 griddap REST 协议，由 Runner 构造维度化 URL 并流式写入。

## 当前限制

- Gate 3 API 仅作为兼容层维护；新功能统一使用项目级 `ProjectWorkflowService`。
- Server 已按领域注册路由、Knowledge 已建立窄 ports、Canvas 已加入 revision 与原子更新；跨 SQLite/Canvas 的 settlement 依赖幂等恢复，不承诺分布式事务。

- 文献图保留 fixture 作为离线默认与测试基线；公网 provider 已接入，但发布前仍需在受控网络环境做配额、代理和长时间稳定性验证。
- 正式 Runner 通过 `XILING_CONNECTOR_MODE=live` 显式启用；当前本机 UI 为安全起见仍可保持 fixture，避免配置凭据后自动访问公网。
- 项目与 Wiki 当前为个人研究者范围；团队权限、评论和通知不在首版边界。
- Node 22 `node:sqlite` 与 Drizzle Node SQLite 适配仍带实验/RC 标记，发布候选前需升级稳定版或完成冻结版本审计。
- 真实模型路由已经具备启用边界，但尚未使用用户密钥做首次公网端到端调用；当前数据仍保持离线模式。

## 下一检查点

ERDDAP 极小切片与取消/恢复已验证。Copernicus/NASA 在相应凭据可用时验证；Windows 11 + WSL2 完整测试必须在真实专机完成。
