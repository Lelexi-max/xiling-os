import { useEffect, useRef, useState } from "react";
import cytoscape, { type Core } from "cytoscape";
import type { CanvasGraphDocument, EvidenceRecord, LiteratureGraph, LiteratureGraphNode, LiteratureSearchResponse } from "@xiling/contracts";

const edgeColors = {
  citation: "#4f7d88",
  recommendation: "#b58a3f",
  "co-citation": "#8a70bd",
  "bibliographic-coupling": "#36a48f",
};

export function PaperGraphView({ projectId }: { projectId: string }) {
  const container = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [graph, setGraph] = useState<LiteratureGraph>();
  const [selected, setSelected] = useState<LiteratureGraphNode>();
  const [edgeFilter, setEdgeFilter] = useState<keyof typeof edgeColors | "all">("all");
  const [evidenceIds, setEvidenceIds] = useState<Set<string>>(new Set());
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [actionStatus, setActionStatus] = useState("");
  const [query, setQuery] = useState("");
  const [searchStatus, setSearchStatus] = useState("");
  const [searchMeta, setSearchMeta] = useState<Pick<LiteratureSearchResponse, "provider" | "cache" | "degradedFrom">>();
  const [searching, setSearching] = useState(false);

  const focusPaper = (paper: LiteratureGraphNode | undefined) => {
    if (!paper) return;
    setSelected(paper);
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().unselect();
    cy.edges().removeClass("focus");
    const node = cy.getElementById(paper.id);
    node.select();
    node.connectedEdges().addClass("focus");
  };

  useEffect(() => {
    void fetch("/api/gate4/literature/demo").then((response) => response.json()).then((result: LiteratureGraph) => {
      setGraph(result);
      setSelected(result.nodes.find((node) => node.seed) ?? result.nodes[0]);
    });
  }, []);

  useEffect(() => {
    void Promise.all([
      fetch(`/api/gate4/evidence?projectId=${encodeURIComponent(projectId)}`).then((response) => response.json()) as Promise<EvidenceRecord[]>,
      fetch(`/api/gate4/canvas/layout?projectId=${encodeURIComponent(projectId)}`).then((response) => response.json()) as Promise<CanvasGraphDocument>,
    ]).then(([records, graph]) => { setEvidenceIds(new Set(records.map((record) => record.paper.id))); setPinnedIds(new Set(graph.nodes.filter((node) => node.id.startsWith("paper-")).map((node) => node.id.slice(6)))); });
  }, [projectId]);

  const saveEvidence = async () => {
    if (!selected) return; setActionStatus("保存证据中…");
    const response = await fetch("/api/gate4/evidence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId, paper: selected }) });
    if (response.ok) { setEvidenceIds((current) => new Set(current).add(selected.id)); setActionStatus("已加入证据库"); } else setActionStatus("保存失败");
  };
  const pinToCanvas = async () => {
    if (!selected) return; setActionStatus("固定节点中…");
    const response = await fetch("/api/gate4/canvas/papers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId, paper: selected }) });
    if (response.ok) { setPinnedIds((current) => new Set(current).add(selected.id)); setActionStatus("已固定到科研画布"); } else setActionStatus("固定失败");
  };
  const searchRemote = async () => {
    const normalized = query.trim(); if (normalized.length < 2) { setSearchStatus("请输入至少 2 个字符"); return; }
    setSearchStatus("正在检索 Semantic Scholar…"); setSearching(true);
    try {
      const response = await fetch(`/api/gate4/literature/search?q=${encodeURIComponent(normalized)}&limit=40`);
      const result = await response.json() as LiteratureSearchResponse & { graph?: LiteratureGraph; error?: string };
      if (!response.ok) throw new Error(result.error ?? "检索失败");
      if (!result.graph) { setSearchStatus("没有找到可构图的论文"); return; }
      setGraph(result.graph); setSelected(result.graph.nodes[0]); setSearchMeta({ provider: result.provider, cache: result.cache, ...(result.degradedFrom ? { degradedFrom: result.degradedFrom } : {}) });
      setSearchStatus(`${result.graph.nodes.length} 篇 · ${result.cache === "hit" ? "缓存命中" : result.cache === "stale" ? "使用过期缓存" : "已缓存"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "检索失败";
      setSearchStatus(message.includes("429") ? "匿名配额已限流；请稍后重试，或在设置中配置文献 API Key" : "文献服务暂时不可用；已保留当前图");
    } finally { setSearching(false); }
  };

  useEffect(() => {
    if (!container.current || !graph) return;
    const nonSeeds = graph.nodes.filter((node) => !node.seed);
    const years = graph.nodes.map((node) => node.year);
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    const maxCitations = Math.max(...graph.nodes.map((node) => node.citationCount), 1);
    const filteredEdges = graph.edges.filter((edge) => edgeFilter === "all" || edge.kind === edgeFilter);
    const visibleEdges = [...filteredEdges].sort((a, b) => b.score - a.score).slice(0, Math.max(graph.nodes.length + 2, Math.min(filteredEdges.length, graph.nodes.length * 2)));
    const elements = [
      ...graph.nodes.map((node) => {
        const index = nonSeeds.findIndex((item) => item.id === node.id);
        const angle = (Math.PI * 2 * Math.max(index, 0)) / Math.max(nonSeeds.length, 1);
        const radius = node.seed ? 0 : 190 - Math.min(node.relevance, 1) * 45;
        const firstAuthor = node.authors[0]?.split(/\s+/).at(-1) ?? "Unknown";
        const visualSize = 28 + Math.sqrt(node.citationCount / maxCitations) * 30;
        return { data: { id: node.id, label: `${firstAuthor}, ${node.year}`, seed: node.seed ? 1 : 0, citations: node.citationCount, relevance: node.relevance, year: node.year, visualSize }, position: { x: 320 + Math.cos(angle) * radius, y: 260 + Math.sin(angle) * radius } };
      }),
      ...visibleEdges.map((edge) => ({ data: edge })),
    ];
    const cy = cytoscape({
      container: container.current,
      elements,
      layout: { name: "cose", fit: true, padding: 58, animate: false, randomize: false, nodeRepulsion: () => 16_000, idealEdgeLength: () => 145, edgeElasticity: () => 70, nestingFactor: 1.2, gravity: 0.1, numIter: 1_500, componentSpacing: 170 },
      minZoom: 0.45,
      maxZoom: 2.2,
      autoungrabify: true,
      style: [
        { selector: "node", style: {
          "background-color": `mapData(year, ${minYear}, ${maxYear}, #bdd0d0, #2f696c)`,
          "border-color": "#ffffff",
          "border-width": 1.5,
          width: "data(visualSize)",
          height: "data(visualSize)",
          label: "data(label)",
          "font-size": 12,
          color: "#343633",
          "text-wrap": "none",
          "text-valign": "top",
          "text-margin-y": -8,
        } },
        { selector: "node[seed = 1]", style: { "border-color": "#9d5b91", "border-width": 6, color: "#8e477e", "font-weight": 700 } },
        { selector: "node:selected", style: { "border-color": "#9d5b91", "border-width": 5 } },
        { selector: "edge", style: { width: 1, "curve-style": "bezier", opacity: 0.24, "line-color": "#97a3a1", "target-arrow-color": "#97a3a1" } },
        { selector: "edge[kind = 'citation']", style: { "target-arrow-shape": "triangle", "arrow-scale": .55 } },
        { selector: "edge[kind = 'recommendation']", style: { "line-style": "dashed" } },
        { selector: "edge[kind = 'co-citation']", style: { "line-style": "dotted" } },
        { selector: "edge.focus", style: { width: 2.2, opacity: .92, "line-color": "#075f91", "target-arrow-color": "#075f91" } },
      ],
    });
    cyRef.current = cy;
    const initial = graph.nodes.find((node) => node.seed) ?? graph.nodes[0];
    if (initial) { const node = cy.getElementById(initial.id); node.select(); node.connectedEdges().addClass("focus"); }
    cy.on("tap", "node", (event) => focusPaper(graph.nodes.find((node) => node.id === event.target.id())));
    return () => { cyRef.current = null; cy.destroy(); };
  }, [graph, edgeFilter]);

  if (!graph) return <div className="view-loading">按需加载文献图数据与 Cytoscape…</div>;
  const graphYears = graph.nodes.map((node) => node.year);
  const graphMinYear = Math.min(...graphYears);
  const graphMaxYear = Math.max(...graphYears);
  return <div className="paper-graph-view">
    <aside className="paper-list">
      <div className="paper-list-head"><small>发现</small><b>{graph.nodes.length} 篇论文</b></div>
      <div className="paper-list-tabs"><button className="active">相似工作</button><button>前置工作</button><button>后续工作</button></div>
      <div className="paper-list-scroll">{[...graph.nodes].sort((a, b) => Number(b.seed) - Number(a.seed) || b.relevance - a.relevance).map((paper) => <button key={paper.id} className={`${selected?.id === paper.id ? "active" : ""} ${paper.seed ? "seed" : ""}`} onClick={() => focusPaper(paper)}><small>{paper.seed ? "起点论文" : `${paper.year} · ${paper.citationCount} 次引用`}</small><b>{paper.title}</b><span>{paper.authors.slice(0, 2).join(" · ")}</span></button>)}</div>
    </aside>
    <section className="paper-graph-main">
      <div className="paper-graph-toolbar">
        <div><small>文献关联图 · {searchMeta?.provider ?? graph.provider}{searchMeta?.degradedFrom ? " · 降级来源" : ""}</small><h1>{searchMeta ? query : "层结与海洋热浪"}</h1><p>距离表示相关性 · 大小表示被引量 · 默认突出最强关系{searchStatus ? ` · ${searchStatus}` : ""}</p></div>
        <div className="paper-graph-actions">
          <input aria-label="检索论文" placeholder="主题、标题或关键词…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchRemote(); }} />
          <button disabled={searching} onClick={() => void searchRemote()}>{searching ? "检索中…" : "检索"}</button>
          <select value={edgeFilter} onChange={(event) => setEdgeFilter(event.target.value as typeof edgeFilter)} aria-label="关系筛选">
            <option value="all">全部关系</option><option value="citation">引用</option><option value="recommendation">推荐</option><option value="co-citation">共被引</option><option value="bibliographic-coupling">书目耦合</option>
          </select>
          <button onClick={() => { const cy = cyRef.current; if (cy) cy.fit(cy.elements(), 45); }}>◎</button>
        </div>
      </div>
      <div className="paper-graph-canvas" ref={container} />
      <div className="paper-graph-bottom"><div className="graph-utility"><button title="图例说明">?</button><button title="居中图谱" onClick={() => cyRef.current?.fit(cyRef.current.elements(), 60)}>⊙</button></div><div className="year-legend"><small>发表年份</small><i /><div><span>{graphMinYear}</span><span>{graphMaxYear}</span></div></div></div>
    </section>
    <aside className="paper-detail">
      <small>{selected?.seed ? "起点论文" : "关联论文"}</small>
      <h2>{selected?.title}</h2>
      <p>{selected?.authors.join(" · ")} · {selected?.year}</p>
      <div className="paper-open-row"><span>{selected?.citationCount} 次引用</span><button aria-label="保存论文">♡ 保存</button></div>
      <div className="paper-abstract"><b>摘要</b><p>该研究讨论上层海洋结构、热量收支与海洋热浪持续性之间的联系，并为当前机制假设提供可追溯的观测依据。选择论文后可进一步读取完整摘要与证据片段。</p></div>
      <dl><div><dt>相关度</dt><dd>{selected?.relevance.toFixed(2)}</dd></div><div><dt>数据来源</dt><dd>{selected?.source}</dd></div></dl>
      <button disabled={!selected || evidenceIds.has(selected.id)} onClick={() => void saveEvidence()}>{selected && evidenceIds.has(selected.id) ? "✓ 已加入证据库" : "加入证据库"}</button><button disabled={!selected || pinnedIds.has(selected.id)} onClick={() => void pinToCanvas()}>{selected && pinnedIds.has(selected.id) ? "✓ 已固定到科研画布" : "固定到科研画布"}</button>
      {actionStatus ? <p className="paper-action-status">{actionStatus}</p> : null}
      <div className="algorithm-note"><b>算法透明</b><p>{graph.algorithm}</p><small>{graph.nodes.length} nodes · {graph.edges.length} edges · {graph.fetchedAt}</small></div>
    </aside>
  </div>;
}
