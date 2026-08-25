# Gate 5：Beta 发布候选门禁

## 状态

Gate 5 已进入执行阶段，当前版本为 `0.1.0-beta.1`。本文件区分“已由自动化验证”和“必须在真实发布环境验证”，不以文档声明替代实际结果。

## 本次候选已完成

- 独立项目仓库边界；不复用上级 Desktop 仓库，不上传桌面其他文件。
- `.gitignore` 排除凭据、主密钥、SQLite/WAL、项目数据、日志、缓存、构建产物、依赖目录和平台杂项。
- GitHub Actions 覆盖 Ubuntu、Windows hosted runner 与 macOS 的安装、类型检查、测试、Web 构建和平台 smoke。
- Linux CI 生成 SPDX 2.3 SBOM，并运行许可证与依赖完整性检查。
- `THIRD_PARTY_NOTICES.md`、开源评估矩阵、ADR、活设计文档和 smoke 矩阵纳入仓库。
- Gate 4.5 Agent 中枢、Pi 兼容门禁、惰性 Skill/MCP、原生图像输入、项目作用域与迁移备份具有离线回归测试。
- 本地发布前门禁通过：完整构建、115 项全量测试、smoke、设计文档检查与浏览器验收。

## GitHub 上传后的确认条件

1. 三平台 hosted CI 全部通过。
2. 仓库 secret scanning/人工敏感信息审查无发现。
3. 默认分支只包含项目文件；不存在 `data/`、凭据、SQLite、日志、缓存或本机绝对路径资产。
4. 发布提交和生成的 SBOM 可追溯到同一 commit SHA。

## 正式 Beta 阻塞项

- 在真实 Windows 11 x86_64 + WSL2 + Docker Desktop 专机完成全新安装、中文用户名、C/D 盘、OneDrive、重启、代理、低磁盘与取消恢复矩阵。普通 GitHub Windows runner 不替代 WSL2 嵌套虚拟化验收。
- `scripts/windows/install.ps1` 当前仍是安全原型；需提供签名 XiLingOS rootfs、实际导入流程、卸载与升级回滚，再发布 WinGet manifest。
- 生成并签名 macOS/Linux 安装介质；验证安装、升级、卸载和数据保留策略。
- 完成面向用户的项目备份/恢复命令与恢复演练。当前迁移前 SQLite 备份不能冒充完整用户备份产品。
- 在 macOS、Linux、Windows 各完成一个真实物理海洋科研项目试用，并记录缺陷、性能和复现结果。
- 用户审查上述真实环境结果后，方可把候选标记为正式 Beta。

## 发布判定

本次 GitHub 上传完成的是 Gate 5 的“源码发布候选与持续集成”阶段。只有阻塞项关闭并经用户再次确认，才能创建非草稿、非预发布的正式 Beta Release。
