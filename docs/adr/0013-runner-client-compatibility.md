# ADR-0013：官方海洋客户端的 Runner 兼容边界

- 状态：Gate 4 已采用
- 日期：2026-08-23

## 背景

Runner 镜像实际安装检查发现：argopy 1.4.0 要求 xarray 2025.7–2025.9，Copernicus Marine 2.4.1 要求 NumPy 2.1 以上；此外 argopy 1.4.0 仍从 erddapy 的旧私有模块位置导入 `_quote_string_constraints`。直接降级 erddapy 3.2.0 会在模块导入时访问 GitHub 服务器目录，断网时抛出连接错误，不符合默认离线要求。

## 决策

- Runner 固定 xarray 2025.9.0、NumPy 2.1.3、erddapy 3.3.0、argopy 1.4.0、copernicusmarine 2.4.1、harmony-py 1.5.0。
- 在 `xiling_runner` 初始化时，把 erddapy 3.3.0 已迁移的同名函数映射回 argopy 1.4.0 期待的模块位置；argopy 本身仍只在选择 Argo 适配器时延迟导入。提前安装内存别名是因为 xarray 会自动扫描所有 backend entry point。
- 垫片不得修改第三方源码文件或访问网络，并由 `connector_smoke.py --network none` 覆盖。
- argopy 上游修复后删除垫片；替换边界是 `load_argopy_data_fetcher()`。

## 结果

基础服务和未命中的连接器不会加载四套科学客户端。镜像构建不以“pip 安装成功”为完成标准，必须额外通过禁网导入和最短 Artifact 冒烟。
