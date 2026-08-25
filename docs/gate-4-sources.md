# Gate 4 官方接口基线

核验日期：2026-08-23。连接器实现只常驻轻量描述，选中后才加载探针或客户端参数。

## 海洋数据

- ERDDAP：采用官方 `info` 元数据和 `griddap`/`tabledap` REST 约束表达式。子集 URL 必须在读取维度顺序后生成。[官方 griddap 文档](https://coastwatch.pfeg.noaa.gov/erddap/griddap/documentation.html)
- Argo：以两个官方 GDAC 的索引和 NetCDF 文件为权威入口，先筛选索引中的区域、时间、模式和 QC，再计算文件数与体积。[Argo GDAC 官方说明](https://argo.ucsd.edu/data/data-from-gdacs/)
- Copernicus Marine：只采用官方支持的 `copernicusmarine` Toolbox；`describe` 获取目录元数据，`subset` 输出 NetCDF/Zarr。凭据通过受控运行环境注入，不进入计划、日志或 Agent 上下文。[Toolbox CLI](https://toolbox-docs.marine.copernicus.eu/en/stable/command-line-interface.html)
- NASA Harmony：优先 Harmony-Py；协议层兼容 OGC API EDR。先读取 collection capabilities，再决定变量、bbox、时间、垂向和格式是否可用；下载作为可取消 job 管理。[Harmony 官方文档](https://harmony.earthdata.nasa.gov/docs)

## Gate 4 Runner 固定版本

- erddapy 3.3.0：使用 griddap 服务器端切片和下载 URL，不下载完整数据集后再裁剪。[erddapy Griddap](https://ioos.github.io/erddapy/01a-griddap-output.html)
- argopy 1.4.0：`DataFetcher.region` 的 box 顺序固定为经度、纬度、压力和可选时间；生产默认 GDAC 源且小请求不启用并行。[argopy region](https://argopy.readthedocs.io/en/latest/generated/argopy.fetchers.ArgoDataFetcher.region.html)
- copernicusmarine 2.4.1：调用 `subset`，下载前必须使用 dry-run/describe 形成体积预览。[Copernicus subset](https://toolbox-docs.marine.copernicus.eu/en/stable/usage/subset-usage.html)
- harmony-py 1.5.0：Harmony 按异步 job 提交、等待和下载；Earthdata token 或账户只注入单次任务。[Harmony-Py API](https://harmony-py.readthedocs.io/en/stable/api.html)

## 文献图

- Semantic Scholar 为主：Academic Graph 提供论文、引用与参考文献；Recommendations API 接收正负种子。只请求图算法需要的字段，并缓存按 paper ID 寻址的响应。[官方 API](https://www.semanticscholar.org/product/api)
- OpenAlex 为降级：使用 `/works?search=`、`per_page` 和 `select` 限制字段，并按当前 API 预算机制支持可选 Key。[官方 API Reference](https://help.openalex.org/api/)、[Works 搜索](https://developers.openalex.org/api-reference/works/list-works)

## 安全与上下文规则

- Metadata probe 是只读网络动作；下载仍需展示变量、范围、深度、时间、预计体积和目标 URI 后审批。
- 缺少远端元数据时状态必须为 `metadata_required`，不得伪造体积或开放下载。
- 账号连接器状态为 `credentials_required`；用户名、密码、token、cookie 不进入 `ConnectorPreflight`。
- 远端响应写入缓存 Artifact，只把字段投影、短摘要和内容哈希交给 Agent。
