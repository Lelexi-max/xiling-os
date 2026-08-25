import { useEffect, useMemo, useState } from "react";
import type { CredentialProviderId, CredentialProviderStatus, InstalledSkillSummary, InstalledSkillsResponse, McpSettingsResponse, ModelCatalogEntry, ModelProviderId, ModelRuntimeStatus, ProviderConnectionTestResult } from "@xiling/contracts";
import { ApiError, apiJson, jsonInit } from "../lib/api-client.js";
import { McpSettingsPanel } from "./McpSettingsPanel.js";

type SettingsSection = "overview" | "model" | "skills" | "mcp" | "model-apis" | "literature" | "data" | "security";
type ProviderCategory = CredentialProviderStatus["category"];

const sections: Array<{ label: string; items: Array<{ id: SettingsSection; label: string; icon: string }> }> = [
  { label: "常规", items: [{ id: "overview", label: "设置概览", icon: "⌂" }] },
  { label: "智能体", items: [{ id: "model", label: "模型与推理", icon: "◈" }, { id: "skills", label: "Skills", icon: "✦" }, { id: "mcp", label: "MCP", icon: "⌘" }] },
  { label: "服务连接", items: [{ id: "model-apis", label: "模型 API", icon: "⌁" }, { id: "literature", label: "文献服务", icon: "⌕" }, { id: "data", label: "海洋数据账户", icon: "≈" }] },
  { label: "系统", items: [{ id: "security", label: "安全与运行", icon: "◇" }] },
];

const sectionCopy: Record<SettingsSection, { eyebrow: string; title: string; description: string }> = {
  overview: { eyebrow: "SETTINGS", title: "设置概览", description: "集中查看智能体、服务连接和本地安全状态。" },
  model: { eyebrow: "AGENT · MODEL ROUTER", title: "模型与推理", description: "选择 Chat 默认模型；模型 ID 可自由输入，原生模态按具体模型声明。" },
  skills: { eyebrow: "AGENT · LAZY CAPABILITIES", title: "已安装 Skills", description: "查看宿主目录中已注册的研究能力，以及它们何时加载、关联哪些工具。" },
  mcp: { eyebrow: "AGENT · MCP GATEWAY", title: "MCP 连接", description: "配置独立 MCP Host；服务器和工具 schema 按任务命中后惰性发现，不常驻 Agent 上下文。" },
  "model-apis": { eyebrow: "CONNECTIONS · MODEL", title: "模型 API", description: "管理模型提供商和自定义兼容 API；保存后可执行最短文字连通测试。" },
  literature: { eyebrow: "CONNECTIONS · LITERATURE", title: "文献服务", description: "配置文献图的主数据源与降级数据源。" },
  data: { eyebrow: "CONNECTIONS · OCEAN DATA", title: "海洋数据账户", description: "配置正式数据下载所需账户；凭据只注入已批准的单次运行。" },
  security: { eyebrow: "SYSTEM · LOCAL FIRST", title: "安全与运行", description: "查看加密、凭据隔离、当前模型路由和上下文加载边界。" },
};

const skillPresentation: Record<string, { title: string; glyph: string }> = {
  "artifact-inspection": { title: "科研产物检查", glyph: "图" },
  "literature-evidence": { title: "文献证据", glyph: "文" },
  "project-wiki-navigation": { title: "项目 Wiki 导航", glyph: "知" },
  "ocean-data-subsetting": { title: "海洋数据切片", glyph: "数" },
};

