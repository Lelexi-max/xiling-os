# ADR-0009：本地加密凭据与可视化设置

- 状态：Gate 4 已采用
- 日期：2026-08-23

## 背景

Pi 模型提供商、Semantic Scholar、Copernicus Marine 和 NASA Earthdata 需要不同形式的 API Key、用户名、密码或 Bearer Token。凭据不得进入项目 SQLite、Wiki、日志、Agent 上下文、Token Ledger 或浏览器可读状态。

## 决策

- 设置页只读取 `configured`、`source` 和已配置字段名，不提供读取明文的 API。
- 本地凭据使用 AES-256-GCM 加密；随机 256 位主密钥与密文分文件保存，目录权限 0700、文件权限 0600，并原子替换密文。
- 环境变量优先于本地密文，兼容 Pi 的 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`GEMINI_API_KEY`、`OPENROUTER_API_KEY`，以及 Copernicus 官方变量。
- NASA 支持 EDL Bearer Token，或用户名与密码组合；Runner 后续按任务临时注入，不写入命令行参数。
- 设置页清除操作采用二次点击确认；环境变量来源不能从 Web 清除。
- 凭据目录不进入项目备份、Artifact、Git 或模型上下文。

## 替换边界

`CredentialStore` 以及 `/api/settings/providers` 构成稳定边界。未来可在 macOS Keychain、Windows Credential Manager 或企业 Vault 可用时替换密钥来源，保持 Web 与连接器接口不变。

## 冒烟验证

- 密钥密文中不出现 fixture 明文。
- API 状态序列化中不出现凭据值。
- 重启后可解密，清除后本地值不可恢复。
- 环境变量覆盖本地值但不被复制到密文。
- 非 Windows 文件权限为 0600；Windows 正式后端在 WSL ext4 中验证相同权限。
