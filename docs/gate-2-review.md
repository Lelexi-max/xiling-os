# Gate 2 跨平台技术样例评审

状态：**已确认（2026-08-23）**。

> **2026-08-24 勘误**：本文件是 Gate 2 历史验收记录，不再作为当前 Agent 架构事实源。第 7 条所称“取消、恢复和稳定边界”只覆盖 Pi `Agent` 适配样例，并不代表已接入耐久 Pi Harness、自动 Compaction、Session Tree 或崩溃恢复。当前缺口与纠偏方案见 [Gate 4.5：Agent 中枢架构纠偏](gate-4.5-agent-center-correction.md)。

## 本次确认范围

1. Pi 0.84.2 通过适配层嵌入 Server，事件映射、流式 delta、取消、恢复和回合间动态工具均有稳定边界。
2. assistant-ui External Store Runtime 消费 Pi SSE，不在浏览器复制 Agent 状态机。
3. 科研画布使用 XYFlow 作为渲染基础，但交互语义是 Follow-up、Quote、自由节点和分支式上下文。
4. Context Broker 从活动祖先链、显式引用、有效胶囊和能力查询生成可解释投影；不使用统一 token 硬上限。
5. Python Runner 以非 root 用户运行，固定 NetCDF fixture 产出 CSV、PNG、哈希 manifest 和 RO-Crate。
6. Windows 样例诊断 WSL2、Docker、端口和磁盘，并提供经 `ShouldProcess` 确认的 NTFS → WSL 内容寻址快照；不会静默启用系统功能或修改现有发行版。

## 验证命令

```text
pnpm typecheck
pnpm test
pnpm --filter @xiling/web build
docker run --rm xiling-runner:gate2 python smoke.py
```

Jupyter Gateway 另需验证 `/api/kernelspecs` 返回 `python3`，并在测试后删除临时容器。

## Gate 2 已知边界

- 默认 Chat 使用 Pi 的离线 fixture stream，真实 BYOK provider 配置留到 Gate 3，以免把密钥管理混入技术样例。
- Windows 脚本已实现无副作用 Doctor 和受确认控制的启动入口，但真实 Windows 11 + WSL2 演示必须在 Windows 机器执行。
- Runner 当前覆盖固定 SST NetCDF；Argo fixture、地图和完整 Reviewer 属于 Gate 3。
- 项目、Wiki 和文献图在 Gate 2 只保留导航边界，不提前实现 Gate 4 功能。

## Gate 2 二次确认问题

- 是否认可 Chat 与 Canvas 共享同一 Pi Session/Context Projection 边界？
- 是否认可 Flowith 式 Follow-up/Quote 作为首版画布核心，批量分支默认关闭？
- 是否认可 Runner 仅接受已审批项目快照，并始终在 Linux 容器内执行？