export function SettingsView() {
  const [section, setSection] = useState<SettingsSection>("overview");
  const [providers, setProviders] = useState<CredentialProviderStatus[]>([]);
  const [values, setValues] = useState<Partial<Record<CredentialProviderId, Record<string, string>>>>({});
  const [busy, setBusy] = useState<CredentialProviderId>();
  const [message, setMessage] = useState("");
  const [confirmClear, setConfirmClear] = useState<CredentialProviderId>();
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [runtime, setRuntime] = useState<ModelRuntimeStatus>();
  const [modelProvider, setModelProvider] = useState<ModelProviderId>();
  const [modelId, setModelId] = useState("");
  const [reasoning, setReasoning] = useState<ModelRuntimeStatus["reasoning"]>("medium");
  const [modelImageInput, setModelImageInput] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);
  const [testResults, setTestResults] = useState<Partial<Record<CredentialProviderId, ProviderConnectionTestResult>>>({});
  const [skills, setSkills] = useState<InstalledSkillsResponse>();
  const [mcp, setMcp] = useState<McpSettingsResponse>();
  const [skillQuery, setSkillQuery] = useState("");

  const refresh = async () => {
    try {
      const [nextProviders, models, nextSkills, nextMcp] = await Promise.all([
        apiJson<CredentialProviderStatus[]>("/api/settings/providers"),
        apiJson<{ catalog: ModelCatalogEntry[]; runtime: ModelRuntimeStatus }>("/api/settings/models"),
        apiJson<InstalledSkillsResponse>("/api/settings/skills"),
        apiJson<McpSettingsResponse>("/api/settings/mcp"),
      ]);
      setProviders(nextProviders); setCatalog(models.catalog); setRuntime(models.runtime); setReasoning(models.runtime.reasoning); setSkills(nextSkills); setMcp(nextMcp);
      if (models.runtime.providerId && models.runtime.modelId) { setModelProvider(models.runtime.providerId); setModelId(models.runtime.modelId); setModelImageInput(Boolean(models.runtime.selectedModel?.inputModalities.includes("image"))); }
    } catch (error) { setMessage(error instanceof Error ? `设置加载失败：${error.message}` : "设置加载失败。"); }
  };
  useEffect(() => { void refresh(); }, []);

  const save = async (provider: CredentialProviderStatus) => {
    const providerValues = values[provider.id] ?? {};
    if (Object.values(providerValues).every((value) => !value)) { setMessage("请至少填写一项凭据。"); return; }
    setBusy(provider.id); setMessage("");
    try {
      await apiJson(`/api/settings/providers/${provider.id}`, jsonInit("PUT", { values: providerValues }));
      setValues((current) => ({ ...current, [provider.id]: {} })); setMessage(`${provider.title} 已安全保存；密钥值不会再次显示。`); await refresh();
    } catch (error) { setMessage(`保存失败：${error instanceof ApiError ? "请检查必填字段" : error instanceof Error ? error.message : "未知错误"}`); }
    finally { setBusy(undefined); }
  };
  const clear = async (provider: CredentialProviderStatus) => {
    if (confirmClear !== provider.id) { setConfirmClear(provider.id); setMessage(`再次点击“确认清除”将删除 ${provider.title} 的本地凭据。`); return; }
    setBusy(provider.id);
    try { await apiJson(`/api/settings/providers/${provider.id}`, jsonInit("DELETE")); setMessage(`${provider.title} 本地凭据已清除。`); await refresh(); }
    catch { setMessage("清除失败。"); }
    finally { setBusy(undefined); setConfirmClear(undefined); }
  };
  const testConnection = async (provider: CredentialProviderStatus) => {
    setBusy(provider.id); setMessage(`${provider.title} 正在执行最短文字连通测试…`);
    const candidateModel = modelProvider === provider.id && modelId.trim() ? modelId.trim() : undefined;
    try {
      const body = await apiJson<ProviderConnectionTestResult>(`/api/settings/providers/${provider.id}/test`, jsonInit("POST", candidateModel ? { modelId: candidateModel } : {}));
      setTestResults((current) => ({ ...current, [provider.id]: body })); setMessage(`${provider.title} 连接成功，延迟 ${body.latencyMs} ms。`);
    } catch (error) {
      const body = error instanceof ApiError ? error.body as { message?: string } : undefined;
      setMessage(`${provider.title} 连接失败：${body?.message ?? "请检查密钥、Base URL 和模型 ID"}`);
    } finally { setBusy(undefined); }
  };
  const saveRuntime = async (mode: "offline" | "live") => {
    const normalizedModelId = modelId.trim();
    if (mode === "live") {
      if (!modelProvider || !normalizedModelId) { setMessage("请先选择提供商并输入模型名称或模型 ID。"); return; }
      if (!providers.find((provider) => provider.id === modelProvider)?.configured) { setMessage("请先保存所选模型提供商的 API Key。"); return; }
      if (!confirmLive) { setConfirmLive(true); setMessage("真实模型调用可能产生费用。再次点击“确认启用真实调用”后才会切换。"); return; }
    }
    try {
      const storedInputModalities = runtime && runtime.providerId === modelProvider && runtime.modelId === normalizedModelId ? runtime.inputModalities ?? ["text"] : ["text"];
      const requestedInputModalities = mode === "live" ? ["text", ...(modelImageInput ? ["image" as const] : [])] : storedInputModalities;
      const nextRuntime = await apiJson<ModelRuntimeStatus>("/api/settings/models", jsonInit("PUT", { mode, reasoning, ...(modelProvider && normalizedModelId ? { providerId: modelProvider, modelId: normalizedModelId, inputModalities: requestedInputModalities } : {}) }));
      setRuntime(nextRuntime); setModelImageInput(Boolean(nextRuntime.selectedModel?.inputModalities.includes("image"))); setMessage(mode === "live" ? modelImageInput && nextRuntime.capabilitySource === "native-probe" ? "原生图像探针通过，真实模型路由已启用。" : "真实模型路由已启用。" : "已切换为离线模式，不会产生模型费用。");
    } catch (error) { const body = error instanceof ApiError ? error.body as { error?: string } : undefined; setMessage(`模型运行设置保存失败：${body?.error ?? (error instanceof Error ? error.message : "未知错误")}`); }
    setConfirmLive(false);
  };

  const configuredCount = providers.filter((provider) => provider.configured).length;
  const modelProviders = providers.filter((provider) => provider.category === "model");
  const selectedDraft = catalog.find((model) => model.providerId === modelProvider && model.id === modelId);
  const activeModelCapabilities = selectedDraft ?? (runtime && runtime.providerId === modelProvider && runtime.modelId === modelId ? runtime.selectedModel : undefined);
  const imageCapabilityCanBeSelected = Boolean(modelProvider && modelId.trim() && (!selectedDraft || selectedDraft.inputModalities.includes("image")));
  const hasPersistedNativeProbe = Boolean(runtime && runtime.providerId === modelProvider && runtime.modelId === modelId && runtime.capabilitySource === "native-probe" && modelImageInput);
  const capabilityState = selectedDraft ? "PI CATALOG" : hasPersistedNativeProbe ? "NATIVE PROBE" : modelImageInput ? "PROBE ON SAVE" : activeModelCapabilities ? "TEXT ONLY" : "WAITING FOR MODEL";
  const visibleSkills = useMemo(() => {
    const query = skillQuery.trim().toLocaleLowerCase();
    if (!query) return skills?.skills ?? [];
    return (skills?.skills ?? []).filter((skill) => [skill.name, skill.description, ...skill.keywords, ...skill.capabilities.flatMap((item) => [item.id, item.description, item.toolName])].some((item) => item.toLocaleLowerCase().includes(query)));
  }, [skillQuery, skills]);

  const renderProviderCategory = (category: ProviderCategory) => {
    const items = providers.filter((provider) => provider.category === category);
    const targetSection: SettingsSection = category === "model" ? "model-apis" : category;
    return <section className="provider-section settings-provider-page"><header><div><small>{category.toUpperCase()}</small><h2>{sectionCopy[targetSection].title}</h2></div><span>{items.filter((provider) => provider.configured).length}/{items.length} 已配置</span></header><div className="provider-grid">{items.map((provider) => <article className={provider.configured ? "configured" : ""} key={provider.id}>
      <div className="provider-title"><div><i /><h3>{provider.title}</h3></div><span>{provider.configured ? provider.source === "environment" ? "环境变量" : "已加密保存" : "未配置"}</span></div>
      <p>{provider.description}</p>
      <div className="credential-fields">{provider.fields.map((item) => <label key={item.id}><span>{item.label}{provider.configuredFields.includes(item.id) ? <em> 已配置</em> : null}</span>{item.id === "apiStyle" ? <select aria-label={`${provider.title} ${item.label}`} value={values[provider.id]?.[item.id] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [provider.id]: { ...(current[provider.id] ?? {}), [item.id]: event.target.value } }))}><option value="">选择兼容协议</option><option value="openai-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option></select> : <input aria-label={`${provider.title} ${item.label}`} type={item.secret ? "password" : "text"} autoComplete="off" value={values[provider.id]?.[item.id] ?? ""} placeholder={provider.configuredFields.includes(item.id) ? item.secret ? "••••••••（留空则保持）" : "已保存（留空则保持）" : item.placeholder} onChange={(event) => setValues((current) => ({ ...current, [provider.id]: { ...(current[provider.id] ?? {}), [item.id]: event.target.value } }))} />}</label>)}</div>
      {testResults[provider.id] ? <div className={`connection-result ${testResults[provider.id]!.ok ? "ok" : "failed"}`}><b>{testResults[provider.id]!.ok ? "连接正常" : "连接失败"}</b><span>{testResults[provider.id]!.modelId} · {testResults[provider.id]!.latencyMs} ms</span></div> : null}
      <div className="provider-actions"><a href={provider.documentationUrl} target="_blank" rel="noreferrer">官方文档 ↗</a><div>{provider.category === "model" ? <button className="secondary" disabled={!provider.configured || busy === provider.id} onClick={() => void testConnection(provider)}>{busy === provider.id ? "测试中…" : "测试连接"}</button> : null}{provider.configured && provider.source !== "environment" ? <button className="clear" disabled={busy === provider.id} onClick={() => void clear(provider)}>{confirmClear === provider.id ? "确认清除" : "清除本地凭据"}</button> : null}<button disabled={busy === provider.id} onClick={() => void save(provider)}>{busy === provider.id ? "保存中…" : "保存"}</button></div></div>
    </article>)}</div></section>;
  };

  const renderModel = () => <section className="model-runtime-card settings-primary-card">
    <div className="model-runtime-title"><div><small>PI MODEL ROUTER</small><h2>默认模型</h2><p>完整模型目录留在宿主层；每次调用只携带当前选中的模型。</p></div><span className={`runtime-state ${runtime?.mode ?? "offline"}`}>{runtime?.mode === "live" ? runtime.ready ? "LIVE READY" : "LIVE BLOCKED" : "OFFLINE"}</span></div>
    <div className="model-runtime-fields">
      <label><span>提供商</span><select aria-label="默认模型提供商" value={modelProvider ?? ""} onChange={(event) => { const provider = event.target.value as ModelProviderId; setModelProvider(provider); setModelId(""); setModelImageInput(false); setConfirmLive(false); }}><option value="">选择提供商</option>{modelProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.title}</option>)}</select></label>
      <label className="model-id-field"><span>模型名称 / ID <em>可自由输入</em></span><input aria-label="默认模型" list="recommended-models" value={modelId} disabled={!modelProvider} placeholder={modelProvider ? "输入模型 ID" : "请先选择提供商"} autoComplete="off" onChange={(event) => { const nextId = event.target.value; const known = catalog.find((model) => model.providerId === modelProvider && model.id === nextId); setModelId(nextId); setModelImageInput(Boolean(known?.inputModalities.includes("image"))); setConfirmLive(false); }} /><datalist id="recommended-models">{catalog.filter((model) => model.providerId === modelProvider).map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</datalist></label>
      <label><span>推理强度</span><select aria-label="默认推理强度" value={reasoning} onChange={(event) => setReasoning(event.target.value as ModelRuntimeStatus["reasoning"])}><option value="off">关闭</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
    </div>
    <div className="model-native-capabilities"><div className="model-native-title"><div><b>当前模型可用的原生模态</b><small>取具体模型能力与 Pi 传输能力的交集，不从厂商名称或模型名称猜测</small></div><span>{capabilityState}</span></div>{modelProvider && modelId.trim() ? <><div className="model-native-rows"><div><span>输入</span><b>文字</b><label className={`model-modality-toggle ${modelImageInput ? "active" : ""}`}><input type="checkbox" checked={modelImageInput} disabled={!imageCapabilityCanBeSelected} onChange={(event) => { setModelImageInput(event.target.checked); setConfirmLive(false); }} />图像</label><b className="unavailable" title="Pi 当前没有原生音频内容块">音频 · 暂不可用</b><b className="unavailable" title="Pi 当前没有原生视频内容块">视频 · 暂不可用</b></div><div><span>输出</span><b>文字</b><b className="unavailable">图像 · 暂不可用</b></div></div><p>{selectedDraft ? "能力来自 Pi 模型目录；目录明确不支持的模态不能手动开启。" : modelImageInput ? "这是目录外模型。确认启用时，服务端会发送一张 1×1 PNG 原生探针；只有模型真实接受后才保存图像能力。" : "目录外模型默认仅文字。可显式选择图像，并通过一次原生内容块探针验证；不会依据 vision 等名称猜测。"} 音频与视频不会被转写或抽帧。</p></> : <p>选择或输入具体模型后配置；未知能力默认关闭。</p>}</div>
    <div className="model-runtime-meta"><span>{selectedDraft ? `${selectedDraft.contextWindow.toLocaleString()} context · ${selectedDraft.reasoning ? "支持推理" : "标准模型"}` : modelId.trim() ? `自定义模型：${modelId.trim()} · 能力与费用以提供商为准` : "可从建议中选择，也可直接输入任意模型 ID"}</span><div><button className="secondary" onClick={() => void saveRuntime("offline")}>使用离线模式</button><button disabled={!modelProvider || !modelId.trim()} onClick={() => void saveRuntime("live")}>{confirmLive ? "确认启用真实调用" : "启用真实调用"}</button></div></div>
  </section>;

  const renderSkills = () => <section className="skills-settings">
    <div className="skills-policy"><div><span>✦</span><div><b>按需加载已启用</b><p>系统提示只保留 Skill 索引。任务命中关键词或 Capability 后才读取正文，并按版本缓存。</p></div></div><dl><div><dt>{skills?.skills.length ?? "—"}</dt><dd>已安装</dd></div><div><dt>0</dt><dd>常驻正文</dd></div><div><dt>{new Set((skills?.skills ?? []).flatMap((skill) => skill.capabilities.map((item) => item.id))).size}</dt><dd>关联能力</dd></div></dl></div>
    <div className="skills-toolbar"><label><span>⌕</span><input aria-label="搜索已安装 Skills" value={skillQuery} placeholder="搜索名称、触发词、能力或工具…" onChange={(event) => setSkillQuery(event.target.value)} /></label><button className="secondary" onClick={() => void refresh()}>刷新目录</button></div>
    <div className="skills-grid">{visibleSkills.map((skill: InstalledSkillSummary) => {
      const presentation = skillPresentation[skill.name] ?? { title: skill.name, glyph: "技" };
      return <article className="skill-card" key={skill.name}><header><span className="skill-glyph">{presentation.glyph}</span><div><h3>{presentation.title}</h3><code>{skill.name}</code></div><b>v{skill.version}</b></header><p>{skill.description}</p><section><small>关联能力</small><div>{skill.capabilities.map((capability) => <span className="skill-capability" key={capability.id} title={capability.description}><b>{capability.id}</b><em>{capability.toolName}</em></span>)}</div></section><section><small>匹配词</small><div className="skill-keywords">{skill.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}</div></section><footer><i />已安装 · 命中后读取正文</footer></article>;
    })}</div>
    {visibleSkills.length === 0 ? <div className="skills-empty">没有匹配的 Skill。清除搜索词可查看全部已安装能力。</div> : null}
    <p className="skills-footnote">Skill 的安装和版本目前由仓库 skills/catalog.json 管理；此页面不读取或展示 SKILL.md 正文，避免仅因打开设置就污染 Agent 上下文。</p>
  </section>;

  const renderOverview = () => <div className="settings-overview">
    <section className="settings-health-strip"><div><i className={runtime?.mode === "live" && runtime.ready ? "ok" : ""} /><span><b>{runtime?.mode === "live" ? runtime.ready ? "智能体可用" : "模型路由待处理" : "离线模式"}</b><small>{runtime?.mode === "live" ? runtime.selectedModel?.name ?? runtime.modelId : "不会产生模型费用"}</small></span></div><div><i className="ok" /><span><b>本地安全边界</b><small>凭据值不会回传浏览器</small></span></div></section>
    <div className="settings-overview-grid">
      <button onClick={() => setSection("model")}><span>◈</span><div><small>智能体</small><h3>模型与推理</h3><p>{runtime?.mode === "live" ? `当前使用 ${runtime.selectedModel?.name ?? runtime.modelId}` : "当前使用离线 Pi 流"}</p></div><b>›</b></button>
      <button onClick={() => setSection("skills")}><span>✦</span><div><small>智能体</small><h3>{skills?.skills.length ?? 0} 个 Skills</h3><p>元数据常驻，正文按任务命中加载</p></div><b>›</b></button>
      <button onClick={() => setSection("mcp")}><span>⌘</span><div><small>智能体</small><h3>{mcp?.servers.length ?? 0} 个 MCP 服务器</h3><p>单代理 schema · 惰性连接 · 独立进程</p></div><b>›</b></button>
      <button onClick={() => setSection("model-apis")}><span>⌁</span><div><small>服务连接</small><h3>{configuredCount}/{providers.length} 已配置</h3><p>模型、文献与数据服务相互隔离</p></div><b>›</b></button>
      <button onClick={() => setSection("security")}><span>◇</span><div><small>系统</small><h3>凭据与执行安全</h3><p>AES-256-GCM · 本地用户权限 · 容器执行</p></div><b>›</b></button>
    </div>
    <section className="security-notice"><b>配置原则</b><p>设置只决定宿主如何连接能力，不会把所有模型、Skill 或服务说明注入 Agent。每轮任务仍由 Capability Catalog 选择最小相关集合。</p></section>
  </div>;

  const renderSecurity = () => <div className="settings-security-page"><section className="security-notice"><b>本地凭据</b><p>凭据使用 AES-256-GCM 加密，主密钥与密文分离并限制为当前用户读取。环境变量优先；浏览器只能读取“是否配置”。</p></section><section className="security-list"><div><span>模型路由</span><b>{runtime?.mode === "live" ? runtime.ready ? "真实调用已就绪" : "真实调用被阻止" : "离线模式"}</b><p>{runtime?.mode === "live" ? runtime.selectedModel?.name ?? runtime.modelId : "Chat 不访问模型提供商"}</p></div><div><span>Skill 上下文</span><b>按需加载</b><p>{skills?.skills.length ?? 0} 个已安装，0 个正文常驻</p></div><div><span>服务凭据</span><b>{configuredCount}/{providers.length} 已配置</b><p>只注入命中的 Provider 或已批准 Runner</p></div><div><span>科研执行</span><b>隔离容器</b><p>下载、计算与外部写入必须先审批</p></div></section><section className="runtime-boundary"><b>运行时状态</b><span>{runtime?.mode === "live" ? runtime.ready ? `Chat 将使用 ${runtime.selectedModel?.name ?? runtime.modelId}；发送消息可能产生费用。` : "真实模式已选择，但凭据或模型不可用，服务端会拒绝调用。" : "当前 Chat 使用离线 Pi 流，不会访问模型服务。"}</span></section></div>;

  const copy = sectionCopy[section];
  return <div className="settings-view settings-shell">
    <aside className="settings-local-nav"><div><small>SETTINGS</small><strong>汐灵设置</strong></div>{sections.map((group) => <section key={group.label}><span>{group.label}</span>{group.items.map((item) => <button className={section === item.id ? "active" : ""} key={item.id} onClick={() => { setSection(item.id); setMessage(""); }}><i>{item.icon}</i>{item.label}</button>)}</section>)}</aside>
    <main className="settings-content"><header className="settings-head"><div><small>{copy.eyebrow}</small><h1>{copy.title}</h1><p>{copy.description}</p></div>{section === "overview" ? <span>{configuredCount}/{providers.length} 已配置</span> : section === "skills" ? <span>{skills?.skills.length ?? 0} 已安装</span> : null}</header>{message ? <div className="settings-message" role="status">{message}</div> : null}
      {section === "overview" ? renderOverview() : section === "model" ? renderModel() : section === "skills" ? renderSkills() : section === "mcp" ? <McpSettingsPanel value={mcp} onChanged={setMcp} onMessage={setMessage} /> : section === "model-apis" ? renderProviderCategory("model") : section === "literature" ? renderProviderCategory("literature") : section === "data" ? renderProviderCategory("data") : renderSecurity()}
    </main>
  </div>;
}
