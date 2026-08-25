# ADR 0006：Gate 3 科研编排与执行边界

状态：已采用（等待 Gate 3 用户确认）

## 决策

项目状态、审批、运行、Reviewer、画布链接和 Wiki 版本由 TypeScript 编排层持久化；NetCDF 读取、QC、数值计算、绘图和 RO-Crate 生成全部进入固定镜像的 Linux Runner。Runner 默认断网，只挂载单次运行目录，并由应用级取消信号和 60 秒超时控制。

固定样例由 Runner 确定性生成，明确标记为 synthetic fixture，不得作为真实海洋学结论。它用于验证协议、权限、数值路径、产物和溯源是否连通。

## Token / 上下文后果

- Agent 不接收原始 NetCDF、PNG、完整 CSV、RO-Crate 或容器日志。
- 常驻项目上下文仅保存研究问题、计划哈希、状态、Reviewer 短检查和 Artifact URI。
- 需要查看产物时再按 URI 定位和局部读取；画布与 Wiki 引用同一对象，不复制内容。
- 工具能力由当前阶段解析，科研 Runner 不作为全程常驻工具 schema。

## 替换边界

`ResearchRunner.execute(plan, signal)` 是稳定边界。Docker Desktop、Podman、远程 Slurm 或云任务可替换执行器，不改变审批与项目状态机。
