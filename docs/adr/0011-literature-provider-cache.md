# ADR-0011：文献 Provider、缓存、退避与降级

- 状态：Gate 4 已采用
- 日期：2026-08-23

## 决策

Semantic Scholar Academic Graph 是主检索源，OpenAlex Works 是降级源。两个远端响应都先投影为统一 `PaperRecord`；前端、证据库、画布和 Agent 不读取 provider 原始结构。

交互搜索只请求标题、年份、作者、被引数、参考文献 ID 和 URL，单次限制 5–40 条。Semantic Scholar Key 使用 `x-api-key` 请求头，OpenAlex Key 使用 `api_key` 参数；两者都由凭据仓在单次请求时读取。

## 缓存与失败策略

- 查询经 trim、小写和 limit 生成 SHA-256 key。
- 只缓存投影后的论文记录、来源、获取时间和内容哈希，默认 TTL 24 小时。
- 相同查询的并发请求合并为一次 provider 调用。
- 429、5xx 和网络错误最多尝试三次；遵循 `Retry-After`，但等待不超过 5 秒。
- 主源重试耗尽后才调用 OpenAlex，并公开 `degradedFrom` 和总尝试次数。
- 两个 provider 都失败时可返回过期缓存，并明确标记 `cache: stale`；无缓存则返回 503。

## Token 经济性

Provider 原始 JSON、摘要正文和完整引用列表不会自动进入模型。文献搜索和图构建在宿主层完成；模型只在用户引用论文节点时读取结构化节点和必要证据。

## 冒烟测试

固定响应验证字段投影、密钥位置、退避上限、降级、缓存命中、过期缓存和并发合并。测试默认离线，不消耗远端配额。
