import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import type { AgentExecutionEdge, AgentExecutionGraphProjection, AgentExecutionNode, AgentExecutionGraphScope } from "@xiling/contracts";
import { RecordDetailModal } from "../components/RecordDetailModal.js";

type ExecutionNode = Node<AgentExecutionNode, "execution">;
type ExecutionEdge = Edge<{ kind: AgentExecutionEdge["kind"] }>;

const kindLabel: Record<AgentExecutionNode["kind"], string> = {
  project: "PROJECT",
  session: "SESSION",
  run: "RUN",
  model: "MODEL",
  tool: "TOOL",
  message: "ENTRY",
  compaction: "COMPACTION",
};

function ExecutionCard({ data, selected }: NodeProps<ExecutionNode>) {
  return (
    <article className={`execution-card execution-${data.kind} status-${data.status ?? "recorded"} ${selected ? "selected" : ""}`}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <header><span>{kindLabel[data.kind]}</span>{data.status ? <i>{data.status}</i> : null}</header>
      <h3>{data.title}</h3>
      <p>{data.summary || "已记录"}</p>
      <footer><time>{new Date(data.timestamp).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</time>{data.metrics?.totalTokens ? <span>{data.metrics.totalTokens.toLocaleString()} tok</span> : null}</footer>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </article>
  );
}

const nodeTypes: NodeTypes = { execution: ExecutionCard };
const edgeColor: Record<AgentExecutionEdge["kind"], string> = {
  contains: "#9aa7b5",
  started: "#4d83c4",
  continued: "#89929c",
  invoked: "#6f67aa",
  returned: "#3a847d",
  produced: "#3376a8",
  compacted: "#a47a51",
};

const toEdge = (item: AgentExecutionEdge): ExecutionEdge => ({
  id: item.id,
  source: item.source,
  target: item.target,
  type: "default",
  label: item.label,
  data: { kind: item.kind },
  style: { stroke: edgeColor[item.kind], strokeWidth: item.kind === "contains" ? 1.15 : 1.45, ...(item.kind === "continued" || item.kind === "compacted" ? { strokeDasharray: "5 5" } : {}) },
  labelStyle: { fill: "#78828d", fontSize: 9 },
  labelBgStyle: { fill: "#f7f9fb", fillOpacity: 0.92 },
  markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: edgeColor[item.kind] },
  focusable: false,
});

const arrange = (nodes: ExecutionNode[], edges: ExecutionEdge[]): ExecutionNode[] => {
  const ids = new Set(nodes.map((node) => node.id));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const children = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const item of edges) {
    if (item.data?.kind === "continued" || !ids.has(item.source) || !ids.has(item.target)) continue;
    incoming.set(item.target, (incoming.get(item.target) ?? 0) + 1);
    children.get(item.source)?.push(item.target);
  }
  const ranks = new Map(nodes.map((node) => [node.id, 0]));
  const queue = nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).map((node) => node.id);
  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const child of children.get(current) ?? []) {
      ranks.set(child, Math.max(ranks.get(child) ?? 0, (ranks.get(current) ?? 0) + 1));
      incoming.set(child, (incoming.get(child) ?? 1) - 1);
      if (incoming.get(child) === 0) queue.push(child);
    }
  }
  const rows = new Map<number, ExecutionNode[]>();
  for (const node of nodes) {
    const rank = ranks.get(node.id) ?? 0;
    rows.set(rank, [...(rows.get(rank) ?? []), node]);
  }
  const horizontal = 248;
  return [...rows.entries()].sort(([a], [b]) => a - b).flatMap(([rank, row]) => {
    const ordered = [...row].sort((a, b) => a.data.timestamp.localeCompare(b.data.timestamp));
    const start = -((ordered.length - 1) * horizontal) / 2;
    return ordered.map((node, index) => ({ ...node, position: { x: start + index * horizontal, y: 58 + rank * 190 } }));
  });
};

const formatDuration = (value?: number) => value === undefined ? "—" : value < 1_000 ? `${value} ms` : `${(value / 1_000).toFixed(1)} s`;

