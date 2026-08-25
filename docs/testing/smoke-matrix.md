# 自研模块冒烟测试门禁

## 统一约定

- 主入口：`pnpm smoke`。
- Windows 入口：`./scripts/smoke.ps1`。
- Python 子集：`pytest -m smoke`。
- 默认离线、固定 fixture、单项原则上不超过 60 秒。
- 每项覆盖启动、最短成功路径、关键失败路径和资源清理。
- 自研能力没有 smoke 测试不得合并。

## Gate 2 起必须存在的测试

| 模块 | 成功路径 | 失败/清理路径 |
|---|---|---|
| Pi Runtime / Harness | 多轮流式消息、连续工具调用、累计 usage、compaction 后继续 | 工具错误、循环上限、客户端脱离/重连、取消、服务重启恢复 |
| Pi Upgrade Boundary | core/ai 锁步、公共适配类型、Session/Skill/Compaction fixture | 版本漂移、应用绕过适配包、私有 dist import 被阻止 |
| Pi Package Importer | 固定本地 Skill/Prompt 包完成审计、确认、原子发布和懒加载 | lifecycle script、未固定 git、代码扩展、路径越界和回滚失败被阻止 |
| Context Broker | 正确投影活动分支、显式引用和有效胶囊，只激活命中能力；科研事实不因压缩丢失 | 窗口不足时按语义层级降级并解释，无关能力不进入上下文 |
| Canvas Patch | 预览后确认并原子写入 | 拒绝不落盘，撤销恢复 |
| Project/Wiki | CRUD、版本和重启恢复 | 冲突更新返回明确错误 |
| Literature Graph | fixture 生成引用/共被引分数 | 缺失论文和重复 DOI 可降级 |
| Connector | 元数据→计划→模拟下载 | 超时取消且无半成品 |
| Runner | xarray fixture→PNG/CSV/manifest | 中断内核并回收容器 |
| Provenance | RO-Crate 写入再读取 | 哈希不符进入 quarantined |
| Approval | 批准后仅开放声明资源 | 未批准/过期操作被拒绝 |
| Token Ledger | 记录多组成 token 与费用 | 未知模型保留原始 usage |
| Windows Doctor | WSL/Docker/端口检查通过 | 缺失组件给出无副作用建议 |
| Windows Path Bridge | 中文、空格、C/D 盘导入 | UNC、非法名、越界被阻止 |
| Import/Export | NTFS→WSL→Artifact→NTFS | 空间不足不留下有效记录 |
| Stop/Recovery | 优雅停止并再次启动 | Runner 卡死后超时升级 |
| Encoding | UTF-8/LF 跨平台一致 | 非法编码返回定位信息 |

Gate 4.5 说明：4.5-B 已完成中枢垂直切片；4.5-C 已完成增量 Compaction、正式 Chat/Canvas 切换、`sourceEntryId` 全文覆盖判定、压缩历史按需回读、旧数据逐条幂等迁移、会话归档边界和不可变双数据库备份。4.5-D 已删除旧 Chat 写 API 与 Web retained 真相源，并增加 durable-first Workflow 投影、稳定幂等键、启动 reconcile、项目作用域和 Harness 关闭等待。`scripts/gate-4.5-b-agent-center-smoke.mjs`、`scripts/gate-4.5-c-migration-smoke.mjs` 与 `scripts/gate-4.5-d-main-path-smoke.mjs` 验证中枢、迁移和主路径。`scripts/mcp-adapter-smoke.mjs` 使用固定离线 stdio fixture 验证独立 Pi MCP Host、宿主元数据命中、惰性目录和真实工具调用。Gate 5 前仍需真实 Windows 11 + WSL2 专机验收。

## CI 矩阵

- Linux：单元、集成、smoke、E2E、许可证、SBOM。
- Windows hosted runner：TypeScript、PowerShell、路径、编码、SQLite 和打包。
- macOS：核心、路径、启动和浏览器 smoke。
- Windows 自托管 runner：真实 WSL2 + Docker 完整闭环，覆盖中文用户名、OneDrive、重启、代理、无 GPU/GPU。

## 首个科学金标准

固定生成一个小型 CF-compliant SST NetCDF：12 个时间点、规则经纬网、已知异常值和缺测值。验证：

- 时间、经纬度和单位识别。
- 指定区域和时间切片。
- 气候态与异常计算。
- 缺测值不污染平均。
- CSV 数值在三平台容差内一致。
- 图像使用相同数据摘要；RO-Crate 中输入、代码、环境和输出哈希齐全。
