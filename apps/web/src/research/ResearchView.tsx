import { useCallback, useEffect, useState } from "react";
import type { ConfiguredConnectorDescriptor, ConnectorDownloadJob, ConnectorMetadataSummary, ConnectorPreflight, Gate3ProjectSnapshot, OceanConnectorId, OceanSubsetRequest } from "@xiling/contracts";

type Mode = "project" | "wiki";

async function requestSnapshot(url: string, method = "GET"): Promise<Gate3ProjectSnapshot> {
  const response = await fetch(url, { method });
  const body = await response.json() as Gate3ProjectSnapshot | { error: string };
  if (!response.ok) throw new Error("error" in body ? body.error : `HTTP ${response.status}`);
  return body as Gate3ProjectSnapshot;
}

export function ResearchView({ mode, projectId }: { mode: Mode; projectId?: string }) {
  const [snapshot, setSnapshot] = useState<Gate3ProjectSnapshot>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await requestSnapshot("/api/gate3/snapshot"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const mutate = async (label: string, url: string) => {
    setBusy(label);
    setError(undefined);
    try {
      setSnapshot(await requestSnapshot(url, "POST"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(undefined);
    }
  };

  const cancel = async () => {
    try {
      const response = await fetch("/api/gate3/run/cancel", { method: "POST" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  if (!snapshot) return <div className="view-loading">加载 Gate 3 项目快照…</div>;
  if (mode === "wiki") return <WikiPanel snapshot={snapshot} />;

  const approval = snapshot.approval;
  return (
    <div className="project-view">
      <section className="project-hero">
        <div>
          <small>GATE 3 · PHYSICAL OCEANOGRAPHY</small>
          <h1>{snapshot.researchQuestion}</h1>
          <p>{projectId && projectId !== snapshot.projectId ? "当前 Gate 3 Runner 仍绑定基准项目；切换项目不会复用其运行结果。" : "固定 Argo/NetCDF 样例 · 明确审批 · 可复现容器分析 · 自动 Reviewer"}</p>
        </div>
        <span className={`status-badge ${snapshot.run?.status ?? approval?.status ?? "idle"}`}>
          {snapshot.run?.status ?? approval?.status ?? "尚未规划"}
        </span>
      </section>

      <section className="research-actions" aria-label="Gate 3 workflow">
        <WorkflowStep index="01" title="检查与规划" detail="只读取元数据，生成区域、深度、时间和变量切片计划。" active={!snapshot.plan} done={Boolean(snapshot.plan)} />
        <WorkflowStep index="02" title="人工审批" detail="批准计划哈希和声明的输入、输出资源。" active={approval?.status === "pending"} done={approval?.status === "approved"} />
        <WorkflowStep index="03" title="容器分析" detail="QC → MLD/热含量 → 图件 → RO-Crate → Reviewer。" active={approval?.status === "approved" && !snapshot.run} done={snapshot.run?.status === "succeeded"} />
      </section>

      <div className="workflow-buttons">
        <button disabled={Boolean(busy)} onClick={() => void mutate("plan", "/api/gate3/plan")}>生成 / 重置计划</button>
        <button disabled={Boolean(busy) || approval?.status !== "pending"} onClick={() => void mutate("approve", `/api/gate3/approvals/${approval?.id}/approve`)}>确认切片与计算</button>
        <button className="primary" disabled={Boolean(busy) || approval?.status !== "approved" || snapshot.run?.status === "succeeded"} onClick={() => void mutate("run", "/api/gate3/run")}>{busy === "run" ? "正在运行…" : "运行科研闭环"}</button>
        {busy === "run" ? <button className="cancel" onClick={() => void cancel()}>取消运行</button> : null}
      </div>
      {error ? <p className="research-error">{error}</p> : null}

      <section className="research-grid">
        <article className="info-card">
          <header><span>数据集</span><b>{snapshot.dataset?.format ?? "—"}</b></header>
          <h3>{snapshot.dataset?.title ?? "等待元数据检查"}</h3>
          {snapshot.dataset ? <dl>
            <div><dt>变量</dt><dd>{snapshot.dataset.variables.map((item) => item.name).join(" · ")}</dd></div>
            <div><dt>范围</dt><dd>{snapshot.dataset.bounds.west}–{snapshot.dataset.bounds.east}°E / {snapshot.dataset.bounds.south}–{snapshot.dataset.bounds.north}°N</dd></div>
            <div><dt>深度</dt><dd>{snapshot.dataset.bounds.minDepth}–{snapshot.dataset.bounds.maxDepth} dbar</dd></div>
          </dl> : null}
        </article>
        <article className="info-card">
          <header><span>切片计划</span><b>{snapshot.plan ? `${Math.round(snapshot.plan.estimatedBytes / 1024)} KiB` : "—"}</b></header>
          <h3>{snapshot.plan ? `${snapshot.plan.time.start} → ${snapshot.plan.time.end}` : "等待规划"}</h3>
          {snapshot.plan ? <><p>{snapshot.plan.variables.join(", ")}</p><code>{snapshot.plan.planHash.slice(0, 16)}…</code></> : null}
        </article>
        <article className="info-card reviewer-card">
          <header><span>Reviewer</span><b>{snapshot.review?.verdict ?? "等待运行"}</b></header>
          <h3>{snapshot.review ? `${snapshot.review.checks.filter((item) => item.passed).length}/${snapshot.review.checks.length} 项检查通过` : "自动审查尚未执行"}</h3>
          <ul>{snapshot.review?.checks.map((check) => <li key={check.id} className={check.passed ? "passed" : "failed"}>{check.detail}</li>)}</ul>
        </article>
        <article className="info-card">
          <header><span>研究沉淀</span><b>{snapshot.run?.artifactUris.length ?? 0} artifacts</b></header>
          <h3>{snapshot.canvasNodes.length} 个画布节点 · {snapshot.wikiRevisions.length} 个 Wiki 版本</h3>
          <p>大输出仅保存为 Artifact URI；项目快照只保存结构化状态和短摘要。</p>
        </article>
      </section>
      <ConnectorCatalog />
    </div>
  );
}

function ConnectorCatalog() {
  const [connectors, setConnectors] = useState<Array<ConfiguredConnectorDescriptor & { runtimeMode: "fixture" | "live" }>>([]);
  const [probes, setProbes] = useState<Partial<Record<OceanConnectorId, { request: OceanSubsetRequest; metadata: ConnectorMetadataSummary; preflight: ConnectorPreflight }>>>({});
  const [jobs, setJobs] = useState<Partial<Record<OceanConnectorId, ConnectorDownloadJob>>>({});
  const [busy, setBusy] = useState<OceanConnectorId>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    void fetch("/api/gate4/connectors").then((response) => response.json()).then((items: Array<ConfiguredConnectorDescriptor & { runtimeMode: "fixture" | "live" }>) => setConnectors(items));
  }, []);

  const makeRequest = (connectorId: OceanConnectorId): OceanSubsetRequest => {
    const datasetIds: Record<OceanConnectorId, string> = {
      erddap: "noaacwBLENDEDsstDaily",
      "argo-gdac": "ar_index_global_prof",
      "copernicus-marine": "cmems_mod_glo_phy_anfc_0.083deg_P1D-m",
      "nasa-harmony": "C1234208438-POCLOUD",
    };
    return {
      connectorId,
      datasetId: datasetIds[connectorId],
      variables: [connectorId === "erddap" ? "analysed_sst" : "TEMP"],
      region: { west: 130, east: 150, south: 10, north: 30 },
      depth: { min: 0, max: 200 },
      time: { start: "2023-07-01", end: "2023-08-31" },
      outputFormat: "NetCDF",
    };
  };

  const api = async <T,>(url: string, body?: unknown): Promise<T> => {
    const response = await fetch(url, { method: "POST", ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    const result = await response.json() as T | { error: string };
    if (!response.ok) throw new Error("error" in (result as { error?: string }) ? String((result as { error: string }).error) : `HTTP ${response.status}`);
    return result as T;
  };

  const inspect = async (connectorId: OceanConnectorId) => {
    const request = makeRequest(connectorId); setBusy(connectorId); setError(undefined);
    try {
      const result = await api<{ metadata: ConnectorMetadataSummary; preflight: ConnectorPreflight }>("/api/gate4/connectors/metadata", request);
      setProbes((current) => ({ ...current, [connectorId]: { request, ...result } }));
      setJobs((current) => { const next = { ...current }; delete next[connectorId]; return next; });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(undefined); }
  };

  const prepare = async (connectorId: OceanConnectorId) => {
    const probe = probes[connectorId]; if (!probe) return; setBusy(connectorId); setError(undefined);
    try { const next = await api<ConnectorDownloadJob>("/api/gate4/connector-jobs", { request: probe.request, sourceHash: probe.metadata.sourceHash }); setJobs((current) => ({ ...current, [connectorId]: next })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(undefined); }
  };

  const transition = async (connectorId: OceanConnectorId, action: "approve" | "reject" | "run") => {
    const job = jobs[connectorId]; if (!job) return; setBusy(connectorId); setError(undefined);
    try { const next = await api<ConnectorDownloadJob>(`/api/gate4/connector-jobs/${encodeURIComponent(job.id)}/${action}`); setJobs((current) => ({ ...current, [connectorId]: next })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(undefined); }
  };

  return <section className="connector-section">
    <div><small>GATE 4 · APPROVAL-GATED CONNECTORS</small><h2>海洋数据连接器</h2><p>按需加载：探测仅返回结构化元数据；下载必须另建审批单并再次确认。运行模式会明确标注，未知体积不会开放审批。</p></div>
    {error ? <p className="research-error">{error}</p> : null}
    <div className="connector-grid">{connectors.map((connector) => {
      const probe = probes[connector.id]; const plan = probe?.preflight; const job = jobs[connector.id];
      return <article key={connector.id}>
        <header><b>{connector.title}</b><span>{connector.runtimeMode === "live" ? "正式 Runner" : "离线 fixture"} · {connector.authentication === "none" ? "无需凭据" : connector.credentialConfigured ? "凭据已配置" : "待配置凭据"}</span></header>
        <p>{connector.officialClient}</p>
        <small>{connector.capabilities.slice(0, 5).join(" · ")}</small>
        {probe && plan ? <div className={`connector-plan ${plan.status}`}>
          <strong>{probe.metadata.source === "fixture" ? "离线演示元数据" : probe.metadata.source === "cache" ? "正式缓存元数据" : "正式实时元数据"}</strong><code>{probe.metadata.sourceHash.slice(0, 12)}…</code>
          <p>{probe.metadata.variables.map((item) => `${item.name} (${item.units})`).join(" · ")}</p>
          <p>{probe.metadata.selectedShape.length ? `${probe.metadata.selectedShape.join(" × ")} · ` : ""}{probe.metadata.estimateKind === "unknown" ? "服务未提供体积，审批已阻止" : `${estimateLabel(probe.metadata.estimateKind)} ${formatBytes(plan.estimatedBytes ?? probe.metadata.estimatedBytes ?? 0)}`}</p>
        </div> : null}
        {job ? <div className={`connector-job ${job.status}`}><strong>{connectorJobLabel(job.status)}</strong><p>{job.preflight.disclosure.join("；")}</p>{job.artifact ? <a href={connectorArtifactUrl(job.artifact.uri)} target="_blank" rel="noreferrer">打开验证 Artifact · {formatBytes(job.artifact.bytes)}</a> : null}</div> : null}
        <div className="connector-actions">
          <button disabled={busy === connector.id || (!connector.credentialConfigured && connector.authentication !== "none")} onClick={() => void inspect(connector.id)}>{busy === connector.id ? "处理中…" : "探测元数据"}</button>
          {probe && !job && plan?.status === "ready" ? <button onClick={() => void prepare(connector.id)}>生成审批单</button> : null}
          {job?.status === "pending_approval" ? <><button className="primary" onClick={() => void transition(connector.id, "approve")}>确认范围与写入</button><button className="cancel" onClick={() => void transition(connector.id, "reject")}>拒绝</button></> : null}
          {job?.status === "approved" ? <button className="primary" onClick={() => void transition(connector.id, "run")}>执行已批准下载</button> : null}
        </div>
      </article>;
    })}</div>
  </section>;
}

function formatBytes(bytes: number): string { return bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 ** 2).toFixed(1)} MiB`; }
function estimateLabel(kind: ConnectorMetadataSummary["estimateKind"]): string { return ({ exact: "精确", estimated: "预计", upper_bound: "上界", unknown: "未知" })[kind]; }
function connectorJobLabel(status: ConnectorDownloadJob["status"]): string { return ({ pending_approval: "等待二次确认", approved: "已批准，尚未执行", rejected: "已拒绝", downloading: "下载中", completed: "Artifact 已验证", failed: "失败", cancelled: "已取消" })[status]; }
function connectorArtifactUrl(uri: string): string {
  const fixture = /^artifact:\/\/connector-fixture\/([a-f0-9]{64})$/.exec(uri);
  if (fixture) return `/api/gate4/connector-artifacts/${fixture[1]}`;
  const live = /^artifact:\/\/connector\/([0-9a-f-]{36})\/(.+)$/.exec(uri);
  return live ? `/api/gate4/connector-run-artifacts/${encodeURIComponent(live[1]!)}/${live[2]!.split("/").map(encodeURIComponent).join("/")}` : "#";
}

function WorkflowStep({ index, title, detail, active, done }: { index: string; title: string; detail: string; active: boolean; done: boolean }) {
  return <article className={done ? "done" : active ? "active" : ""}><span>{done ? "✓" : index}</span><div><h3>{title}</h3><p>{detail}</p></div></article>;
}

function WikiPanel({ snapshot }: { snapshot: Gate3ProjectSnapshot }) {
  const revision = snapshot.wikiRevisions.at(-1);
  return <div className="wiki-view">
    <aside><small>研究 Wiki</small><button className="active">Gate 3：Argo 观测验证</button><button>研究问题</button><button>数据与方法</button></aside>
    <article>
      <span className="wiki-kicker">版本化知识 · Artifact 引用</span>
      <h1>{revision?.title ?? "Gate 3：Argo 观测验证"}</h1>
      {revision ? <>
        <div className="wiki-markdown">{revision.markdown.split("\n").filter(Boolean).map((line, index) => line.startsWith("## ") ? <h2 key={index}>{line.slice(3)}</h2> : <p key={index}>{line.replaceAll("**", "")}</p>)}</div>
        <h2>关联产物</h2>
        <ul className="artifact-list">{revision.artifactUris.map((uri) => <li key={uri}><a href={artifactHttpUrl(uri)} target="_blank" rel="noreferrer">{uri}</a></li>)}</ul>
        <small>Revision {revision.id} · {new Date(revision.createdAt).toLocaleString("zh-CN")}</small>
      </> : <p>科研运行完成后，Reviewer 结论、局限和 Artifact 引用会以新版本写入这里。</p>}
    </article>
  </div>;
}

function artifactHttpUrl(uri: string): string {
  const match = /^artifact:\/\/gate3\/([^/]+)\/(.+)$/.exec(uri);
  const runId = match?.[1];
  const path = match?.[2];
  return runId && path ? `/api/gate3/artifacts/${encodeURIComponent(runId)}/${path.split("/").map(encodeURIComponent).join("/")}` : "#";
}