export function AgentExecutionGraphView({ projectId, activeSessionId, refreshKey = 0 }: { projectId: string; activeSessionId: string; refreshKey?: number }) {
  const [scope, setScope] = useState<AgentExecutionGraphScope>("project");
  const [projection, setProjection] = useState<AgentExecutionGraphProjection>();
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<AgentExecutionNode>();
  const [nodes, setNodes, onNodesChange] = useNodesState<ExecutionNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<ExecutionEdge>([]);
  const flow = useRef<ReactFlowInstance<ExecutionNode, ExecutionEdge> | null>(null);

  const fit = useCallback(() => { window.setTimeout(() => void flow.current?.fitView({ padding: 0.16, duration: 260, maxZoom: 1.05 }), 40); }, []);
  const autoArrange = useCallback(() => { setNodes((current) => arrange(current, edges)); fit(); }, [edges, fit, setNodes]);

  useEffect(() => {
    let cancelled = false;
    setError("");
    const query = new URLSearchParams({ projectId, scope, ...(scope === "session" && activeSessionId ? { sessionId: activeSessionId } : {}) });
    void fetch(`/api/agent-center/graph?${query}`).then(async (response) => {
      if (!response.ok) throw new Error(response.status === 404 && scope === "session" ? "当前还没有可展示的 Agent 会话" : `运行图加载失败：${response.status}`);
      return response.json() as Promise<AgentExecutionGraphProjection>;
    }).then((graph) => {
      if (cancelled) return;
      const nextEdges = graph.edges.map(toEdge);
      const nextNodes = arrange(graph.nodes.map((item): ExecutionNode => ({ id: item.id, type: "execution", position: { x: 0, y: 0 }, data: item })), nextEdges);
      setProjection(graph);
      setEdges(nextEdges);
      setNodes(nextNodes);
      fit();
    }).catch((cause) => { if (!cancelled) { setProjection(undefined); setEdges([]); setNodes([]); setError(cause instanceof Error ? cause.message : String(cause)); } });
    return () => { cancelled = true; };
  }, [projectId, activeSessionId, scope, refreshKey, fit, setEdges, setNodes]);

  const legend = useMemo(() => [
    ["run", "运行"], ["model", "模型"], ["tool", "工具"], ["message", "消息 / 结果"], ["compaction", "压缩"],
  ] as const, []);

  return (
    <section className="agent-execution-graph" aria-label="Agent 运行关系图">
      <header className="execution-graph-head">
        <div><small>AGENT EXECUTION GRAPH</small><b>{scope === "project" ? "项目运行全景" : "当前对话链"}</b><span>由 Agent Store 耐久日志实时投影，拖动只改变当前视图</span></div>
        <div className="execution-graph-actions">
          <div className="execution-scope-switch"><button className={scope === "project" ? "active" : ""} onClick={() => setScope("project")}>项目全部</button><button className={scope === "session" ? "active" : ""} disabled={!activeSessionId} onClick={() => setScope("session")}>当前对话</button></div>
          <button onClick={autoArrange}>自动整理</button><button onClick={fit}>适应窗口</button>
        </div>
      </header>
      <div className="execution-graph-meta">
        <span>{projection ? `${projection.counts.sessions} 会话 · ${projection.counts.runs} 运行 · ${projection.counts.operations} 操作 · ${projection.counts.entries} 记录` : "正在读取 Agent Store…"}</span>
        <div>{legend.map(([kind, label]) => <span key={kind}><i className={`legend-${kind}`} />{label}</span>)}</div>
        {projection?.truncated ? <em>为保持交互流畅，当前为有界投影</em> : null}
      </div>
      <div className="execution-flow">
        {error ? <div className="execution-graph-empty"><b>暂无运行关系</b><span>{error}</span></div> : nodes.length ? <ReactFlow<ExecutionNode, ExecutionEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_event, node) => setSelected(node.data)}
          onInit={(instance) => { flow.current = instance; fit(); }}
          nodesConnectable={false}
          edgesReconnectable={false}
          edgesFocusable={false}
          deleteKeyCode={null}
          minZoom={0.18}
          maxZoom={1.8}
          panOnScroll
          panOnScrollSpeed={0.8}
          zoomOnScroll={false}
          fitView
        ><Background color="#dbe1e7" gap={30} size={1} /><Controls position="bottom-right" /></ReactFlow> : <div className="execution-graph-empty"><b>正在建立运行图</b><span>读取 Session、Run、Operation 与 Entry…</span></div>}
      </div>
      {selected ? <RecordDetailModal eyebrow={kindLabel[selected.kind]} title={selected.title} onClose={() => setSelected(undefined)}><div className="execution-node-detail"><p>{selected.summary}</p><dl><div><dt>状态</dt><dd>{selected.status ?? "recorded"}</dd></div><div><dt>时间</dt><dd>{new Date(selected.timestamp).toLocaleString("zh-CN", { hour12: false })}</dd></div><div><dt>耗时</dt><dd>{formatDuration(selected.metrics?.durationMs)}</dd></div><div><dt>Tokens</dt><dd>{selected.metrics?.totalTokens?.toLocaleString() ?? "—"}</dd></div><div><dt>Session</dt><dd>{selected.source.sessionId ?? "—"}</dd></div><div><dt>Run</dt><dd>{selected.source.runId ?? "—"}</dd></div></dl></div></RecordDetailModal> : null}
    </section>
  );
}
