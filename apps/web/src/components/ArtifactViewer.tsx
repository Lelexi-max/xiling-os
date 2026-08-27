import { useEffect, useMemo, useState } from "react";
import type { ProjectResearchWorkflow } from "@xiling/contracts";

type ArtifactItem = { uri: string; workflow: ProjectResearchWorkflow; href?: string; name: string; extension: string };

function artifactHref(uri: string, projectId: string): string | undefined {
  const match = /^artifact:\/\/workflow\/(workflow-[0-9a-f-]{36})\/(.+)$/.exec(uri);
  return match ? `/api/gate4/workflow-artifacts/${match[1]}/${match[2]}?projectId=${encodeURIComponent(projectId)}` : undefined;
}

export function ArtifactViewer({ projectId, workflows, expanded, onToggleExpanded, onClose }: { projectId: string; workflows: ProjectResearchWorkflow[]; expanded: boolean; onToggleExpanded(): void; onClose(): void }) {
  const artifacts = useMemo<ArtifactItem[]>(() => workflows.flatMap((workflow) => (workflow.run?.artifactUris ?? []).map((uri) => {
    const name = uri.split("/").at(-1) ?? "Artifact";
    const href = artifactHref(uri, projectId);
    return { uri, workflow, ...(href ? { href } : {}), name, extension: name.split(".").at(-1)?.toLowerCase() ?? "" };
  })), [projectId, workflows]);
  const [selectedUri, setSelectedUri] = useState("");
  const [tab, setTab] = useState<"preview" | "provenance" | "review">("preview");
  const [text, setText] = useState("");
  const selected = artifacts.find((artifact) => artifact.uri === selectedUri) ?? artifacts[0];
  useEffect(() => { if (selected && selected.uri !== selectedUri) setSelectedUri(selected.uri); }, [selected, selectedUri]);
  useEffect(() => {
    setText("");
    if (!selected?.href || !["csv", "json", "txt", "md", "log"].includes(selected.extension)) return;
    const controller = new AbortController();
    void fetch(selected.href, { signal: controller.signal }).then((response) => response.ok ? response.text() : Promise.reject(new Error(`HTTP ${response.status}`))).then((value) => setText(value.slice(0, 100_000))).catch((error) => { if (error.name !== "AbortError") setText("无法读取该 Artifact 预览。"); });
    return () => controller.abort();
  }, [selected?.href, selected?.extension]);

  return <aside className="artifact-panel">
    <div className="artifact-panel-head"><div><b>{selected?.name ?? "项目 Artifacts"}</b><small>{selected ? `${selected.workflow.request.datasetId} · ${selected.workflow.status}` : "当前会话尚未生成产物"}</small></div><div className="artifact-window-actions">{selected?.href ? <a aria-label="下载产物" href={selected.href} download>↓</a> : null}<button aria-label={expanded ? "还原产物面板" : "全屏查看产物"} onClick={onToggleExpanded}>{expanded ? "⊙" : "↗"}</button><button aria-label="关闭产物面板" onClick={onClose}>×</button></div></div>
    {artifacts.length > 1 ? <label className="artifact-selector"><span>当前产物</span><select value={selected?.uri ?? ""} onChange={(event) => setSelectedUri(event.target.value)}>{artifacts.map((artifact) => <option key={artifact.uri} value={artifact.uri}>{artifact.name}</option>)}</select></label> : null}
    <div className="artifact-tabs"><button className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}>预览</button><button className={tab === "provenance" ? "active" : ""} onClick={() => setTab("provenance")}>溯源</button><button className={tab === "review" ? "active" : ""} onClick={() => setTab("review")}>审阅</button></div>
    <div className="artifact-preview">
      {!selected ? <div className="artifact-empty"><span>◇</span><h3>尚无真实科研产物</h3><p>在对话中形成数据切片计划，批准并完成计算后，图表、表格、日志和 RO-Crate 会出现在这里。</p></div> : tab === "preview" ? <>
        <div className="figure-title"><b>{selected.name}</b><small>{selected.uri}</small></div>
        {selected.href && ["png", "jpg", "jpeg", "webp", "gif"].includes(selected.extension) ? <img className="artifact-real-image" src={selected.href} alt={selected.name} /> : text ? <pre className="artifact-text-preview">{text}</pre> : <div className="artifact-file-preview"><span>{selected.extension.toUpperCase() || "FILE"}</span><p>该格式不提供内嵌文本预览，可下载或从科研画布查看其完整溯源。</p>{selected.href ? <a href={selected.href} target="_blank" rel="noreferrer">打开 Artifact ↗</a> : null}</div>}
      </> : tab === "provenance" ? <div className="artifact-provenance"><h3>计算溯源</h3><dl><div><dt>Workflow</dt><dd>{selected.workflow.id}</dd></div><div><dt>数据源</dt><dd>{selected.workflow.request.connectorId}</dd></div><div><dt>数据集</dt><dd>{selected.workflow.request.datasetId}</dd></div><div><dt>变量</dt><dd>{selected.workflow.request.variables.join("、")}</dd></div><div><dt>时间</dt><dd>{selected.workflow.request.time.start} — {selected.workflow.request.time.end}</dd></div><div><dt>状态</dt><dd>{selected.workflow.status}</dd></div></dl></div> : <div className="artifact-review"><h3>Reviewer</h3>{selected.workflow.review ? <><strong>{selected.workflow.review.verdict === "accepted" ? "审阅通过" : "需要修订"}</strong>{selected.workflow.review.checks.map((check) => <p key={check.id}>{check.passed ? "✓" : "✕"} {check.detail}</p>)}{selected.workflow.review.limitations.map((limitation) => <p key={limitation}>限制：{limitation}</p>)}</> : <p>该运行尚未生成 Reviewer 报告。</p>}</div>}
    </div>
  </aside>;
}
